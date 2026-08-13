/**
 * 多轮 Agent 搜索入口
 * POST /api/agent/chat
 *
 * SSE 是单向流：需要追问时发送 question/session_paused 后结束请求；
 * 用户回复通过 sessionId 发起新请求继续 Agent Loop。
 */

import { z } from 'zod';
import { AgentError, AgentRunError } from '@/lib/agent/types';
import type {
  AgentErrorCode,
  AgentEvent,
  AgentInput,
  AgentSession,
  PendingQuestion,
  SearchPlan,
} from '@/lib/agent/types';
import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';
import { clarificationOptionLabel } from '@/lib/agent/goal';
import {
  applyRuntimeStateToSessionAsync,
  appendAssistantMessageAsync,
  appendUserMessageAsync,
  createAgentSessionAsync,
  getAgentSessionAsync,
  saveAgentSessionAsync,
} from '@/lib/agent/session';
import { configureCloudflareAgentSessionStore } from '@/lib/agent/cloudflareSessionStore';
import { runSearchAgentV3 } from '@/lib/agent/orchestrator/runtime';
import { amapPoiSearch, enrichRestaurantsWithAmapDetails } from '@/lib/amap';
import { logger } from '@/lib/logger';
import { osmSearch } from '@/lib/osm';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';

const AGENT_POI_PAGES_PER_SEARCH = parsePositiveInt(process.env.AGENT_POI_PAGES_PER_SEARCH, 2);
const AGENT_DETAIL_ENRICH_LIMIT = parsePositiveInt(process.env.AGENT_DETAIL_ENRICH_LIMIT, 6);
/**
 * 流级心跳间隔。
 *
 * 单次候选验证的超时是 60s，期间没有任何业务事件；客户端靠心跳区分
 * "还在算"和"已经卡死"。改动心跳间隔必须同步检查 lib/api.ts 的
 * HEARTBEAT_TIMEOUT_MS，二者需保持数倍关系。
 */
const AGENT_HEARTBEAT_INTERVAL_MS = parsePositiveInt(process.env.AGENT_HEARTBEAT_MS, 10000);

const LocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  address: z.string().optional(),
});

const PreferenceSummarySchema = z.object({
  favoriteCuisines: z.array(z.object({
    name: z.string(),
    weight: z.number(),
  })).optional(),
  avoidedCuisines: z.array(z.object({
    name: z.string(),
    weight: z.number(),
  })).optional(),
  preferredDistanceMeters: z.number().optional(),
  preferredPriceRange: z.object({
    min: z.number().optional(),
    max: z.number().optional(),
  }).optional(),
  recentSelectedRestaurants: z.array(z.string()).optional(),
  recentRejectedRestaurants: z.array(z.string()).optional(),
}).optional();

/**
 * message 与 optionId 二选一。
 *
 * optionId 走确定性状态转移（后端自己定义的 effect，不调模型）；
 * message 才是需要模型理解的自由文本。选项文案永远不作为 message 回传。
 */
const AgentChatRequestSchema = z.object({
  message: z.string().min(1).max(500).optional(),
  optionId: z.string().min(1).max(64).optional(),
  location: LocationSchema,
  sessionId: z.string().optional(),
  preferenceSummary: PreferenceSummarySchema,
  groupPreferenceSummaries: z.array(PreferenceSummarySchema.unwrap()).optional(),
}).refine(
  (data) => Boolean(data.message?.trim()) || Boolean(data.optionId?.trim()),
  { message: 'Either message or optionId is required' }
).refine(
  (data) => !data.optionId || Boolean(data.sessionId),
  { message: 'optionId requires an existing sessionId' }
);

function sendEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  const data = JSON.stringify(event);
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

async function pauseSessionWithQuestion(
  controller: ReadableStreamDefaultController,
  session: AgentSession,
  question: PendingQuestion,
  resultState?: AgentInput['runtimeState'],
  questionTraceId?: string
): Promise<void> {
  if (resultState) {
    await applyRuntimeStateToSessionAsync(session, {
      ...resultState,
      pendingQuestion: question,
    });
  }
  session.pendingQuestion = question;
  await appendAssistantMessageAsync(session, question.question);
  await saveAgentSessionAsync(session);
  sendEvent(controller, {
    type: 'question',
    traceId: questionTraceId,
    sessionId: session.id,
    question: question.question,
    options: question.options,
    allowFreeText: question.allowFreeText ?? true,
  });
  sendEvent(controller, {
    type: 'session_paused',
    traceId: questionTraceId,
    sessionId: session.id,
  });
  controller.close();
}

function sendSessionUpdated(
  controller: ReadableStreamDefaultController,
  session: AgentSession
): void {
  sendEvent(controller, {
    type: 'session_updated',
    sessionId: session.id,
  });
}

export async function POST(request: Request) {
  await configureCloudflareAgentSessionStore();

  // 这是整个应用最贵的入口：一次请求会跑完整个 agent loop，用的是部署者自己的
  // OPENAI_API_KEY。两道闸门——按 IP 挡普通滥用，按常量 key 的总量闸门挡轮换
  // IP 的脚本，后者才是真正给账单封顶的那道。
  const ip = getClientIP(request);
  const [perIp, global] = await Promise.all([
    checkRateLimit('agentChatPerIp', ip),
    checkRateLimit('agentChatGlobal', 'all'),
  ]);

  const rejected = !perIp.success ? perIp : (!global.success ? global : null);
  if (rejected) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429, {
      'Retry-After': String(rejected.retryAfterSeconds),
    });
  }

  let requestData: z.infer<typeof AgentChatRequestSchema>;

  try {
    const body: unknown = await request.json();
    const validation = AgentChatRequestSchema.safeParse(body);

    if (!validation.success) {
      return jsonResponse(
        { error: 'Invalid request parameters', details: validation.error.errors },
        400
      );
    }

    requestData = validation.data;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const stream = new ReadableStream({
    async start(controller) {
      let heartbeat: ReturnType<typeof setInterval> | undefined = setInterval(() => {
        try {
          sendEvent(controller, { type: 'heartbeat', at: Date.now() });
        } catch {
          // 客户端已断开，停止心跳即可。
          stopHeartbeat();
        }
      }, AGENT_HEARTBEAT_INTERVAL_MS);

      function stopHeartbeat(): void {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = undefined;
        }
      }

      let activeSession: AgentSession | undefined;

      try {
        const resumableSession = requestData.sessionId
          ? await getAgentSessionAsync(requestData.sessionId)
          : null;

        if (requestData.sessionId && !resumableSession) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
            code: 'SESSION_EXPIRED',
            recoverable: false,
          });
          stopHeartbeat();
          controller.close();
          return;
        }

        const shouldResumeSession = Boolean(resumableSession);
        let session = shouldResumeSession && resumableSession
          ? resumableSession
          : await createAgentSessionAsync(requestData.message ?? '', requestData.location);

        if (!session) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
            code: 'SESSION_EXPIRED',
            recoverable: false,
          });
          stopHeartbeat();
          controller.close();
          return;
        }

        // 会话消息记录用选项的展示文案，保证 messages 对人可读；
        // 但传给 Agent 的是 optionId，语义判断绝不依赖这段文案。
        const userMessage = requestData.optionId
          ? clarificationOptionLabel(session.pendingQuestion, requestData.optionId)
            ?? requestData.optionId
          : requestData.message ?? '';

        if (shouldResumeSession) {
          await appendUserMessageAsync(session, userMessage);
          sendEvent(controller, {
            type: 'session_resumed',
            sessionId: session.id,
          });
        }

        activeSession = session;
        const previousLocation = session.location;
        session.location = requestData.location;

        const input: AgentInput = {
          query: requestData.message ?? '',
          optionId: requestData.optionId,
          location: requestData.location,
          previousLocation,
          sessionId: session.id,
          messages: [...session.messages],
          preferenceSummary: mergeUserPreferenceSummaries([
            requestData.preferenceSummary,
            ...(requestData.groupPreferenceSummaries ?? []),
          ].filter((summary): summary is NonNullable<typeof requestData.preferenceSummary> => Boolean(summary))),
          runtimeState: {
            goal: session.goal,
            attempts: session.attempts,
            candidates: session.candidates,
            actions: session.actions,
            observations: session.observations,
            trace: session.trace,
            pendingQuestion: session.pendingQuestion,
            lastQuestionFingerprint: session.lastQuestionFingerprint,
            consecutiveAskTurns: session.consecutiveAskTurns,
          },
        };

        logger.info('Agent chat search started', {
          sessionId: session.id,
          query: input.query,
          location: input.location,
        });

        const result = await runSearchAgentV3(
          input,
          (event) => sendEvent(controller, event),
          async (plan: SearchPlan) => {
            try {
              const restaurants = await amapPoiSearch(
                plan.keywords,
                input.location,
                plan.radiusMeters,
                plan.poiType,
                AGENT_POI_PAGES_PER_SEARCH,
                { preferProvidedPoiType: Boolean(plan.poiType) && plan.keywords.length === 1 }
              );
              return enrichRestaurantsWithAmapDetails(restaurants, AGENT_DETAIL_ENRICH_LIMIT);
            } catch (error) {
              logger.warn('Amap Agent search failed, falling back to OSM', {
                error: error instanceof Error ? error.message : String(error),
                plan,
              });

              try {
                return await osmSearch(plan.keywords, input.location, plan.radiusMeters);
              } catch (fallbackError) {
                // 两个数据源都挂了才走到这里，在抛出点定错误码，
                // 而不是让下游对 message 做子串匹配。
                throw new AgentError(
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
                  'SEARCH_PROVIDER_FAILED',
                  true,
                  { cause: fallbackError }
                );
              }
            }
          }
        );

        if (result.runtimeState) {
          await applyRuntimeStateToSessionAsync(session, result.runtimeState);
        }

        if (result.paused && result.question) {
          await pauseSessionWithQuestion(
            controller,
            session,
            result.question,
            result.runtimeState,
            result.questionTraceId
          );
          stopHeartbeat();
          return;
        }

        session.pendingQuestion = undefined;
        await appendAssistantMessageAsync(session, result.explanation);
        await saveAgentSessionAsync(session);
        sendSessionUpdated(controller, session);
        stopHeartbeat();
        controller.close();
      } catch (error) {
        // 失败的 turn 也要留痕：AgentRunError 携带失败前的运行状态，
        // 先落库再报错，否则最需要 trace 的这一轮什么都查不到。
        const code: AgentErrorCode = error instanceof AgentRunError
          ? error.code
          : error instanceof AgentError ? error.code : 'UNKNOWN';
        const message = error instanceof Error ? error.message : 'Agent 对话搜索失败';
        // 可恢复性由抛出点决定：配额耗尽这类错误重试 100% 失败，
        // 前端据此不展示重试入口。
        const recoverable = resolveRecoverable(error, code);

        logger.error('Agent chat stream error', {
          sessionId: activeSession?.id,
          code,
          error: message,
        });

        if (error instanceof AgentRunError && error.runtimeState && activeSession) {
          try {
            await applyRuntimeStateToSessionAsync(activeSession, error.runtimeState);
          } catch (persistError) {
            logger.warn('Failed to persist runtime state for a failed turn', {
              sessionId: activeSession.id,
              error: persistError instanceof Error ? persistError.message : String(persistError),
            });
          }
        }

        sendEvent(controller, {
          type: 'error',
          message,
          code,
          recoverable,
        });
        stopHeartbeat();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}

export async function GET() {
  return jsonResponse({ error: 'Method not allowed' }, 405);
}

function jsonResponse(
  body: unknown,
  status: number,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** 可恢复性优先取抛出点带的标记，取不到再按错误码兜底。 */
function resolveRecoverable(error: unknown, code: AgentErrorCode): boolean {
  const cause = error instanceof AgentRunError ? error.cause : error;
  if (cause instanceof AgentError) {
    return cause.retryable;
  }

  return code !== 'CONFIG_MISSING'
    && code !== 'SESSION_EXPIRED'
    && code !== 'MODEL_QUOTA_EXHAUSTED'
    && code !== 'INVALID_OPTION';
}
