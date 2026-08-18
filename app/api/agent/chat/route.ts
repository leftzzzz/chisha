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
  deleteAgentSessionAsync,
  getAgentSessionAsync,
  saveAgentSessionAsync,
} from '@/lib/agent/session';
import { configureCloudflareAgentSessionStore } from '@/lib/agent/cloudflareSessionStore';
import {
  claimLegacySessionOwner,
  getSessionOwner,
  sessionBelongsToOwner,
  SessionOwnerConfigurationError,
} from '@/lib/agent/sessionOwner';
import { runSearchAgentV3 } from '@/lib/agent/orchestrator/runtime';
import {
  amapPoiSearch,
  AmapProviderError,
  enrichRestaurantsWithAmapDetails,
} from '@/lib/amap';
import { logger } from '@/lib/logger';
import { osmSearch } from '@/lib/osm';
import { checkRateLimit, getClientIP } from '@/lib/rateLimit';
import {
  acquireProviderLease,
  getProviderSchedulerConfig,
  providerSchedulerName,
  ProviderSchedulerError,
  type ProviderLease,
} from '@/lib/providerScheduler';

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
const MAX_AGENT_REQUEST_BYTES = 64 * 1024;

const BoundedPreferenceItemSchema = z.object({
  name: z.string().trim().min(1).max(64),
  weight: z.number().finite().min(0).max(1000),
});

const LocationSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  address: z.string().trim().max(200).optional(),
});

const PreferenceSummarySchema = z.object({
  favoriteCuisines: z.array(BoundedPreferenceItemSchema).max(20).optional(),
  avoidedCuisines: z.array(BoundedPreferenceItemSchema).max(20).optional(),
  preferredDistanceMeters: z.number().finite().min(0).max(50_000).optional(),
  preferredPriceRange: z.object({
    min: z.number().finite().min(0).max(100_000).optional(),
    max: z.number().finite().min(0).max(100_000).optional(),
  }).optional(),
  recentSelectedRestaurants: z.array(z.string().trim().min(1).max(150)).max(20).optional(),
  recentRejectedRestaurants: z.array(z.string().trim().min(1).max(150)).max(20).optional(),
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
  sessionId: z.string().trim().min(1).max(128).optional(),
  preferenceSummary: PreferenceSummarySchema,
  groupPreferenceSummaries: z.array(PreferenceSummarySchema.unwrap()).max(8).optional(),
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

  const contentLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(contentLength) && contentLength > MAX_AGENT_REQUEST_BYTES) {
    return jsonResponse({ error: 'Request body too large' }, 413);
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

  // IP 限流只做廉价反滥用；真正的账单保护由下面的跨实例 active-run/provider lease 提供。
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

  let ownerContext: Awaited<ReturnType<typeof getSessionOwner>>;
  try {
    ownerContext = await getSessionOwner(request);
  } catch (error) {
    if (error instanceof SessionOwnerConfigurationError) {
      return jsonResponse({ error: '服务配置不完整' }, 503, { 'Retry-After': '30' });
    }
    throw error;
  }

  let session: AgentSession;
  let activeRunLease: ProviderLease | undefined;
  let sessionLease: ProviderLease | undefined;
  let createdSessionId: string | undefined;
  const requestSignal = request.signal;

  try {
    const resumableSession = requestData.sessionId
      ? await getAgentSessionAsync(requestData.sessionId)
      : null;

    if (requestData.sessionId && (!resumableSession
      || !sessionBelongsToOwner(resumableSession.ownerId, ownerContext.ownerId))) {
      logger.warn('Agent session is missing or belongs to another owner');
      return sessionExpiredResponse(ownerContext.setCookie);
    }

    if (resumableSession) {
      claimLegacySessionOwner(resumableSession, ownerContext.ownerId);
      session = resumableSession;
      sessionLease = await acquireProviderLease(
        providerSchedulerName('session', session.id),
        getProviderSchedulerConfig('session'),
        { signal: requestSignal }
      );
      activeRunLease = await acquireProviderLease(
        providerSchedulerName('active-runs'),
        getProviderSchedulerConfig('active-runs'),
        { signal: requestSignal }
      );
    } else {
      activeRunLease = await acquireProviderLease(
        providerSchedulerName('active-runs'),
        getProviderSchedulerConfig('active-runs'),
        { signal: requestSignal }
      );
      session = await createAgentSessionAsync(
        requestData.message ?? '',
        requestData.location,
        ownerContext.ownerId
      );
      createdSessionId = session.id;
      sessionLease = await acquireProviderLease(
        providerSchedulerName('session', session.id),
        getProviderSchedulerConfig('session'),
        { signal: requestSignal }
      );
    }

  } catch (error) {
    await Promise.allSettled([
      activeRunLease?.release(),
      sessionLease?.release(),
      createdSessionId ? deleteAgentSessionAsync(createdSessionId) : Promise.resolve(),
    ]);
    return admissionErrorResponse(error, ownerContext.setCookie);
  }

  const runAbortController = new AbortController();
  const abortFromRequest = (): void => runAbortController.abort(requestSignal?.reason);
  if (requestSignal?.aborted) {
    abortFromRequest();
  } else {
    requestSignal?.addEventListener('abort', abortFromRequest, { once: true });
  }
  const signal = runAbortController.signal;
  let streamCancelled = false;
  let admissionLeaseLost = false;
  const abortForLostLease = (): void => {
    admissionLeaseLost = true;
    runAbortController.abort();
  };
  activeRunLease.startAutoRenew(abortForLostLease);
  sessionLease.startAutoRenew(abortForLostLease);

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

      const activeSession: AgentSession = session;

      try {
        const shouldResumeSession = Boolean(requestData.sessionId);

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

        const previousLocation = session.location;
        session.location = requestData.location;

        const input: AgentInput = {
          signal,
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
          queryLength: input.query.length,
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
                {
                  preferProvidedPoiType: Boolean(plan.poiType) && plan.keywords.length === 1,
                  signal,
                }
              );
              return enrichRestaurantsWithAmapDetails(restaurants, AGENT_DETAIL_ENRICH_LIMIT, signal);
            } catch (error) {
              if (error instanceof Error && error.name === 'AbortError') {
                throw error;
              }
              if (error instanceof AmapProviderError && error.category !== 'unavailable') {
                throw new AgentError(
                  error.message,
                  error.category === 'rate_limited'
                    ? 'RATE_LIMITED'
                    : error.category === 'configuration' ? 'CONFIG_MISSING' : 'SEARCH_PROVIDER_FAILED',
                  error.retryable,
                  { cause: error }
                );
              }
              if (error instanceof ProviderSchedulerError) {
                const blockedByConfiguration = error.providerCategory === 'configuration';
                const blockedByQuota = error.providerCategory === 'quota_exhausted';
                throw new AgentError(
                  error.message,
                  blockedByConfiguration
                    ? 'CONFIG_MISSING'
                    : blockedByQuota ? 'SEARCH_PROVIDER_FAILED'
                    : error.kind === 'busy' || error.kind === 'blocked'
                    ? 'RATE_LIMITED'
                    : 'SEARCH_PROVIDER_FAILED',
                  !blockedByConfiguration && !blockedByQuota && error.kind !== 'configuration',
                  { cause: error }
                );
              }
              logger.warn('Amap Agent search failed, falling back to OSM', {
                error: error instanceof Error ? error.message : String(error),
                plan,
              });

              try {
                return await osmSearch(plan.keywords, input.location, plan.radiusMeters, signal);
              } catch (fallbackError) {
                if (fallbackError instanceof Error && fallbackError.name === 'AbortError') {
                  throw fallbackError;
                }
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
        if (streamCancelled || requestSignal.aborted) {
          logger.info('Agent chat stream cancelled', { sessionId: activeSession.id });
          return;
        }
        // 失败的 turn 也要留痕：AgentRunError 携带失败前的运行状态，
        // 先落库再报错，否则最需要 trace 的这一轮什么都查不到。
        const code: AgentErrorCode = admissionLeaseLost
          ? 'RATE_LIMITED'
          : error instanceof AgentRunError
            ? error.code
            : error instanceof AgentError ? error.code : 'UNKNOWN';
        const message = admissionLeaseLost
          ? '请求运行租约已失效，请重试'
          : error instanceof Error ? error.message : 'Agent 对话搜索失败';
        // 可恢复性由抛出点决定：配额耗尽这类错误重试 100% 失败，
        // 前端据此不展示重试入口。
        const recoverable = admissionLeaseLost || resolveRecoverable(error, code);

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
      } finally {
        stopHeartbeat();
        requestSignal?.removeEventListener('abort', abortFromRequest);
        activeRunLease?.stopAutoRenew();
        sessionLease?.stopAutoRenew();
        await Promise.allSettled([
          activeRunLease?.release(),
          sessionLease?.release(),
        ]);
      }
    },
    cancel() {
      streamCancelled = true;
      runAbortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...(ownerContext.setCookie ? { 'Set-Cookie': ownerContext.setCookie } : {}),
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

function admissionErrorResponse(error: unknown, setCookie?: string): Response {
  const cookieHeader: Record<string, string> = {};
  if (setCookie) {
    cookieHeader['Set-Cookie'] = setCookie;
  }
  if (error instanceof ProviderSchedulerError) {
    const status = error.kind === 'busy' || error.kind === 'blocked' ? 429 : 503;
    logger.warn('Agent admission rejected by provider scheduler', {
      kind: error.kind,
      providerCategory: error.providerCategory,
      retryAfterMs: error.retryAfterMs,
    });
    return jsonResponse(
      { error: status === 429 ? '当前请求较多，请稍后重试' : '服务暂时不可用' },
      status,
      {
        'Retry-After': String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
        ...cookieHeader,
      }
    );
  }

  if (error instanceof Error && error.name === 'AbortError') {
    return jsonResponse({ error: 'Request aborted' }, 499, cookieHeader);
  }

  logger.error('Agent admission failed', {
    error: error instanceof Error ? error.message : String(error),
  });
  return jsonResponse(
    { error: '服务暂时不可用' },
    503,
    { 'Retry-After': '30', ...cookieHeader }
  );
}

function sessionExpiredResponse(setCookie?: string): Response {
  const event = {
    type: 'error',
    message: '会话已过期，请重新发起搜索',
    code: 'SESSION_EXPIRED',
    recoverable: false,
  };
  return new Response(`data: ${JSON.stringify(event)}\n\n`, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...(setCookie ? { 'Set-Cookie': setCookie } : {}),
    },
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
