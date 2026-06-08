/**
 * DesktopLayout 组件
 *
 * 桌面端布局 - 苹果风格设计
 * 地图作为全屏背景，左侧毛玻璃面板
 */

import React from 'react';

export interface DesktopLayoutProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
}

export const DesktopLayout: React.FC<DesktopLayoutProps> = ({
  leftPanel,
  rightPanel,
}) => {
  return (
    <div className="relative h-full w-full overflow-hidden bg-[#ebe5d9]">
      {/* 地图全屏背景 */}
      <div className="absolute inset-0 saturate-[0.88] contrast-[1.02]">
        {rightPanel}
      </div>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_16%,rgba(245,184,75,0.22),transparent_28rem),linear-gradient(90deg,rgba(244,240,232,0.72),rgba(244,240,232,0.18)_42%,rgba(24,21,19,0.05))]" />

      {/* 左侧毛玻璃面板 */}
      <div className="absolute bottom-0 left-0 top-0 z-10 w-[min(520px,46vw)]">
        <div className="h-full overflow-y-auto border-r border-white/40 bg-[#fffaf1]/82 shadow-[28px_0_80px_rgba(71,40,29,0.18)] backdrop-blur-2xl">
          <div className="p-5 xl:p-7">
            {leftPanel}
          </div>
        </div>
      </div>
    </div>
  );
};
