/**
 * DesktopLayout 组件
 *
 * 桌面端布局（左侧面板 + 右侧地图）
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 h-full">
      {/* 左侧面板 - 输入和转盘 */}
      <div className="overflow-y-auto bg-gray-50">
        <div className="container mx-auto p-6 max-w-2xl">
          {leftPanel}
        </div>
      </div>

      {/* 右侧面板 - 地图和结果卡片 */}
      <div className="hidden lg:block relative h-full">
        {rightPanel}
      </div>
    </div>
  );
};
