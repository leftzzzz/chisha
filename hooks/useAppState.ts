/**
 * useAppState - 应用状态 Hook
 *
 * 提供便捷的状态管理方法,封装 dispatch 调用
 *
 * 特性:
 * - 提供类型安全的状态访问
 * - 提供便利方法简化 dispatch 调用
 * - 自动处理状态转移逻辑
 *
 * 使用方式:
 * ```tsx
 * const {
 *   state,
 *   setQuery,
 *   setLocation,
 *   setStep,
 *   setRestaurants,
 *   setSelectedIndex,
 *   setError,
 *   reset,
 * } = useAppState();
 * ```
 */

'use client';

import { useCallback } from 'react';
import { useAppContext } from '@/context/AppContext';
import { AppStep, Location, ParsedRequirement, Restaurant, CustomOption } from '@/types';

/**
 * useAppState Hook 返回值
 */
export interface UseAppStateReturn {
  // 当前状态
  state: ReturnType<typeof useAppContext>['state'];

  // 便利方法
  setQuery: (query: string) => void;
  setLocation: (location: Location | null) => void;
  setStep: (step: AppStep) => void;
  setParsedRequirement: (parsed: ParsedRequirement) => void;
  setRestaurants: (restaurants: Restaurant[]) => void;
  setRestaurantsWithCandidates: (
    turntable: Restaurant[],
    candidates: Restaurant[],
    explanation?: string,
    unmetConstraints?: string[]
  ) => void;
  setSelectedIndex: (index: number) => void;
  setError: (error: string | null) => void;
  deleteRestaurant: (index: number) => void;
  restoreRestaurant: (index: number) => void;
  addFromCandidates: (index: number) => void;
  removeToCandidates: (index: number) => void;
  addRestaurant: (restaurant: Restaurant) => void;
  addCustomOption: (option: CustomOption) => void;
  removeCustomOption: (id: string) => void;
  reset: () => void;

  // 原始 dispatch (用于高级用例)
  dispatch: ReturnType<typeof useAppContext>['dispatch'];
}

/**
 * useAppState Hook
 *
 * 获取应用状态和便利的状态更新方法
 *
 * @returns 状态和更新方法
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, setQuery, setStep } = useAppState();
 *
 *   const handleSubmit = () => {
 *     setStep('UNDERSTANDING');
 *   };
 *
 *   return (
 *     <div>
 *       <input
 *         value={state.userQuery}
 *         onChange={(e) => setQuery(e.target.value)}
 *       />
 *       <button onClick={handleSubmit}>搜索</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useAppState(): UseAppStateReturn {
  const { state, dispatch } = useAppContext();

  /**
   * 设置用户查询
   */
  const setQuery = useCallback(
    (query: string) => {
      dispatch({ type: 'SET_QUERY', payload: query });
    },
    [dispatch]
  );

  /**
   * 设置用户位置
   */
  const setLocation = useCallback(
    (location: Location | null) => {
      dispatch({ type: 'SET_LOCATION', payload: location });
    },
    [dispatch]
  );

  /**
   * 设置应用步骤
   */
  const setStep = useCallback(
    (step: AppStep) => {
      dispatch({ type: 'SET_STEP', payload: step });
    },
    [dispatch]
  );

  /**
   * 设置解析后的需求
   */
  const setParsedRequirement = useCallback(
    (parsed: ParsedRequirement) => {
      dispatch({ type: 'SET_PARSED_REQUIREMENT', payload: parsed });
    },
    [dispatch]
  );

  /**
   * 设置餐厅列表
   */
  const setRestaurants = useCallback(
    (restaurants: Restaurant[]) => {
      dispatch({ type: 'SET_RESTAURANTS', payload: restaurants });
    },
    [dispatch]
  );

  /**
   * 设置餐厅列表（带候补池）
   */
  const setRestaurantsWithCandidates = useCallback(
    (
      turntable: Restaurant[],
      candidates: Restaurant[],
      explanation?: string,
      unmetConstraints?: string[]
    ) => {
      dispatch({
        type: 'SET_RESTAURANTS_WITH_CANDIDATES',
        payload: { turntable, candidates, explanation, unmetConstraints },
      });
    },
    [dispatch]
  );

  /**
   * 设置选中的餐厅索引
   */
  const setSelectedIndex = useCallback(
    (index: number) => {
      dispatch({ type: 'SET_SELECTED_INDEX', payload: index });
    },
    [dispatch]
  );

  /**
   * 设置错误信息
   */
  const setError = useCallback(
    (error: string | null) => {
      dispatch({ type: 'SET_ERROR', payload: error });
    },
    [dispatch]
  );

  /**
   * 删除餐厅
   *
   * 会自动处理:
   * - 删除餐厅
   * - 更新选中索引
   * - 检查餐厅数量是否足够
   */
  const deleteRestaurant = useCallback(
    (index: number) => {
      dispatch({ type: 'DELETE_RESTAURANT', payload: index });
    },
    [dispatch]
  );

  /**
   * 从已移除恢复餐厅到转盘
   */
  const restoreRestaurant = useCallback(
    (index: number) => {
      dispatch({ type: 'RESTORE_RESTAURANT', payload: index });
    },
    [dispatch]
  );

  /**
   * 从候补池添加餐厅到转盘
   */
  const addFromCandidates = useCallback(
    (index: number) => {
      dispatch({ type: 'ADD_FROM_CANDIDATES', payload: index });
    },
    [dispatch]
  );

  /**
   * 从转盘移到候补池
   */
  const removeToCandidates = useCallback(
    (index: number) => {
      dispatch({ type: 'REMOVE_TO_CANDIDATES', payload: index });
    },
    [dispatch]
  );

  /**
   * 直接添加餐厅到转盘
   */
  const addRestaurant = useCallback(
    (restaurant: Restaurant) => {
      dispatch({ type: 'ADD_RESTAURANT', payload: restaurant });
    },
    [dispatch]
  );

  /**
   * 添加自定义选项
   */
  const addCustomOption = useCallback(
    (option: CustomOption) => {
      dispatch({ type: 'ADD_CUSTOM_OPTION', payload: option });
    },
    [dispatch]
  );

  /**
   * 删除自定义选项
   */
  const removeCustomOption = useCallback(
    (id: string) => {
      dispatch({ type: 'REMOVE_CUSTOM_OPTION', payload: id });
    },
    [dispatch]
  );

  /**
   * 重置所有状态
   */
  const reset = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
  }, [dispatch]);

  return {
    state,
    setQuery,
    setLocation,
    setStep,
    setParsedRequirement,
    setRestaurants,
    setRestaurantsWithCandidates,
    setSelectedIndex,
    setError,
    deleteRestaurant,
    restoreRestaurant,
    addFromCandidates,
    removeToCandidates,
    addRestaurant,
    addCustomOption,
    removeCustomOption,
    reset,
    dispatch,
  };
}
