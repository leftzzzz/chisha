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
    <div className="flex min-h-full flex-col bg-transparent">
      <div className="flex-1">
        <div className="mx-auto w-full max-w-6xl px-4 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  );
};
