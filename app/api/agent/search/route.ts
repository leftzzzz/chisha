/**
 * Agent 搜索 API 端点
 * POST /api/agent/search
 *
 * 使用 Vercel AI SDK 实现 Agent 自主搜索餐厅
 * 返回 SSE 流式响应，实时反馈搜索进度
 */

import { streamText, tool, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { z } from 'zod';
import type { Location, Restaurant } from '@/types';
import { amapPoiSearch } from '@/lib/amap';
import { logger } from '@/lib/logger';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

// 环境变量
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o';

// Agent 配置
const MAX_ROUNDS = 5; // 最大搜索轮数
const TARGET_COUNT = 8; // 目标餐厅数量
const EARLY_STOP_COUNT = 16; // 达到此数量后可提前结束

// 创建 OpenAI Compatible Provider（使用 Chat Completions API）
const provider = createOpenAICompatible({
  name: 'dashscope',
  apiKey: OPENAI_API_KEY,
  baseURL: OPENAI_BASE_URL,
});

// 获取模型实例
const getModel = () => provider.chatModel(OPENAI_MODEL);

// 请求验证
const AgentSearchRequestSchema = z.object({
  query: z.string().min(1).max(500),
  location: z.object({
    lat: z.number(),
    lng: z.number(),
    address: z.string().optional(),
  }),
});

// Agent 系统提示词
const AGENT_SYSTEM_PROMPT = `你是餐厅搜索助手。根据用户需求搜索餐厅。

示例1：
用户：想吃火锅
你应该：search_restaurants(keywords=["火锅"])

示例2：
用户：想吃日料
你应该：search_restaurants(keywords=["日料"])

示例3：
用户：约会吃什么好
你应该：search_restaurants(keywords=["西餐", "日料"])

示例4：
用户：附近有什么吃的
你应该：search_restaurants(keywords=["餐厅", "美食"])

规则：用户明确说要什么就搜什么，不要自作主张改成别的类型。`;

/**
 * SSE 事件类型定义
 */
type AgentEvent =
  | { type: 'thinking'; message: string }
  | { type: 'searching'; keywords: string[]; round: number }
  | { type: 'search_result'; found: number; total: number; restaurants: Array<{ id: string; name: string; cuisineType: string; distance?: number }> }
  | { type: 'filtering'; message: string; total: number }
  | { type: 'done'; restaurants: Restaurant[]; candidates: Restaurant[] }
  | { type: 'error'; message: string };

/**
 * 发送 SSE 事件
 */
function sendEvent(controller: ReadableStreamDefaultController, event: AgentEvent) {
  const data = JSON.stringify(event);
  controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
}

export async function POST(request: Request) {
  // 限流检查
  const ip = getClientIP(request);
  const rateLimitResult = rateLimit(ip, 3, 60 * 1000);

  if (!rateLimitResult.success) {
    return new Response(
      JSON.stringify({ error: '请求过于频繁，请稍后再试' }),
      { status: 429, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // 检查 API Key
  if (!OPENAI_API_KEY) {
    return new Response(
      JSON.stringify({ error: 'OpenAI API key is not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let requestData: { query: string; location: Location };

  try {
    const body = await request.json();
    const validation = AgentSearchRequestSchema.safeParse(body);

    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request parameters', details: validation.error.errors }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    requestData = validation.data;
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const { query, location } = requestData;
  logger.info('Agent search started', { query, location });

  // 请求级别的状态（避免 serverless 环境下的状态污染）
  const searchState = {
    allFoundRestaurants: [] as Restaurant[],
    searchRound: 0,
  };

  // 创建 SSE 流
  const stream = new ReadableStream({
    async start(controller) {
      try {
        // 发送开始事件
        sendEvent(controller, { type: 'thinking', message: '正在分析您的需求...' });

        // 使用 Vercel AI SDK（Chat Completions API）
        // 注意：此 API 不支持系统提示词，所有内容放在用户消息中
        const result = await streamText({
          model: getModel(),
          prompt: `${AGENT_SYSTEM_PROMPT}

---
用户位置：${location.address || `${location.lat}, ${location.lng}`}
用户需求：${query}

请立即调用 search_restaurants 工具搜索餐厅。`,
          tools: {
            // 搜索餐厅工具
            search_restaurants: tool({
              description: `搜索指定条件的餐厅。可多次调用搜索不同类型，结果会累积去重。`,
              inputSchema: z.object({
                keywords: z.array(z.string()).describe('搜索关键词，如 ["川菜", "火锅"]'),
                radius: z.number().default(2000).describe('搜索半径（米）'),
                poiType: z.string().optional().describe('高德POI类型代码'),
              }),
              execute: async ({ keywords, radius, poiType }: { keywords: string[]; radius: number; poiType?: string }) => {
                searchState.searchRound++;

                if (searchState.searchRound > MAX_ROUNDS) {
                  return {
                    success: false,
                    message: '已达到最大搜索轮数，请调用 finish_search',
                    totalFound: searchState.allFoundRestaurants.length,
                  };
                }

                // 发送搜索中事件
                sendEvent(controller, {
                  type: 'searching',
                  keywords,
                  round: searchState.searchRound,
                });

                logger.info('Agent searching', {
                  round: searchState.searchRound,
                  keywords,
                  radius,
                  poiType,
                });

                try {
                  const restaurants = await amapPoiSearch(keywords, location, radius, poiType);

                  // 去重合并
                  for (const r of restaurants) {
                    const exists = searchState.allFoundRestaurants.some(
                      existing =>
                        existing.name === r.name &&
                        Math.abs(existing.location.lat - r.location.lat) < 0.001 &&
                        Math.abs(existing.location.lng - r.location.lng) < 0.001
                    );
                    if (!exists) {
                      searchState.allFoundRestaurants.push(r);
                    }
                  }

                  // 发送搜索结果事件（带上所有已找到的餐厅）
                  sendEvent(controller, {
                    type: 'search_result',
                    found: restaurants.length,
                    total: searchState.allFoundRestaurants.length,
                    restaurants: searchState.allFoundRestaurants.map(r => ({
                      id: r.id,
                      name: r.name,
                      cuisineType: r.cuisineType,
                      distance: r.distance,
                    })),
                  });

                  return {
                    success: true,
                    found: restaurants.length,
                    totalFound: searchState.allFoundRestaurants.length,
                    restaurants: restaurants.map(r => ({
                      id: r.id,
                      name: r.name,
                      cuisineType: r.cuisineType,
                      distance: r.distance,
                      address: r.address,
                    })),
                    message:
                      restaurants.length > 0
                        ? `找到 ${restaurants.length} 家，累计 ${searchState.allFoundRestaurants.length} 家`
                        : '未找到，建议换关键词或扩大范围',
                    // 提前结束提示：达到足够数量时建议结束搜索
                    shouldFinish: searchState.allFoundRestaurants.length >= EARLY_STOP_COUNT,
                    finishHint: searchState.allFoundRestaurants.length >= EARLY_STOP_COUNT
                      ? `已找到 ${searchState.allFoundRestaurants.length} 家餐厅，数量充足，请立即调用 finish_search 完成搜索`
                      : undefined,
                  };
                } catch (error) {
                  logger.error('Search tool error', { error });
                  return {
                    success: false,
                    message: `搜索失败: ${error instanceof Error ? error.message : '未知错误'}`,
                    totalFound: searchState.allFoundRestaurants.length,
                  };
                }
              },
            }),

            // 完成搜索
            finish_search: tool({
              description: `搜索完成，从已找到的餐厅中选择最符合用户需求的${TARGET_COUNT}家。必须根据用户的具体需求（如想吃火锅就选火锅店）选择，不要只按距离选择。`,
              inputSchema: z.object({
                selectedIds: z.array(z.string()).max(TARGET_COUNT).describe('选中的餐厅ID列表，必须是最符合用户需求的餐厅'),
                reasoning: z.string().describe('选择理由，说明为什么这些餐厅最符合用户需求'),
              }),
              execute: async ({ selectedIds, reasoning }: { selectedIds: string[]; reasoning: string }) => {
                logger.info('Agent finishing', {
                  selectedIds,
                  reasoning,
                  totalFound: searchState.allFoundRestaurants.length,
                });

                // 发送筛选中事件（不使用thinking，避免进度条回退）
                sendEvent(controller, {
                  type: 'filtering',
                  message: '正在筛选最合适的餐厅...',
                  total: searchState.allFoundRestaurants.length
                });

                // 根据 ID 筛选
                let selected = searchState.allFoundRestaurants.filter(r =>
                  selectedIds.includes(r.id)
                );

                // 补充不足的
                if (selected.length < TARGET_COUNT && searchState.allFoundRestaurants.length > 0) {
                  const remaining = searchState.allFoundRestaurants
                    .filter(r => !selectedIds.includes(r.id))
                    .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

                  while (selected.length < TARGET_COUNT && remaining.length > 0) {
                    selected.push(remaining.shift()!);
                  }
                }

                // 如果没有选中任何，返回所有（按距离排序）
                if (selected.length === 0 && searchState.allFoundRestaurants.length > 0) {
                  selected = searchState.allFoundRestaurants
                    .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity))
                    .slice(0, TARGET_COUNT);
                }

                // 获取候补餐厅（所有搜索到但没被选中的）
                const selectedIdSet = new Set(selected.map(r => r.id));
                const candidates = searchState.allFoundRestaurants
                  .filter(r => !selectedIdSet.has(r.id))
                  .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));

                // 发送完成事件（包含选中和候补）
                sendEvent(controller, { type: 'done', restaurants: selected, candidates });

                return {
                  success: true,
                  count: selected.length,
                  candidateCount: candidates.length,
                };
              },
            }),
          },
          stopWhen: stepCountIs(MAX_ROUNDS + 2),
        });

        // 等待完成
        await result.text;

        // 如果 Agent 没有调用 finish_search，手动返回结果
        if (searchState.allFoundRestaurants.length > 0) {
          const sorted = searchState.allFoundRestaurants
            .sort((a, b) => (a.distance || Infinity) - (b.distance || Infinity));
          const selected = sorted.slice(0, TARGET_COUNT);
          const candidates = sorted.slice(TARGET_COUNT);

          // 检查是否已经发送过 done 事件（通过判断 searchRound 是否有变化来估计）
          sendEvent(controller, { type: 'done', restaurants: selected, candidates });
        } else {
          sendEvent(controller, { type: 'error', message: '未找到符合条件的餐厅' });
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

// 只允许 POST
export async function GET() {
  return new Response(JSON.stringify({ error: 'Method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json' },
  });
}
