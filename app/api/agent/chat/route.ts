/**
 * 多轮 Agent 搜索入口
 * POST /api/agent/chat
 *
 * SSE 是单向流：需要追问时发送 question/session_paused 后结束请求；
 * 用户回复通过 sessionId 发起新请求继续 Agent Loop。
 */

import { z } from 'zod';
import type { AgentEvent, AgentInput, SearchPlan } from '@/lib/agent/types';
import { getClarifyingQuestion, applyClarifyingAnswer } from '@/lib/agent/conversation';
import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';
import {
  appendAssistantMessage,
  appendUserMessage,
  createAgentSession,
  getAgentSession,
  getSessionQuery,
  saveAgentSession,
} from '@/lib/agent/session';
import { runSearchAgent } from '@/lib/agent/runtime';
import { amapPoiSearch, enrichRestaurantsWithAmapDetails } from '@/lib/amap';
import { logger } from '@/lib/logger';
import { getClientIP, rateLimit } from '@/lib/rateLimit';

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

export async function POST(request: Request) {
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
        let session = requestData.sessionId
          ? getAgentSession(requestData.sessionId)
          : createAgentSession(requestData.message, requestData.location);

        if (!session) {
          sendEvent(controller, {
            type: 'error',
            message: '会话已过期，请重新发起搜索',
          });
          controller.close();
          return;
        }

        if (requestData.sessionId) {
          appendUserMessage(session, requestData.message);
          applyClarifyingAnswer(session, requestData.message);
          sendEvent(controller, { type: 'session_resumed', sessionId: session.id });
        }

        const question = getClarifyingQuestion(
          requestData.message,
          requestData.preferenceSummary,
          session
        );

        if (question) {
          session.pendingQuestion = question;
          appendAssistantMessage(session, question.question);
          saveAgentSession(session);
          sendEvent(controller, {
            type: 'question',
            sessionId: session.id,
            question: question.question,
            options: question.options,
            allowFreeText: true,
          });
          sendEvent(controller, { type: 'session_paused', sessionId: session.id });
          controller.close();
          return;
        }

        const input: AgentInput = {
          query: getSessionQuery(session),
          location: requestData.location,
          preferenceSummary: mergeUserPreferenceSummaries([
            requestData.preferenceSummary,
            ...(requestData.groupPreferenceSummaries ?? []),
          ].filter((summary): summary is NonNullable<typeof requestData.preferenceSummary> => Boolean(summary))),
        };

        logger.info('Agent chat search started', {
          sessionId: session.id,
          query: input.query,
          location: input.location,
        });

        const result = await runSearchAgent(
          input,
          (event) => sendEvent(controller, event),
          async (plan: SearchPlan) => {
            const restaurants = await amapPoiSearch(plan.keywords, input.location, plan.radiusMeters, plan.poiType);
            return enrichRestaurantsWithAmapDetails(restaurants, 8);
          }
        );

        if (result.restaurants.length === 0 && result.candidates.length > 0) {
          const question = {
            reason: '候选餐厅通过了硬约束，但没有完全满足原始目标。',
            question: '没有找到完全匹配的餐厅，要先看看候补吗？',
            options: ['查看候补', '继续调整需求'],
            allowFreeText: true,
          };

          session.pendingQuestion = {
            reason: question.reason,
            question: question.question,
            options: question.options,
            allowFreeText: question.allowFreeText,
          };
          appendAssistantMessage(session, question.question);
          saveAgentSession(session);
          sendEvent(controller, {
            type: 'question',
            sessionId: session.id,
            question: question.question,
            options: question.options,
            allowFreeText: question.allowFreeText,
          });
          sendEvent(controller, { type: 'session_paused', sessionId: session.id });
          controller.close();
          return;
        }

        session.attempts = [];
        session.candidates = [];
        appendAssistantMessage(session, result.explanation);
        saveAgentSession(session);
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
