/**
 * Hooks 统一导出
 *
 * 方便统一导入所有自定义 hooks
 *
 * @example
 * ```tsx
 * import {
 *   useAppState,
 *   useLocation,
 *   useRestaurantSearch,
 *   useTurntable,
 *   useMediaQuery,
 *   useIsMobile,
 * } from '@/hooks';
 * ```
 */

// 应用状态管理
export { useAppState } from './useAppState';
export type { UseAppStateReturn } from './useAppState';

// 位置服务
export { useLocation } from './useLocation';
export type { UseLocationReturn } from './useLocation';

// 餐厅搜索
export { useRestaurantSearch } from './useRestaurantSearch';
export type { UseRestaurantSearchReturn, SearchProgress } from './useRestaurantSearch';

// 转盘逻辑
export { useTurntable, calculateItemPosition } from './useTurntable';
export type { UseTurntableReturn } from './useTurntable';

// 错误弹窗
export { useErrorAlert } from './useErrorAlert';
export type { UseErrorAlertReturn } from './useErrorAlert';

// 响应式设计
export {
  useMediaQuery,
  useIsMobile,
  useIsTablet,
  useIsDesktop,
  useIsLandscape,
  useIsPortrait,
  useBreakpoint,
  BREAKPOINTS,
} from './useMediaQuery';
