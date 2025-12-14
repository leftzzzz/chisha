/**
 * Turntable 组件
 *
 * 转盘主组件，渲染圆形分度盘
 */

import React from 'react';
import { Restaurant, CustomOption, isCustomOption } from '@/types';
import { TurntableSegment } from './TurntableSegment';
import { TurntablePointer } from './TurntablePointer';

export interface TurntableProps {
  restaurants: Restaurant[];
  customOptions?: CustomOption[];
  selectedIndex: number;
  isSpinning: boolean;
  rotation: number;
  onSegmentClick?: (index: number) => void;
}

// Apple 风格柔和配色
export const COLORS = [
  '#FF9F9F', // 柔和红
  '#A8D8EA', // 天空蓝
  '#FFD3B6', // 杏色
  '#C9E4DE', // 薄荷
  '#DCEDC1', // 淡绿
  '#D4A5A5', // 玫瑰灰
  '#E8D5B7', // 米色
  '#B5C7D3', // 灰蓝
];

export const Turntable: React.FC<TurntableProps> = ({
  restaurants,
  customOptions = [],
  selectedIndex,
  isSpinning,
  rotation,
  onSegmentClick,
}) => {
  // 合并餐厅和自定义选项，限制最多 8 个扇形
  const allOptions: (Restaurant | CustomOption)[] = [...restaurants, ...customOptions].slice(0, 8);
  const totalSegments = allOptions.length;

  if (totalSegments === 0) {
    return (
      <div className="flex items-center justify-center p-8">
        <p className="text-gray-500">暂无选项</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center">
      {/* 指针 */}
      <TurntablePointer />

      {/* 转盘容器 */}
      <div
        className={`
          relative
          w-[98vw] sm:max-w-[500px] md:max-w-[600px] lg:max-w-[750px]
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
          {/* 外圆 - 极简无边框 */}
          <circle
            cx="200"
            cy="200"
            r="190"
            fill="#f5f5f7"
            stroke="none"
          />

          {/* 扇形 */}
          {allOptions.map((option, index) => (
            <TurntableSegment
              key={isCustomOption(option) ? option.id : option.id}
              index={index}
              name={option.name}
              cuisineType={isCustomOption(option) ? '自定义' : option.cuisineType}
              color={COLORS[index % COLORS.length]}
              isSelected={selectedIndex === index}
              totalSegments={totalSegments}
              onClick={!isSpinning ? onSegmentClick : undefined}
            />
          ))}

          {/* 中心圆 - 简洁白色 */}
          <circle
            cx="200"
            cy="200"
            r="35"
            fill="white"
            className="drop-shadow-md"
          />

          {/* 中心文字 */}
          <text
            x="200"
            y="205"
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-semibold"
            style={{ fontSize: '18px', fill: '#1d1d1f' }}
          >
            GO
          </text>
        </svg>
      </div>
    </div>
  );
};
