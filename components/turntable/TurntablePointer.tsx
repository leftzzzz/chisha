/**
 * TurntablePointer 组件
 *
 * 转盘指针组件 - Apple 风格极简设计
 */

import React from 'react';

export const TurntablePointer: React.FC = () => {
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
      {/* 极简圆点指针 */}
      <div className="relative flex flex-col items-center">
        {/* 主圆点 */}
        <div
          className="w-4 h-4 rounded-full shadow-lg"
          style={{ backgroundColor: '#1d1d1f' }}
        />
        {/* 小三角指示 */}
        <div
          className="w-0 h-0 -mt-0.5"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '8px solid #1d1d1f',
          }}
        />
      </div>
    </div>
  );
};
