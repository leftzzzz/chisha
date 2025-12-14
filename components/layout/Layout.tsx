/**
 * Layout 组件
 *
 * 自适应布局容器，根据屏幕大小选择桌面或移动布局
 */

'use client';

import React from 'react';
import { Header } from './Header';
import { DesktopLayout } from './DesktopLayout';
import { MobileLayout } from './MobileLayout';
import { useMediaQuery } from '@/hooks';

export interface LayoutProps {
  children: React.ReactNode;
  leftPanel?: React.ReactNode;
  rightPanel?: React.ReactNode;
  onHistoryClick?: () => void;
}

export const Layout: React.FC<LayoutProps> = ({
  children,
  leftPanel,
  rightPanel,
  onHistoryClick,
}) => {
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* 头部 */}
      <Header onHistoryClick={onHistoryClick} />

      {/* 主内容区 */}
      <main className="flex-1 relative overflow-hidden">
        {isDesktop && leftPanel && rightPanel ? (
          // 桌面端布局
          <>
            <DesktopLayout leftPanel={leftPanel} rightPanel={rightPanel} />
            {/* 渲染模态框等 children */}
            {children}
          </>
        ) : (
          // 移动端布局
          <MobileLayout>{children}</MobileLayout>
        )}
      </main>
    </div>
  );
};
