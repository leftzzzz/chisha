/**
 * MobileLayout 组件
 *
 * 移动端布局（竖向堆叠）
 */

import React from 'react';

export interface MobileLayoutProps {
  children: React.ReactNode;
}

export const MobileLayout: React.FC<MobileLayoutProps> = ({ children }) => {
  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto p-4 space-y-6">
          {children}
        </div>
      </div>
    </div>
  );
};
