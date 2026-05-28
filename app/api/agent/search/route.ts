/**
 * Agent 搜索 API 端点
 * POST /api/agent/search
 *
 * 运行轻量 Agent Loop：
 * 1. 解析用户目标和硬约束
 * 2. 规划搜索策略
 * 3. 调用高德 POI 观察外部结果
 * 4. 确定性过滤、评分和策略调整
 * 5. 通过 SSE 返回兼容旧前端的事件和新增 Agent 事件
 */

import { z } from 'zod';
import type { AgentEvent, AgentInput, PendingQuestion, SearchPlan } from '@/lib/agent/types';
import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';
import { runSearchAgent } from '@/lib/agent/runtime';
import { runSearchAgentV2 } from '@/lib/agent/runtimeV2';
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
  question: PendingQuestion
) {
  const sessionId = `agent_search_${Date.now().toString(36)}`;
  sendEvent(controller, {
    type: 'question',
    sessionId,
    question: question.question,
    options: question.options,
    allowFreeText: question.allowFreeText ?? true,
  });
  sendEvent(controller, { type: 'session_paused', sessionId });
}

export async function POST(request: Request) {
  const ip = getClientIP(request);
  const rateLimitResult = rateLimit(ip, 3, 60 * 1000);

  if (!rateLimitResult.success) {
    return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
  }

  let input: AgentInput;

  try {
    const body: unknown = await request.json();
    const validation = AgentSearchRequestSchema.safeParse(body);

    if (!validation.success) {
      return jsonResponse(
        { error: 'Invalid request parameters', details: validation.error.errors },
        400
      );
    }

    const summaries = [
      validation.data.preferenceSummary,
      ...(validation.data.groupPreferenceSummaries ?? []),
    ].filter((summary): summary is NonNullable<typeof validation.data.preferenceSummary> => Boolean(summary));

    input = {
      query: validation.data.query,
      location: validation.data.location,
      preferenceSummary: mergeUserPreferenceSummaries(summaries),
    };
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  logger.info('Agent search started', {
    query: input.query,
    location: input.location,
    hasPreferenceSummary: Boolean(input.preferenceSummary),
  });

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const runAgent = process.env.AGENT_SUPERVISOR_V2 === 'true'
          ? runSearchAgentV2
          : runSearchAgent;
        const result = await runAgent(
          input,
          (event) => sendEvent(controller, event),
          async (plan: SearchPlan) => {
            const restaurants = await amapPoiSearch(plan.keywords, input.location, plan.radiusMeters, plan.poiType, 3);
            return enrichRestaurantsWithAmapDetails(restaurants, 12);
          }
        );

        if (result.paused && result.question) {
          sendQuestionEvent(controller, result.question);
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
