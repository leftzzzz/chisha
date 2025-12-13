/**
 * AppReducer - 应用状态管理 Reducer
 *
 * 管理整个应用的状态转移逻辑
 *
 * 状态流转:
 * INPUT → UNDERSTANDING → SEARCHING → READY → SPINNING → RESULT
 *
 * 任何状态都可以转移到 ERROR
 * ERROR 状态可以重试回到之前的状态
 */

import { AppState, AppAction } from '@/types';

/**
 * 初始状态
 */
export const initialState: AppState = {
  step: 'INPUT',
  userQuery: '',
  userLocation: null,
  parsedRequirement: null,
  restaurants: [],
  selectedIndex: -1,
  error: null,
};

/**
 * App Reducer
 *
 * @param state - 当前状态
 * @param action - 要执行的 action
 * @returns 新状态
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    /**
     * 设置用户查询
     */
    case 'SET_QUERY':
      return {
        ...state,
        userQuery: action.payload,
        error: null,
      };

    /**
     * 设置用户位置
     */
    case 'SET_LOCATION':
      return {
        ...state,
        userLocation: action.payload,
        error: null,
      };

    /**
     * 转移状态步骤
     */
    case 'SET_STEP':
      return {
        ...state,
        step: action.payload,
        // 转移到新步骤时清除错误
        error: action.payload !== 'ERROR' ? null : state.error,
      };

    /**
     * 保存 LLM 解析结果
     */
    case 'SET_PARSED_REQUIREMENT':
      return {
        ...state,
        parsedRequirement: action.payload,
        error: null,
      };

    /**
     * 保存搜索结果
     */
    case 'SET_RESTAURANTS':
      return {
        ...state,
        restaurants: action.payload,
        selectedIndex: -1, // 重置选中索引
        error: null,
      };

    /**
     * 设置选中的餐厅索引
     */
    case 'SET_SELECTED_INDEX':
      // 验证索引有效性
      if (action.payload < -1 || action.payload >= state.restaurants.length) {
        console.warn(`Invalid restaurant index: ${action.payload}`);
        return state;
      }
      return {
        ...state,
        selectedIndex: action.payload,
        error: null,
      };

    /**
     * 设置错误信息
     */
    case 'SET_ERROR':
      return {
        ...state,
        error: action.payload,
        step: action.payload ? 'ERROR' : state.step,
      };

    /**
     * 删除餐厅并补位
     *
     * 逻辑:
     * 1. 删除指定索引的餐厅
     * 2. 如果删除的是选中的餐厅,重置选中索引
     * 3. 如果删除的餐厅在选中餐厅之前,选中索引-1
     * 4. 如果餐厅数量不足,转移到 INPUT 状态
     */
    case 'DELETE_RESTAURANT': {
      const indexToDelete = action.payload;

      // 验证索引有效性
      if (indexToDelete < 0 || indexToDelete >= state.restaurants.length) {
        console.warn(`Cannot delete restaurant at invalid index: ${indexToDelete}`);
        return state;
      }

      // 删除餐厅
      const newRestaurants = state.restaurants.filter((_, index) => index !== indexToDelete);

      // 计算新的选中索引
      let newSelectedIndex = state.selectedIndex;
      if (state.selectedIndex === indexToDelete) {
        // 删除的是选中的餐厅,重置选中
        newSelectedIndex = -1;
      } else if (state.selectedIndex > indexToDelete) {
        // 删除的餐厅在选中餐厅之前,索引需要-1
        newSelectedIndex = state.selectedIndex - 1;
      }

      // 如果餐厅数量不足 3 个,转移到 INPUT 状态
      const newStep = newRestaurants.length < 3 ? 'INPUT' : state.step;

      return {
        ...state,
        restaurants: newRestaurants,
        selectedIndex: newSelectedIndex,
        step: newStep,
        error: newRestaurants.length < 3
          ? '餐厅数量不足,请重新搜索'
          : null,
      };
    }

    /**
     * 重置所有状态
     */
    case 'RESET_STATE':
      return initialState;

    default:
      // TypeScript 会确保所有 action 都被处理
      return state;
  }
}
