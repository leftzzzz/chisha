/**
 * Context 统一导出
 *
 * 方便统一导入 Context 相关功能
 *
 * @example
 * ```tsx
 * import { AppProvider, useAppContext } from '@/context';
 * ```
 */

// Context 和 Provider
export { AppProvider, useAppContext, AppContext } from './AppContext';

// Reducer 和初始状态
export { appReducer, initialState } from './AppReducer';
