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
    <div className="relative w-full h-full bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* 地图全屏背景 */}
      <div className="absolute inset-0">
        {rightPanel}
      </div>

      {/* 左侧毛玻璃面板 */}
      <div className="absolute left-0 top-0 bottom-0 w-[480px] max-w-[45%] z-10">
        <div className="h-full overflow-y-auto backdrop-blur-xl bg-white/80 border-r border-white/20 shadow-2xl">
          <div className="p-6">
            {leftPanel}
          </div>
        </div>
      </div>
    </div>
  );
};
