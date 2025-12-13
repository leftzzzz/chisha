/**
 * useMediaQuery - 响应式设计 Hook
 *
 * 检测屏幕尺寸并响应变化
 *
 * 特性:
 * - 使用 matchMedia API
 * - 支持 SSR(服务端渲染)
 * - 实时监听窗口大小变化
 * - 预定义常用断点
 * - 自动清理事件监听器
 *
 * 使用方式:
 * ```tsx
 * const isMobile = useMediaQuery('(max-width: 768px)');
 * // 或使用预定义 hook
 * const isMobile = useIsMobile();
 * ```
 */

'use client';

import { useState, useEffect } from 'react';

/**
 * 预定义的断点
 */
export const BREAKPOINTS = {
  mobile: '(max-width: 768px)',
  tablet: '(max-width: 1024px)',
  desktop: '(min-width: 1025px)',
  landscape: '(orientation: landscape)',
  portrait: '(orientation: portrait)',
} as const;

/**
 * useMediaQuery Hook
 *
 * 检测媒体查询是否匹配
 *
 * @param query - 媒体查询字符串
 * @returns 是否匹配
 *
 * @example
 * ```tsx
 * function ResponsiveComponent() {
 *   const isMobile = useMediaQuery('(max-width: 768px)');
 *   const isLandscape = useMediaQuery('(orientation: landscape)');
 *
 *   return (
 *     <div>
 *       {isMobile ? <MobileView /> : <DesktopView />}
 *       {isLandscape && <LandscapeWarning />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useMediaQuery(query: string): boolean {
  // 初始值 - SSR 时返回 false
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    // 客户端初始值
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    // SSR 环境下跳过
    if (typeof window === 'undefined') {
      return;
    }

    // 创建 MediaQueryList
    const mediaQuery = window.matchMedia(query);

    // 更新状态的处理函数
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // 设置初始值(处理 hydration)
    setMatches(mediaQuery.matches);

    // 添加监听器
    // 使用新 API(addEventListener)和旧 API(addListener)的兼容写法
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
    } else {
      // 兼容旧浏览器
      mediaQuery.addListener(handleChange);
    }

    // 清理函数
    return () => {
      if (mediaQuery.removeEventListener) {
        mediaQuery.removeEventListener('change', handleChange);
      } else {
        // 兼容旧浏览器
        mediaQuery.removeListener(handleChange);
      }
    };
  }, [query]);

  return matches;
}

/**
 * 预定义 Hook: 检测是否为移动设备
 *
 * @returns 是否为移动设备(屏幕宽度 <= 768px)
 *
 * @example
 * ```tsx
 * function App() {
 *   const isMobile = useIsMobile();
 *
 *   return (
 *     <div className={isMobile ? 'mobile-layout' : 'desktop-layout'}>
 *       {isMobile ? <MobileMenu /> : <DesktopMenu />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsMobile(): boolean {
  return useMediaQuery(BREAKPOINTS.mobile);
}

/**
 * 预定义 Hook: 检测是否为平板设备
 *
 * @returns 是否为平板设备(屏幕宽度 <= 1024px)
 *
 * @example
 * ```tsx
 * function App() {
 *   const isTablet = useIsTablet();
 *
 *   return (
 *     <div>
 *       {isTablet && <TabletOptimizedView />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsTablet(): boolean {
  return useMediaQuery(BREAKPOINTS.tablet);
}

/**
 * 预定义 Hook: 检测是否为桌面设备
 *
 * @returns 是否为桌面设备(屏幕宽度 >= 1025px)
 *
 * @example
 * ```tsx
 * function App() {
 *   const isDesktop = useIsDesktop();
 *
 *   return (
 *     <div>
 *       {isDesktop && <DesktopFeatures />}
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsDesktop(): boolean {
  return useMediaQuery(BREAKPOINTS.desktop);
}

/**
 * 预定义 Hook: 检测屏幕方向
 *
 * @returns 是否为横屏
 *
 * @example
 * ```tsx
 * function VideoPlayer() {
 *   const isLandscape = useIsLandscape();
 *
 *   return (
 *     <div className={isLandscape ? 'fullscreen' : 'normal'}>
 *       <video />
 *     </div>
 *   );
 * }
 * ```
 */
export function useIsLandscape(): boolean {
  return useMediaQuery(BREAKPOINTS.landscape);
}

/**
 * 预定义 Hook: 检测是否为竖屏
 *
 * @returns 是否为竖屏
 */
export function useIsPortrait(): boolean {
  return useMediaQuery(BREAKPOINTS.portrait);
}

/**
 * Hook: 获取当前断点
 *
 * 返回当前屏幕尺寸对应的断点名称
 *
 * @returns 断点名称: 'mobile' | 'tablet' | 'desktop'
 *
 * @example
 * ```tsx
 * function App() {
 *   const breakpoint = useBreakpoint();
 *
 *   return (
 *     <div data-breakpoint={breakpoint}>
 *       当前断点: {breakpoint}
 *     </div>
 *   );
 * }
 * ```
 */
export function useBreakpoint(): 'mobile' | 'tablet' | 'desktop' {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();

  if (isMobile) {
    return 'mobile';
  } else if (isTablet) {
    return 'tablet';
  } else {
    return 'desktop';
  }
}
