/**
 * TurntableSegment 组件
 *
 * 转盘单个扇形组件
 */

import React from 'react';

export interface TurntableSegmentProps {
  index: number;
  name: string;
  cuisineType: string;
  color: string;
  isSelected: boolean;
  totalSegments: number;
}

export const TurntableSegment: React.FC<TurntableSegmentProps> = ({
  index,
  name,
  cuisineType,
  color,
  isSelected,
  totalSegments,
}) => {
  // 计算每个扇形的角度
  const segmentAngle = 360 / totalSegments;
  const startAngle = index * segmentAngle;
  const endAngle = startAngle + segmentAngle;

  // 将角度转换为弧度
  const startRad = (startAngle * Math.PI) / 180;
  const endRad = (endAngle * Math.PI) / 180;

  // SVG 路径参数 (假设圆心在 200, 200，半径为 180)
  const centerX = 200;
  const centerY = 200;
  const radius = 180;

  // 计算扇形路径
  const startX = centerX + radius * Math.cos(startRad - Math.PI / 2);
  const startY = centerY + radius * Math.sin(startRad - Math.PI / 2);
  const endX = centerX + radius * Math.cos(endRad - Math.PI / 2);
  const endY = centerY + radius * Math.sin(endRad - Math.PI / 2);

  // 大弧标志 (如果角度大于 180 度)
  const largeArcFlag = segmentAngle > 180 ? 1 : 0;

  // SVG 路径
  const pathData = `
    M ${centerX} ${centerY}
    L ${startX} ${startY}
    A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}
    Z
  `;

  // 文本位置 (在扇形的中间)
  const textAngle = startAngle + segmentAngle / 2;
  const textRad = (textAngle * Math.PI) / 180;
  const textRadius = radius * 0.65;
  const textX = centerX + textRadius * Math.cos(textRad - Math.PI / 2);
  const textY = centerY + textRadius * Math.sin(textRad - Math.PI / 2);

  // 文本旋转角度
  const textRotation = textAngle;

  return (
    <g
      className={`transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-90'}`}
    >
      {/* 扇形路径 */}
      <path
        d={pathData}
        fill={color}
        stroke="white"
        strokeWidth="3"
        className={`transition-all duration-300 ${
          isSelected ? 'brightness-110 drop-shadow-lg' : 'hover:brightness-105'
        }`}
      />

      {/* 文本 */}
      <text
        x={textX}
        y={textY}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${textRotation} ${textX} ${textY})`}
        className="pointer-events-none select-none"
      >
        <tspan
          x={textX}
          dy="-0.4em"
          className="text-sm font-bold fill-white"
          style={{ fontSize: '14px' }}
        >
          {name.length > 8 ? `${name.slice(0, 7)}...` : name}
        </tspan>
        <tspan
          x={textX}
          dy="1.4em"
          className="text-xs fill-white opacity-90"
          style={{ fontSize: '11px' }}
        >
          {cuisineType}
        </tspan>
      </text>
    </g>
  );
};
