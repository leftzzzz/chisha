/**
 * Agent 搜索 API 端点
 * POST /api/agent/search
 *
 * 运行 V3 Supervisor-controlled Agent Loop：
 * 1. SearchSupervisorAgent 维护目标并选择 AgentAction
 * 2. Runtime 执行 search/ask_user/finish
 * 3. FinalGuard 统一控制主推荐准入
 * 4. 通过 SSE 返回 action、observation 和推荐事件
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
  applyRuntimeStateToSession,
  appendAssistantMessage,
  appendUserMessage,
  createAgentSession,
  getAgentSession,
  saveAgentSession,
} from '@/lib/agent/session';
import { runSearchAgentV3 } from '@/lib/agent/runtimeV3';
import { amapPoiSearch, enrichRestaurantsWithAmapDetails } from '@/lib/amap';
import { logger } from '@/lib/logger';
import { getClientIP, rateLimit } from '@/lib/rateLimit';

const AgentSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
  sessionId: z.string().optional(),
  preferenceSummary: z.object({
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
  }).optional(),
  groupPreferenceSummaries: z.array(z.object({
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
  })).optional(),
});

function sendEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  const data = JSON.stringify(event);
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

function sendQuestionEvent(
  controller: ReadableStreamDefaultController,
  session: AgentSession,
  question: PendingQuestion,
  resultState?: AgentInput['runtimeState']
) {
  if (resultState) {
    applyRuntimeStateToSession(session, {
      ...resultState,
      pendingQuestion: question,
    });
  }
  session.pendingQuestion = question;
  appendAssistantMessage(session, question.question);
  saveAgentSession(session);
  sendEvent(controller, {
    type: 'question',
    sessionId: session.id,
    question: question.question,
    options: question.options,
    allowFreeText: question.allowFreeText ?? true,
  });
  sendEvent(controller, { type: 'session_paused', sessionId: session.id });
}

function sendSessionUpdated(
  controller: ReadableStreamDefaultController,
  session: AgentSession
) {
  sendEvent(controller, {
    type: 'session_updated',
    sessionId: session.id,
  });
}

export async function POST(request: Request) {
  const ip = getClientIP(request);
  const rateLimitResult = rateLimit(ip, 3, 60 * 1000);

  if (!rateLimitResult.success) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  let requestData: z.infer<typeof AgentSearchRequestSchema>;

  try {
    const body: unknown = await request.json();
    const validation = AgentSearchRequestSchema.safeParse(body);

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

  logger.info('Agent search started', {
    query: requestData.query,
    location: requestData.location,
    hasPreferenceSummary: Boolean(requestData.preferenceSummary),
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const resumableSession = requestData.sessionId
          ? getAgentSession(requestData.sessionId)
          : null;

        if (requestData.sessionId && !resumableSession) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
          });
          controller.close();
          return;
        }

        const shouldResumeSession = Boolean(resumableSession?.pendingQuestion);
        const session = shouldResumeSession && resumableSession
          ? resumableSession
          : createAgentSession(requestData.query, requestData.location);

        if (!session) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
          });
          controller.close();
          return;
        }

        if (shouldResumeSession) {
          appendUserMessage(session, requestData.query);

          sendEvent(controller, {
            type: 'session_resumed',
            sessionId: session.id,
          });
        }

        const summaries = [
          requestData.preferenceSummary,
          ...(requestData.groupPreferenceSummaries ?? []),
        ].filter((summary): summary is NonNullable<typeof requestData.preferenceSummary> => Boolean(summary));
        const input: AgentInput = {
          query: requestData.query,
          location: requestData.location,
          messages: session.messages,
          preferenceSummary: mergeUserPreferenceSummaries(summaries),
          runtimeState: {
            goal: session.goal,
            attempts: session.attempts,
            candidates: session.candidates,
            actions: session.actions,
            observations: session.observations,
            pendingQuestion: session.pendingQuestion,
          },
        };
        const result = await runSearchAgentV3(
          input,
          (event) => sendEvent(controller, event),
          async (plan: SearchPlan) => {
            const restaurants = await amapPoiSearch(
              plan.keywords,
              input.location,
              plan.radiusMeters,
              plan.poiType,
              3,
              { preferProvidedPoiType: Boolean(plan.poiType) }
            );
            return enrichRestaurantsWithAmapDetails(restaurants, 12);
          }
        );

        if (result.runtimeState) {
          applyRuntimeStateToSession(session, result.runtimeState);
        }

        if (result.paused && result.question) {
          sendQuestionEvent(controller, session, result.question, result.runtimeState);
        }

        if (!result.paused) {
          session.pendingQuestion = undefined;
          appendAssistantMessage(session, result.explanation);
          saveAgentSession(session);
          sendSessionUpdated(controller, session);
        }

        controller.close();
      } catch (error) {
        logger.error('Agent stream error', { error });
        sendEvent(controller, {
          type: 'error',
          message: error instanceof Error ? error.message : 'Agent 搜索失败',
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
