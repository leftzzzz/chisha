/**
 * TurntablePointer 组件
 *
 * 转盘指针组件（固定在顶部）
 */

import React from 'react';

export const TurntablePointer: React.FC = () => {
  return (
    <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-2 z-10 pointer-events-none">
      {/* 三角形指针 */}
      <div className="relative">
        <svg width="40" height="50" viewBox="0 0 40 50" fill="none">
          {/* 外部阴影 */}
          <path
            d="M20 45 L8 10 L32 10 Z"
            fill="rgba(0, 0, 0, 0.2)"
            transform="translate(1, 1)"
          />
          {/* 主体 */}
          <path
            d="M20 45 L8 10 L32 10 Z"
            fill="#FF6B6B"
            stroke="white"
            strokeWidth="2"
          />
          {/* 高光 */}
          <path
            d="M20 45 L8 10 L20 15 Z"
            fill="rgba(255, 255, 255, 0.2)"
          />
        </svg>

        {/* 装饰圆点 */}
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-md" />
      </div>
    </div>
  );
};
