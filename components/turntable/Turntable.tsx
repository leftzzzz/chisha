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
  '#E84A32',
  '#F5B84B',
  '#235A4A',
  '#F0A36E',
  '#8F3E2F',
  '#D8C0A5',
  '#5B7464',
  '#F7D7B3',
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
        <p className="font-medium text-[#76695e]">暂无选项</p>
      </div>
    );
  }

  return (
    <div className="relative flex items-center justify-center overflow-hidden rounded-[1.75rem] bg-[radial-gradient(circle_at_50%_44%,rgba(255,255,255,0.86),rgba(255,250,241,0.3)_58%,transparent_72%)] px-2 py-4">
      {/* 指针 */}
      <TurntablePointer />

      {/* 转盘容器 */}
      <div
        className={`
          relative
          w-full max-w-[min(86vw,430px)]
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
          className="w-full h-full drop-shadow-[0_22px_42px_rgba(71,40,29,0.22)]"
          role="img"
          aria-label="餐厅转盘"
        >
          {/* 外圆 - 极简无边框 */}
          <circle
            cx="200"
            cy="200"
            r="190"
            fill="#fffaf1"
            stroke="rgba(24,21,19,0.1)"
            strokeWidth="2"
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
            fill="#181513"
            className="drop-shadow-md"
          />

          {/* 中心文字 */}
          <text
            x="200"
            y="205"
            textAnchor="middle"
            dominantBaseline="middle"
            className="font-black"
            style={{ fontSize: '18px', fill: '#fffaf1' }}
          >
            GO
          </text>
        </svg>
      </div>
    </div>
  );
};
