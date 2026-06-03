/**
 * 多轮 Agent 搜索入口
 * POST /api/agent/chat
 *
 * SSE 是单向流：需要追问时发送 question/session_paused 后结束请求；
 * 用户回复通过 sessionId 发起新请求继续 Agent Loop。
 */

import { z } from 'zod';
import type {
  AgentEvent,
  AgentInput,
  AgentSession,
  PendingQuestion,
  SearchPlan,
} from '@/lib/agent/types';
import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';
import {
  applyRuntimeStateToSessionAsync,
  appendAssistantMessageAsync,
  appendUserMessageAsync,
  createAgentSessionAsync,
  getAgentSessionAsync,
  saveAgentSessionAsync,
} from '@/lib/agent/session';
import { configureCloudflareAgentSessionStore } from '@/lib/agent/cloudflareSessionStore';
import { runSearchAgentV3 } from '@/lib/agent/runtimeV3';
import { amapPoiSearch, enrichRestaurantsWithAmapDetails } from '@/lib/amap';
import { logger } from '@/lib/logger';
import { osmSearch } from '@/lib/osm';
import { getClientIP, rateLimit } from '@/lib/rateLimit';

const AGENT_POI_PAGES_PER_SEARCH = parsePositiveInt(process.env.AGENT_POI_PAGES_PER_SEARCH, 2);
const AGENT_DETAIL_ENRICH_LIMIT = parsePositiveInt(process.env.AGENT_DETAIL_ENRICH_LIMIT, 6);

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

const AgentChatRequestSchema = z.object({
  message: z.string().min(1).max(500),
  location: LocationSchema,
  sessionId: z.string().optional(),
  preferenceSummary: PreferenceSummarySchema,
  groupPreferenceSummaries: z.array(PreferenceSummarySchema.unwrap()).optional(),
});

function sendEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  const data = JSON.stringify(event);
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

async function pauseSessionWithQuestion(
  controller: ReadableStreamDefaultController,
  session: AgentSession,
  question: PendingQuestion,
  resultState?: AgentInput['runtimeState']
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
    sessionId: session.id,
    question: question.question,
    options: question.options,
    allowFreeText: question.allowFreeText ?? true,
  });
  sendEvent(controller, { type: 'session_paused', sessionId: session.id });
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

  const ip = getClientIP(request);
  const rateLimitResult = rateLimit(ip, 6, 60 * 1000);

  if (!rateLimitResult.success) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
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
      try {
        const resumableSession = requestData.sessionId
          ? await getAgentSessionAsync(requestData.sessionId)
          : null;

        if (requestData.sessionId && !resumableSession) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
          });
          controller.close();
          return;
        }

        const shouldResumeSession = Boolean(resumableSession);
        let session = shouldResumeSession && resumableSession
          ? resumableSession
          : await createAgentSessionAsync(requestData.message, requestData.location);

        if (!session) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
          });
          controller.close();
          return;
        }

        if (shouldResumeSession) {
          await appendUserMessageAsync(session, requestData.message);
          sendEvent(controller, {
            type: 'session_resumed',
            sessionId: session.id,
          });
        }

        const previousLocation = session.location;
        session.location = requestData.location;

        const input: AgentInput = {
          query: requestData.message,
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
              return osmSearch(plan.keywords, input.location, plan.radiusMeters);
            }
          }
        );

        if (result.runtimeState) {
          await applyRuntimeStateToSessionAsync(session, result.runtimeState);
        }

        if (result.paused && result.question) {
          await pauseSessionWithQuestion(controller, session, result.question, result.runtimeState);
          return;
        }

        session.pendingQuestion = undefined;
        await appendAssistantMessageAsync(session, result.explanation);
        await saveAgentSessionAsync(session);
        sendSessionUpdated(controller, session);
        controller.close();
      } catch (error) {
        logger.error('Agent chat stream error', { error });
        sendEvent(controller, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Agent 对话搜索失败',
        });
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

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
