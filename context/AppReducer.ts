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
  candidateRestaurants: [],
  removedRestaurants: [],
  customOptions: [],
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
     * 保存搜索结果（带候补池）
     */
    case 'SET_RESTAURANTS_WITH_CANDIDATES':
      return {
        ...state,
        restaurants: action.payload.turntable,
        candidateRestaurants: action.payload.candidates,
        removedRestaurants: [], // 清空已移除
        customOptions: [], // 清空自定义选项
        selectedIndex: -1,
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
     * 删除餐厅（移到已移除列表）
     *
     * 逻辑:
     * 1. 删除指定索引的餐厅，移到 removedRestaurants
     * 2. 如果候补池有餐厅，自动补位
     * 3. 如果删除的是选中的餐厅,重置选中索引
     * 4. 如果删除的餐厅在选中餐厅之前,选中索引-1
     * 5. 如果餐厅数量不足,转移到 INPUT 状态
     */
    case 'DELETE_RESTAURANT': {
      const indexToDelete = action.payload;

      // 验证索引有效性
      if (indexToDelete < 0 || indexToDelete >= state.restaurants.length) {
        console.warn(`Cannot delete restaurant at invalid index: ${indexToDelete}`);
        return state;
      }

      // 获取被删除的餐厅
      const deletedRestaurant = state.restaurants[indexToDelete];

      // 从转盘移除
      const newRestaurants = state.restaurants.filter((_, index) => index !== indexToDelete);

      // 添加到已移除列表
      const newRemovedRestaurants = [...state.removedRestaurants, deletedRestaurant];

      // 计算新的选中索引
      let newSelectedIndex = state.selectedIndex;
      if (state.selectedIndex === indexToDelete) {
        // 删除的是选中的餐厅,重置选中
        newSelectedIndex = -1;
      } else if (state.selectedIndex > indexToDelete) {
        // 删除的餐厅在选中餐厅之前,索引需要-1
        newSelectedIndex = state.selectedIndex - 1;
      }

      // 计算总选项数（餐厅 + 自定义选项）
      const totalOptions = newRestaurants.length + state.customOptions.length;

      // 如果选项数量不足 3 个,转移到 INPUT 状态
      const newStep = totalOptions < 3 ? 'INPUT' : state.step;

      return {
        ...state,
        restaurants: newRestaurants,
        removedRestaurants: newRemovedRestaurants,
        selectedIndex: newSelectedIndex,
        step: newStep,
        error: totalOptions < 3
          ? '选项数量不足,请添加更多选项或重新搜索'
          : null,
      };
    }

    /**
     * 从已移除恢复餐厅到转盘
     */
    case 'RESTORE_RESTAURANT': {
      const indexToRestore = action.payload;

      if (indexToRestore < 0 || indexToRestore >= state.removedRestaurants.length) {
        console.warn(`Cannot restore restaurant at invalid index: ${indexToRestore}`);
        return state;
      }

      // 检查转盘是否已满（最多8个餐厅）
      if (state.restaurants.length >= 8) {
        return {
          ...state,
          error: '转盘已满，请先移除一些选项',
        };
      }

      const restoredRestaurant = state.removedRestaurants[indexToRestore];
      const newRemovedRestaurants = state.removedRestaurants.filter((_, index) => index !== indexToRestore);
      const newRestaurants = [...state.restaurants, restoredRestaurant];

      return {
        ...state,
        restaurants: newRestaurants,
        removedRestaurants: newRemovedRestaurants,
        error: null,
      };
    }

    /**
     * 从候补池添加餐厅到转盘
     */
    case 'ADD_FROM_CANDIDATES': {
      const indexToAdd = action.payload;

      if (indexToAdd < 0 || indexToAdd >= state.candidateRestaurants.length) {
        console.warn(`Cannot add restaurant at invalid index: ${indexToAdd}`);
        return state;
      }

      // 检查转盘是否已满
      if (state.restaurants.length >= 8) {
        return {
          ...state,
          error: '转盘已满，请先移除一些选项',
        };
      }

      const addedRestaurant = state.candidateRestaurants[indexToAdd];
      const newCandidateRestaurants = state.candidateRestaurants.filter((_, index) => index !== indexToAdd);
      const newRestaurants = [...state.restaurants, addedRestaurant];

      return {
        ...state,
        restaurants: newRestaurants,
        candidateRestaurants: newCandidateRestaurants,
        error: null,
      };
    }

    /**
     * 从转盘移到候补池
     */
    case 'REMOVE_TO_CANDIDATES': {
      const indexToRemove = action.payload;

      if (indexToRemove < 0 || indexToRemove >= state.restaurants.length) {
        console.warn(`Cannot remove restaurant at invalid index: ${indexToRemove}`);
        return state;
      }

      const removedRestaurant = state.restaurants[indexToRemove];
      const newRestaurants = state.restaurants.filter((_, index) => index !== indexToRemove);
      const newCandidateRestaurants = [...state.candidateRestaurants, removedRestaurant];

      // 计算新的选中索引
      let newSelectedIndex = state.selectedIndex;
      if (state.selectedIndex === indexToRemove) {
        newSelectedIndex = -1;
      } else if (state.selectedIndex > indexToRemove) {
        newSelectedIndex = state.selectedIndex - 1;
      }

      // 计算总选项数
      const totalOptions = newRestaurants.length + state.customOptions.length;
      const newStep = totalOptions < 3 ? 'INPUT' : state.step;

      return {
        ...state,
        restaurants: newRestaurants,
        candidateRestaurants: newCandidateRestaurants,
        selectedIndex: newSelectedIndex,
        step: newStep,
        error: totalOptions < 3
          ? '选项数量不足,请添加更多选项或重新搜索'
          : null,
      };
    }

    /**
     * 添加自定义选项
     */
    case 'ADD_CUSTOM_OPTION': {
      // 检查总选项是否超过8个
      const totalOptions = state.restaurants.length + state.customOptions.length;
      if (totalOptions >= 8) {
        return {
          ...state,
          error: '转盘已满，请先移除一些选项',
        };
      }

      return {
        ...state,
        customOptions: [...state.customOptions, action.payload],
        error: null,
      };
    }

    /**
     * 直接添加餐厅到转盘
     */
    case 'ADD_RESTAURANT': {
      // 检查转盘是否已满
      if (state.restaurants.length >= 8) {
        return {
          ...state,
          error: '转盘已满，请先移除一些选项',
        };
      }

      // 检查是否已存在（通过 id）
      if (state.restaurants.some(r => r.id === action.payload.id)) {
        return {
          ...state,
          error: '该餐厅已在转盘上',
        };
      }

      return {
        ...state,
        restaurants: [...state.restaurants, action.payload],
        error: null,
      };
    }

    /**
     * 删除自定义选项
     */
    case 'REMOVE_CUSTOM_OPTION': {
      const newCustomOptions = state.customOptions.filter(option => option.id !== action.payload);

      // 计算总选项数
      const totalOptions = state.restaurants.length + newCustomOptions.length;
      const newStep = totalOptions < 3 ? 'INPUT' : state.step;

      return {
        ...state,
        customOptions: newCustomOptions,
        step: newStep,
        error: totalOptions < 3
          ? '选项数量不足,请添加更多选项或重新搜索'
          : null,
      };
    }

    /**
     * 从历史记录恢复状态
     *
     * 用于"重新使用"功能，恢复之前的搜索会话
     */
    case 'RESTORE_FROM_HISTORY': {
      const { query, location, restaurants, customOptions } = action.payload;

      // 验证餐厅数量
      const totalOptions = restaurants.length + (customOptions?.length || 0);
      if (totalOptions < 3) {
        return {
          ...state,
          error: '历史记录中的选项数量不足',
        };
      }

      return {
        ...state,
        step: 'READY',
        userQuery: query,
        userLocation: location,
        restaurants: restaurants,
        candidateRestaurants: [],
        removedRestaurants: [],
        customOptions: customOptions || [],
        selectedIndex: -1,
        parsedRequirement: null,
        error: null,
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
