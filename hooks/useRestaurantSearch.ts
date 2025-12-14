/**
 * useRestaurantSearch - 餐厅搜索 Hook
 *
 * 执行完整的搜索流程:
 * 1. 调用 /api/understand 获取解析结果
 * 2. 调用 /api/search 获取餐厅列表
 * 3. 更新应用状态
 *
 * 特性:
 * - 自动状态转移
 * - 错误处理和恢复
 * - 支持重试
 * - 自动验证输入
 *
 * 使用方式:
 * ```tsx
 * const { isSearching, search } = useRestaurantSearch();
 *
 * const handleSearch = async () => {
 *   await search('我想吃川菜', location);
 * };
 * ```
 */

'use client';

import { useState, useCallback } from 'react';
import { Location, ParsedRequirement } from '@/types';
import { understand, searchRestaurants, APIError } from '@/lib/api';
import { useAppState } from './useAppState';

/**
 * useRestaurantSearch Hook 返回值
 */
export interface UseRestaurantSearchReturn {
  isSearching: boolean;
  search: (query: string, location: Location, onError?: (errorCode: string) => void) => Promise<void>;
}

/**
 * useRestaurantSearch Hook
 *
 * 执行餐厅搜索的 Hook
 *
 * @returns 搜索状态和搜索方法
 *
 * @example
 * ```tsx
 * function SearchButton() {
 *   const { state } = useAppState();
 *   const { isSearching, search } = useRestaurantSearch();
 *
 *   const handleSearch = async () => {
 *     if (!state.userQuery || !state.userLocation) {
 *       alert('请输入需求和位置');
 *       return;
 *     }
 *
 *     await search(state.userQuery, state.userLocation);
 *   };
 *
 *   return (
 *     <button onClick={handleSearch} disabled={isSearching}>
 *       {isSearching ? '搜索中...' : '开始搜索'}
 *     </button>
 *   );
 * }
 * ```
 */
export function useRestaurantSearch(): UseRestaurantSearchReturn {
  const {
    setStep,
    setParsedRequirement,
    setRestaurantsWithCandidates,
    setError,
  } = useAppState();

  const [isSearching, setIsSearching] = useState(false);

  /**
   * 执行搜索
   *
   * @param query - 用户查询
   * @param location - 用户位置
   * @param onError - 错误回调，用于触发弹窗显示
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

      setIsSearching(true);

      try {
        // ============ Step 1: 理解需求 ============
        setStep('UNDERSTANDING');
        setError(null);

        let parsed: ParsedRequirement;
        try {
          parsed = await understand(query, location);
          setParsedRequirement(parsed);

          // 验证解析结果
          if (!parsed.keywords || parsed.keywords.length === 0) {
            throw new APIError(
              'PARSE_FAILED',
              '无法理解您的需求,请换个说法试试'
            );
          }
        } catch (error) {
          const errorCode = error instanceof APIError ? (error.code || 'UNKNOWN_ERROR') : 'UNKNOWN_ERROR';
          setError(error instanceof Error ? error.message : '需求理解失败,请重试');
          onError?.(errorCode);
          setStep('INPUT');
          return;
        }

        // ============ Step 2: 搜索餐厅 ============
        setStep('SEARCHING');

        try {
          const restaurants = await searchRestaurants({
            keywords: parsed.keywords,
            location,
            distance: parsed.searchRadius,
            cuisineTypes: parsed.cuisineTypes,
            priceRange: parsed.priceRange,
            count: 16, // 请求 16 个餐厅，8个转盘 + 8个候补
            poiType: parsed.poiType, // 传递 LLM 返回的 POI 类型
          });

          // 验证结果数量
          if (restaurants.length < 3) {
            throw new APIError(
              'INSUFFICIENT_RESULTS',
              '找到的餐厅太少了,试试调整搜索条件?'
            );
          }

          // 分配到转盘和候补池
          const turntableRestaurants = restaurants.slice(0, 8);
          const candidateRestaurants = restaurants.slice(8);

          setRestaurantsWithCandidates(turntableRestaurants, candidateRestaurants);
          setStep('READY'); // 转移到转盘就绪状态
        } catch (error) {
          const errorCode = error instanceof APIError ? (error.code || 'UNKNOWN_ERROR') : 'UNKNOWN_ERROR';

          if (error instanceof APIError) {
            // 如果是没有结果,给出建议
            if (error.code === 'NO_RESULTS' || error.code === 'INSUFFICIENT_RESULTS') {
              const suggestions = generateSearchSuggestions(parsed);
              if (suggestions) {
                setError(`${error.message}\n\n建议:\n${suggestions}`);
              } else {
                setError(error.message);
              }
            } else {
              setError(error.message);
            }
          } else {
            setError('餐厅搜索失败,请重试');
          }

          // 触发错误弹窗
          onError?.(errorCode);
          setStep('INPUT');
          return;
        }
      } catch (error) {
        // 未预期的错误
        console.error('Search error:', error);
        setError('搜索过程中出现错误,请重试');
        onError?.('UNKNOWN_ERROR');
        setStep('INPUT');
      } finally {
        setIsSearching(false);
      }
    },
    [setStep, setParsedRequirement, setRestaurantsWithCandidates, setError]
  );

  return {
    isSearching,
    search,
  };
}

/**
 * 生成搜索建议
 *
 * 根据解析结果生成有用的建议
 *
 * @param parsed - 解析后的需求
 * @returns 建议文本
 */
function generateSearchSuggestions(parsed: ParsedRequirement): string {
  const suggestions: string[] = [];

  // 建议扩大搜索范围
  if (parsed.searchRadius < 5000) {
    suggestions.push('- 尝试扩大搜索范围(当前 ' + parsed.searchRadius + '米)');
  }

  // 建议简化搜索条件
  if (parsed.cuisineTypes && parsed.cuisineTypes.length > 2) {
    suggestions.push('- 减少菜系类型限制');
  }

  // 建议放宽价格范围
  if (parsed.priceRange) {
    if (parsed.priceRange.max && parsed.priceRange.max < 50) {
      suggestions.push('- 放宽价格限制(当前最高 ¥' + parsed.priceRange.max + ')');
    }
  }

  // 建议使用更通用的关键词
  if (parsed.keywords.length > 3) {
    suggestions.push('- 使用更简单的描述');
  }

  return suggestions.join('\n');
}
