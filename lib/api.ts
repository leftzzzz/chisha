/**
 * API Client - 前端 API 调用封装
 *
 * 提供统一的 API 调用接口,包括:
 * - 错误处理和转换
 * - 超时控制
 * - 响应数据验证
 * - 重试逻辑
 * - Agent SSE 流式调用
 *
 * 所有 API 调用都应通过这个文件进行
 */

import {
  Location,
  ParsedRequirement,
  Restaurant,
  UnderstandRequest,
  UnderstandResponse,
  SearchRequest,
  SearchResponse,
  GeocodeRequest,
  GeocodeResponse,
  ReverseGeocodeRequest,
  ReverseGeocodeResponse,
} from '@/types';

/**
 * 搜索结果中的简要餐厅信息
 */
export interface SearchResultRestaurant {
  id: string;
  name: string;
  cuisineType: string;
  distance?: number;
}

/**
 * Agent SSE 事件类型
 */
export type AgentEvent =
  | { type: 'thinking'; message: string }
  | { type: 'searching'; keywords: string[]; round: number }
  | { type: 'search_result'; found: number; total: number; restaurants: SearchResultRestaurant[] }
  | { type: 'filtering'; message: string; total: number }
  | { type: 'done'; restaurants: Restaurant[]; candidates: Restaurant[] }
  | { type: 'error'; message: string };

/**
 * Agent 搜索回调
 */
export interface AgentSearchCallbacks {
  onThinking?: (message: string) => void;
  onSearching?: (keywords: string[], round: number) => void;
  onSearchResult?: (found: number, total: number, restaurants: SearchResultRestaurant[]) => void;
  onFiltering?: (message: string, total: number) => void;
  onDone?: (restaurants: Restaurant[], candidates: Restaurant[]) => void;
  onError?: (message: string) => void;
}

/**
 * API 错误类
 */
export class APIError extends Error {
  constructor(
    message: string,
    public code?: string,
    public statusCode?: number
  ) {
    super(message);
    this.name = 'APIError';
  }
}

/**
 * API 配置
 */
const API_CONFIG = {
  timeout: 30000, // 30秒超时
  retryCount: 2, // 重试次数
  retryDelay: 1000, // 重试延迟(毫秒)
};

/**
 * 通用 fetch 封装
 *
 * @param url - API 端点
 * @param options - fetch 选项
 * @param retryCount - 剩余重试次数
 * @returns 响应数据
 * @throws {APIError} API 调用失败
 */
async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  retryCount = API_CONFIG.retryCount
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.timeout);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeoutId);

    // 解析响应
    const data = await response.json();

    // 检查响应状态
    if (!response.ok) {
      // 服务器返回的错误信息
      const errorMessage = data.error || data.message || '请求失败';
      throw new APIError(errorMessage, data.code, response.status);
    }

    return data as T;
  } catch (error) {
    clearTimeout(timeoutId);

    // 网络错误或超时
    if (error instanceof TypeError || (error instanceof Error && error.name === 'AbortError')) {
      // 可以重试的错误
      if (retryCount > 0) {
        await new Promise((resolve) => setTimeout(resolve, API_CONFIG.retryDelay));
        return fetchWithTimeout<T>(url, options, retryCount - 1);
      }

      const message =
        error instanceof Error && error.name === 'AbortError'
          ? '请求超时,请检查网络连接后重试'
          : '网络连接失败,请检查网络后重试';
      throw new APIError(message, 'NETWORK_ERROR');
    }

    // API 错误直接抛出
    if (error instanceof APIError) {
      throw error;
    }

    // 其他未知错误
    throw new APIError('未知错误,请稍后重试', 'UNKNOWN_ERROR');
  }
}

/**
 * 理解用户需求
 *
 * 调用 LLM 解析用户输入,提取关键词、菜系类型、价格范围等
 *
 * @param query - 用户输入的需求描述
 * @param location - 用户当前位置(可选)
 * @returns 解析后的需求
 * @throws {APIError} 解析失败
 *
 * @example
 * ```ts
 * const parsed = await understand('我想吃便宜的川菜', { lat: 39.9, lng: 116.4 });
 * console.log(parsed.keywords); // ['川菜']
 * ```
 */
export async function understand(
  query: string,
  location?: Location
): Promise<ParsedRequirement> {
  try {
    const requestBody: UnderstandRequest = {
      query,
      location,
    };

    const response = await fetchWithTimeout<{ success: boolean; data: UnderstandResponse }>(
      '/api/understand',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    return response.data.parsed;
  } catch (error) {
    if (error instanceof APIError) {
      // 添加更友好的错误信息
      throw new APIError(
        `需求理解失败: ${error.message}`,
        error.code,
        error.statusCode
      );
    }
    throw error;
  }
}

/**
 * 搜索餐厅
 *
 * 根据关键词、位置等条件搜索餐厅
 *
 * @param params - 搜索参数
 * @returns 餐厅列表
 * @throws {APIError} 搜索失败
 *
 * @example
 * ```ts
 * const restaurants = await searchRestaurants({
 *   keywords: ['火锅'],
 *   location: { lat: 39.9, lng: 116.4 },
 *   distance: 2000,
 * });
 * ```
 */
export async function searchRestaurants(
  params: SearchRequest
): Promise<Restaurant[]> {
  try {
    const response = await fetchWithTimeout<{ success: boolean; data: SearchResponse }>(
      '/api/search',
      {
        method: 'POST',
        body: JSON.stringify(params),
      }
    );

    // 验证返回的餐厅数据
    if (!Array.isArray(response.data.restaurants)) {
      throw new APIError('搜索结果格式错误', 'INVALID_RESPONSE');
    }

    if (response.data.restaurants.length === 0) {
      throw new APIError(
        '附近没有找到符合条件的餐厅,试试调整搜索条件?',
        'NO_RESULTS'
      );
    }

    return response.data.restaurants;
  } catch (error) {
    if (error instanceof APIError) {
      // 添加更友好的错误信息
      if (error.code !== 'NO_RESULTS') {
        throw new APIError(
          `餐厅搜索失败: ${error.message}`,
          error.code,
          error.statusCode
        );
      }
    }
    throw error;
  }
}

/**
 * 地理编码 (地址 -> 坐标)
 *
 * 将地址转换为经纬度坐标
 *
 * @param address - 地址描述
 * @param city - 城市名称(可选,用于提高准确性)
 * @returns 地理位置
 * @throws {APIError} 编码失败
 *
 * @example
 * ```ts
 * const location = await geocode('天安门', '北京市');
 * console.log(location); // { lat: 39.9, lng: 116.4, address: '...' }
 * ```
 */
export async function geocode(address: string, city?: string): Promise<Location> {
  try {
    const requestBody: GeocodeRequest = {
      address,
      city,
    };

    const response = await fetchWithTimeout<{ success: boolean; data: GeocodeResponse }>(
      '/api/geocode',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    return response.data.location;
  } catch (error) {
    if (error instanceof APIError) {
      throw new APIError(
        `地址解析失败: ${error.message}`,
        error.code,
        error.statusCode
      );
    }
    throw error;
  }
}

/**
 * 逆向地理编码 (坐标 -> 地址)
 *
 * 将经纬度坐标转换为地址描述
 *
 * @param location - 地理位置
 * @returns 地址描述
 * @throws {APIError} 编码失败
 *
 * @example
 * ```ts
 * const address = await reverseGeocode({ lat: 39.9, lng: 116.4 });
 * console.log(address); // '北京市东城区...'
 * ```
 */
export async function reverseGeocode(location: Location): Promise<string> {
  try {
    const requestBody: ReverseGeocodeRequest = {
      location,
    };

    const response = await fetchWithTimeout<{ success: boolean; data: ReverseGeocodeResponse }>(
      '/api/geocode/reverse',
      {
        method: 'POST',
        body: JSON.stringify(requestBody),
      }
    );

    return response.data.address || response.data.formattedAddress || '未知地址';
  } catch (error) {
    if (error instanceof APIError) {
      throw new APIError(
        `位置解析失败: ${error.message}`,
        error.code,
        error.statusCode
      );
    }
    throw error;
  }
}

/**
 * Agent 搜索结果
 */
export interface AgentSearchResult {
  restaurants: Restaurant[];
  candidates: Restaurant[];
}

/**
 * Agent 搜索（流式）
 *
 * 使用 Agent 进行智能餐厅搜索，通过 SSE 实时返回进度
 *
 * @param query - 用户查询
 * @param location - 用户位置
 * @param callbacks - 事件回调
 * @param signal - AbortSignal 用于取消请求
 * @returns Promise，完成时返回选中餐厅和候补餐厅
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * const { restaurants, candidates } = await agentSearch('想吃辣的', location, {
 *   onThinking: (msg) => console.log('思考:', msg),
 *   onSearching: (kw, round) => console.log(`第${round}轮搜索:`, kw),
 *   onSearchResult: (found, total) => console.log(`找到 ${found} 家，共 ${total} 家`),
 * }, controller.signal);
 * ```
 */
export async function agentSearch(
  query: string,
  location: Location,
  callbacks?: AgentSearchCallbacks,
  signal?: AbortSignal
): Promise<AgentSearchResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60秒超时

  // 如果传入了外部 signal，监听其 abort 事件
  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch('/api/agent/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, location }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new APIError(
        errorData.error || `Agent 搜索失败: ${response.status}`,
        'AGENT_ERROR',
        response.status
      );
    }

    if (!response.body) {
      throw new APIError('无法获取响应流', 'STREAM_ERROR');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: AgentSearchResult = { restaurants: [], candidates: [] };
    let hasReceivedDone = false;

    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // 解析 SSE 事件
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // 保留不完整的行

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const event: AgentEvent = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'thinking':
                callbacks?.onThinking?.(event.message);
                break;
              case 'searching':
                callbacks?.onSearching?.(event.keywords, event.round);
                break;
              case 'search_result':
                callbacks?.onSearchResult?.(event.found, event.total, event.restaurants);
                break;
              case 'filtering':
                callbacks?.onFiltering?.(event.message, event.total);
                break;
              case 'done':
                // 只处理第一个 done 事件
                if (!hasReceivedDone) {
                  hasReceivedDone = true;
                  result = {
                    restaurants: event.restaurants,
                    candidates: event.candidates || [],
                  };
                  callbacks?.onDone?.(event.restaurants, event.candidates || []);
                }
                break;
              case 'error':
                callbacks?.onError?.(event.message);
                throw new APIError(event.message, 'AGENT_ERROR');
            }
          } catch (e) {
            // 忽略解析错误，继续处理
            if (e instanceof APIError) throw e;
          }
        }
      }
    }

    if (result.restaurants.length === 0) {
      throw new APIError(
        '未找到符合条件的餐厅，试试调整搜索条件?',
        'NO_RESULTS'
      );
    }

    return result;
  } catch (error) {
    clearTimeout(timeoutId);

    if (error instanceof APIError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new APIError('搜索超时，请重试', 'TIMEOUT');
    }

    throw new APIError(
      error instanceof Error ? error.message : 'Agent 搜索失败',
      'AGENT_ERROR'
    );
  }
}

/**
 * 导出配置(用于测试)
 */
export { API_CONFIG };
