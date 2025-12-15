/**
 * useRestaurantSearch - 餐厅搜索 Hook
 *
 * 使用 Agent API 执行智能搜索:
 * 1. 调用 /api/agent/search (SSE 流式)
 * 2. 实时更新搜索进度
 * 3. 更新应用状态
 *
 * 特性:
 * - Agent 自主决策搜索策略
 * - 实时进度反馈
 * - 多轮搜索自动合并
 * - 智能筛选推荐
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { Location } from '@/types';
import { agentSearch, APIError, SearchResultRestaurant } from '@/lib/api';
import { useAppState } from './useAppState';

/**
 * 搜索进度状态
 */
export interface SearchProgress {
  status: 'idle' | 'thinking' | 'searching' | 'filtering' | 'done' | 'error';
  message: string;
  currentKeywords?: string[];
  round?: number;
  found?: number;
  total?: number;
  /** 已搜索到的餐厅列表（用于实时展示） */
  foundRestaurants?: SearchResultRestaurant[];
}

/**
 * useRestaurantSearch Hook 返回值
 */
export interface UseRestaurantSearchReturn {
  isSearching: boolean;
  progress: SearchProgress;
  search: (query: string, location: Location, onError?: (errorCode: string) => void) => Promise<void>;
}

/**
 * useRestaurantSearch Hook
 *
 * 执行 Agent 智能搜索
 *
 * @returns 搜索状态、进度和搜索方法
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const { isSearching, progress, search } = useRestaurantSearch();
 *
 *   return (
 *     <div>
 *       {isSearching && (
 *         <LoadingSteps progress={progress} />
 *       )}
 *       <button onClick={() => search(query, location)}>
 *         搜索
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRestaurantSearch(): UseRestaurantSearchReturn {
  const {
    setStep,
    setRestaurantsWithCandidates,
    setError,
  } = useAppState();

  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress>({
    status: 'idle',
    message: '',
  });

  // 用于取消上一个搜索请求
  const abortControllerRef = useRef<AbortController | null>(null);

  /**
   * 执行 Agent 搜索
   */
  const search = useCallback(
    async (query: string, location: Location, onError?: (errorCode: string) => void) => {
      // 验证输入
      if (!query.trim()) {
        setError('请输入您想吃什么');
        return;
      }

      if (!location || !location.lat || !location.lng) {
        setError('请提供位置信息');
        return;
      }

      // 取消上一个正在进行的搜索请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsSearching(true);
      setStep('SEARCHING');
      setError(null);

      // 初始化进度
      setProgress({
        status: 'thinking',
        message: '正在分析您的需求...',
      });

      try {
        const { restaurants, candidates } = await agentSearch(query, location, {
          onThinking: (message) => {
            setProgress({
              status: 'thinking',
              message,
            });
          },

          onSearching: (keywords, round) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `正在搜索「${keywords.join('、')}」...`,
              currentKeywords: keywords,
              round,
            }));
          },

          onSearchResult: (found, total, foundRestaurants) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: found > 0
                ? `已找到 ${total} 家餐厅，继续搜索...`
                : `暂未找到，尝试其他类型...`,
              found,
              total,
              foundRestaurants,
            }));
          },

          onFiltering: (message, total) => {
            setProgress(prev => ({
              ...prev,
              status: 'filtering',
              message,
              total,
            }));
          },

          onDone: () => {
            // done 事件现在由 filtering 事件替代进度更新
          },

          onError: (message) => {
            setProgress({
              status: 'error',
              message,
            });
          },
        }, abortController.signal);

        // 搜索完成
        const totalFound = restaurants.length + candidates.length;
        setProgress({
          status: 'done',
          message: `找到 ${restaurants.length} 家推荐餐厅${candidates.length > 0 ? `，${candidates.length} 家候补` : ''}`,
          total: totalFound,
        });

        // 直接使用后端返回的选中餐厅和候补餐厅
        setRestaurantsWithCandidates(restaurants, candidates);
        setStep('READY');

      } catch (error) {
        // 如果是请求被取消，不显示错误
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Search request was cancelled');
          return;
        }

        console.error('Agent search error:', error);

        const errorCode = error instanceof APIError ? (error.code || 'UNKNOWN_ERROR') : 'UNKNOWN_ERROR';
        const errorMessage = error instanceof Error ? error.message : '搜索失败，请重试';

        setProgress({
          status: 'error',
          message: errorMessage,
        });

        setError(errorMessage);
        onError?.(errorCode);
        setStep('INPUT');

      } finally {
        setIsSearching(false);
        // 清理 AbortController 引用
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [setStep, setRestaurantsWithCandidates, setError]
  );

  return {
    isSearching,
    progress,
    search,
  };
}
