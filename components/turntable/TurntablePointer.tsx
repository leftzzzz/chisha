/**
 * TurntablePointer 组件
 *
 * 转盘指针组件 - Apple 风格极简设计
 */

import React from 'react';

export const TurntablePointer: React.FC = () => {
  return (
    <div className="absolute left-1/2 top-3 z-10 -translate-x-1/2 pointer-events-none">
      {/* 极简圆点指针 */}
      <div className="relative flex flex-col items-center">
        {/* 主圆点 */}
        <div
          className="h-5 w-5 rounded-full border-2 border-[#fffaf1] shadow-lg"
          style={{ backgroundColor: '#E84A32' }}
        />
        {/* 小三角指示 */}
        <div
          className="w-0 h-0 -mt-0.5"
          style={{
            borderLeft: '6px solid transparent',
            borderRight: '6px solid transparent',
            borderTop: '9px solid #E84A32',
          }}
        />
      </div>
    </div>
  );
};
