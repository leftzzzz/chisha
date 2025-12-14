/**
 * AppContext - 全局应用状态 Context
 *
 * 提供全局状态管理,包括:
 * - 用户输入和位置
 * - LLM 解析结果
 * - 搜索结果
 * - 选中的餐厅
 * - 应用步骤和错误状态
 *
 * 使用方式:
 * 1. 在根组件使用 AppProvider 包裹
 * 2. 在子组件中使用 useAppContext hook 获取状态和 dispatch
 */

'use client';

import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { AppState, AppAction } from '@/types';
import { appReducer, initialState } from './AppReducer';
import { ToastProvider } from '@/components/ui';

/**
 * Context 类型定义
 */
interface AppContextType {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
}

/**
 * 创建 Context
 */
const AppContext = createContext<AppContextType | undefined>(undefined);

/**
 * Provider Props
 */
interface AppProviderProps {
  children: ReactNode;
  initialState?: Partial<AppState>; // 支持自定义初始状态(用于测试)
}

/**
 * App Provider 组件
 *
 * 包装整个应用,提供全局状态管理
 *
 * @param props - Provider props
 * @returns Provider 组件
 *
 * @example
 * ```tsx
 * function App() {
 *   return (
 *     <AppProvider>
 *       <YourComponents />
 *     </AppProvider>
 *   );
 * }
 * ```
 */
export function AppProvider({ children, initialState: customInitialState }: AppProviderProps) {
  // 合并自定义初始状态
  const mergedInitialState: AppState = {
    ...initialState,
    ...customInitialState,
  };

  const [state, dispatch] = useReducer(appReducer, mergedInitialState);

  // 开发环境下打印状态变化
  if (process.env.NODE_ENV === 'development') {
    // 使用 useEffect 会导致额外的渲染,这里简单使用 console.log
    // 在生产环境会被移除
  }

  const value: AppContextType = {
    state,
    dispatch,
  };

  return (
    <AppContext.Provider value={value}>
      <ToastProvider>
        {children}
      </ToastProvider>
    </AppContext.Provider>
  );
}

/**
 * useAppContext Hook
 *
 * 获取全局应用状态和 dispatch 函数
 *
 * @returns Context value
 * @throws 如果在 AppProvider 外部使用会抛出错误
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, dispatch } = useAppContext();
 *
 *   const handleSearch = () => {
 *     dispatch({ type: 'SET_STEP', payload: 'UNDERSTANDING' });
 *   };
 *
 *   return <div>{state.step}</div>;
 * }
 * ```
 */
export function useAppContext(): AppContextType {
  const context = useContext(AppContext);

  if (context === undefined) {
    throw new Error('useAppContext must be used within an AppProvider');
  }

  return context;
}

/**
 * 导出 Context (用于高级用例)
 */
export { AppContext };
