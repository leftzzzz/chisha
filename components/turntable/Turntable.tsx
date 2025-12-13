/**
 * Turntable 组件
 *
 * 转盘主组件，渲染圆形分度盘
 */

import React from 'react';
import { Restaurant } from '@/types';
import { TurntableSegment } from './TurntableSegment';
import { TurntablePointer } from './TurntablePointer';

export interface TurntableProps {
  restaurants: Restaurant[];
  selectedIndex: number;
  isSpinning: boolean;
  rotation: number;
}

// 预定义的颜色数组（交替使用）
const COLORS = [
  '#FF6B6B', // 红色
  '#4ECDC4', // 青色
  '#FFE66D', // 黄色
  '#95E1D3', // 薄荷绿
  '#F38181', // 粉红色
  '#AA96DA', // 紫色
  '#FCBAD3', // 浅粉色
  '#A8E6CF', // 浅绿色
];

export const Turntable: React.FC<TurntableProps> = ({
  restaurants,
  selectedIndex,
  isSpinning,
  rotation,
}) => {
  // 限制最多 8 个扇形
  const displayRestaurants = restaurants.slice(0, 8);
  const totalSegments = displayRestaurants.length;

  if (totalSegments === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-500">暂无餐厅数据</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center p-8">
      {/* 指针 */}
      <TurntablePointer />

      {/* 转盘容器 */}
      <div
        className={`
          relative
          w-full max-w-[400px] md:max-w-[500px] lg:max-w-[600px]
          aspect-square
          ${isSpinning ? '' : 'transition-transform duration-300'}
        `}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: isSpinning ? 'transform 4s cubic-bezier(0.25, 0.1, 0.25, 1)' : undefined,
        }}
      >
        <svg
          viewBox="0 0 400 400"
          className="w-full h-full drop-shadow-2xl"
          role="img"
          aria-label="餐厅转盘"
        >
          {/* 外圆边框 */}
          <circle
            cx="200"
            cy="200"
            r="190"
            fill="none"
            stroke="white"
            strokeWidth="6"
          />

          {/* 扇形 */}
          {displayRestaurants.map((restaurant, index) => (
            <TurntableSegment
              key={restaurant.id}
              index={index}
              name={restaurant.name}
              cuisineType={restaurant.cuisineType}
              color={COLORS[index % COLORS.length]}
              isSelected={selectedIndex === index}
              totalSegments={totalSegments}
            />
          ))}

          {/* 中心圆 */}
          <circle
            cx="200"
            cy="200"
            r="30"
            fill="white"
            stroke="#FF6B6B"
            strokeWidth="4"
          />

          {/* 中心文字 */}
          <text
            x="200"
            y="205"
            textAnchor="middle"
            dominantBaseline="middle"
            className="text-sm font-bold fill-primary"
            style={{ fontSize: '16px' }}
          >
            GO
          </text>
        </svg>
      </div>

      {/* 选中指示 */}
      {selectedIndex >= 0 && !isSpinning && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-white rounded-full shadow-lg border-2 border-primary animate-slideUp">
          <p className="text-sm font-medium text-gray-900">
            {displayRestaurants[selectedIndex]?.name}
          </p>
        </div>
      )}
    </div>
  );
};
