/**
 * SharePoster 组件
 *
 * Apple 风格的分享海报，用于生成分享图片
 * 尺寸: 1080x1440 (3:4)
 *
 * 设计特点：
 * - 大量留白，呼吸感强
 * - 柔和的渐变背景
 * - 精致的卡片设计
 * - 清晰的视觉层次
 *
 * 注意：为了确保 html2canvas 兼容性，所有样式使用内联 style
 */

'use client';

import React, { forwardRef, useEffect, useRef, useCallback } from 'react';
import { Restaurant, TurntableOption, isCustomOption } from '@/types';

// 柔和的马卡龙配色
const COLORS = [
  '#FFB5BA', // 樱花粉
  '#B8E0D2', // 薄荷绿
  '#D6EADF', // 淡青绿
  '#EAC4D5', // 淡紫粉
  '#FFE5B4', // 淡杏色
  '#D4E4ED', // 天空蓝
  '#E8D5C4', // 奶茶色
  '#C9B1FF', // 淡紫色
];

export interface SharePosterProps {
  query: string;
  selectedOption: TurntableOption;
  allOptions: TurntableOption[];
  qrCodeDataUrl: string;
  onReady?: () => void;
}

export const SharePoster = forwardRef<HTMLDivElement, SharePosterProps>(
  ({ query, selectedOption, allOptions, qrCodeDataUrl, onReady }, ref) => {
    const isCustom = isCustomOption(selectedOption);
    const restaurant = isCustom ? null : (selectedOption as Restaurant);
    const selectedIndex = allOptions.findIndex(opt => opt.id === selectedOption.id);
    const qrImgRef = useRef<HTMLImageElement>(null);

    // 监听二维码图片加载
    const handleQRLoad = useCallback(() => {
      if (onReady) {
        // 延迟一小段时间确保渲染完成
        setTimeout(onReady, 100);
      }
    }, [onReady]);

    // 如果没有二维码但有回调，也要触发
    useEffect(() => {
      if (!qrCodeDataUrl && onReady) {
        setTimeout(onReady, 100);
      }
    }, [qrCodeDataUrl, onReady]);

    // 格式化距离显示
    const formatDistance = (distance: number) => {
      if (distance < 1000) {
        return `${Math.round(distance)}m`;
      }
      return `${(distance / 1000).toFixed(1)}km`;
    };

    return (
      <div
        ref={ref}
        style={{
          width: '1080px',
          height: '1440px',
          background: 'linear-gradient(165deg, #FFF8F6 0%, #FFF5F8 50%, #FDF6FF 100%)',
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* 装饰性背景元素 */}
        <div style={{
          position: 'absolute',
          top: '-200px',
          right: '-200px',
          width: '600px',
          height: '600px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,182,193,0.15) 0%, transparent 70%)',
        }} />
        <div style={{
          position: 'absolute',
          bottom: '-150px',
          left: '-150px',
          width: '500px',
          height: '500px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(200,180,255,0.12) 0%, transparent 70%)',
        }} />

        {/* 顶部品牌区域 */}
        <div style={{
          paddingTop: '80px',
          textAlign: 'center',
        }}>
          {/* 转盘装饰 */}
          <div style={{
            display: 'inline-block',
            padding: '20px',
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.6)',
            boxShadow: '0 8px 32px rgba(255,107,107,0.08)',
          }}>
            <MiniTurntable
              options={allOptions}
              selectedIndex={selectedIndex}
              size={220}
            />
          </div>
        </div>

        {/* 主标题区域 */}
        <div style={{
          textAlign: 'center',
          marginTop: '48px',
          padding: '0 80px',
        }}>
          <div style={{
            fontSize: '72px',
            fontWeight: 700,
            color: '#1D1D1F',
            letterSpacing: '-2px',
            lineHeight: 1.1,
          }}>
            今天吃啥?
          </div>
          <div style={{
            marginTop: '20px',
            fontSize: '28px',
            color: '#6E6E73',
            fontWeight: 400,
            letterSpacing: '2px',
          }}>
            {query ? `「${query}」` : '让选择变得简单'}
          </div>
        </div>

        {/* 结果卡片 */}
        <div style={{
          margin: '56px 64px',
          background: 'rgba(255,255,255,0.85)',
          borderRadius: '32px',
          padding: '48px',
          boxShadow: '0 4px 24px rgba(0,0,0,0.04), 0 12px 48px rgba(255,107,107,0.06)',
          border: '1px solid rgba(255,255,255,0.8)',
        }}>
          {/* 选中标签 */}
          <div style={{
            display: 'inline-flex',
            alignItems: 'center',
            background: 'linear-gradient(135deg, #FF6B6B 0%, #FF8E8E 100%)',
            color: 'white',
            padding: '12px 24px',
            borderRadius: '100px',
            fontSize: '22px',
            fontWeight: 600,
            marginBottom: '28px',
            boxShadow: '0 4px 16px rgba(255,107,107,0.25)',
          }}>
            <span style={{ marginRight: '8px' }}>✦</span>
            转盘选中
          </div>

          {/* 餐厅名称 */}
          <div style={{
            fontSize: '52px',
            fontWeight: 700,
            color: '#1D1D1F',
            marginBottom: '24px',
            lineHeight: 1.25,
            letterSpacing: '-1px',
          }}>
            {selectedOption.name}
          </div>

          {/* 餐厅信息标签组 */}
          {restaurant && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}>
              {/* 菜系标签 */}
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                background: 'linear-gradient(135deg, rgba(255,107,107,0.12) 0%, rgba(255,107,107,0.08) 100%)',
                color: '#E85555',
                padding: '10px 20px',
                borderRadius: '100px',
                fontSize: '24px',
                fontWeight: 500,
                marginRight: '12px',
                marginBottom: '12px',
              }}>
                {restaurant.cuisineType}
              </span>

              {/* 距离标签 */}
              {restaurant.distance && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(110,110,115,0.08)',
                  color: '#6E6E73',
                  padding: '10px 20px',
                  borderRadius: '100px',
                  fontSize: '24px',
                  fontWeight: 500,
                  marginRight: '12px',
                  marginBottom: '12px',
                }}>
                  <span style={{ marginRight: '6px' }}>📍</span>
                  {formatDistance(restaurant.distance)}
                </span>
              )}

              {/* 评分标签 */}
              {restaurant.rating && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: 'rgba(255,193,7,0.12)',
                  color: '#D4A000',
                  padding: '10px 20px',
                  borderRadius: '100px',
                  fontSize: '24px',
                  fontWeight: 500,
                  marginBottom: '12px',
                }}>
                  <span style={{ marginRight: '6px' }}>⭐</span>
                  {restaurant.rating.toFixed(1)}
                </span>
              )}
            </div>
          )}

          {/* 自定义选项标签 */}
          {isCustom && (
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: 'rgba(110,110,115,0.08)',
              color: '#6E6E73',
              padding: '10px 20px',
              borderRadius: '100px',
              fontSize: '24px',
              fontWeight: 500,
            }}>
              自定义选项
            </span>
          )}
        </div>

        {/* 底部 CTA 区域 */}
        <div style={{
          position: 'absolute',
          bottom: '72px',
          left: '0',
          right: '0',
          textAlign: 'center',
        }}>
          <div style={{
            fontSize: '28px',
            color: '#1D1D1F',
            fontWeight: 600,
            marginBottom: '28px',
            letterSpacing: '1px',
          }}>
            扫码一起来选吧
          </div>

          {/* 二维码容器 - 使用 img 标签确保 html2canvas 兼容 */}
          <div style={{
            display: 'inline-block',
            background: 'white',
            padding: '20px',
            borderRadius: '24px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
          }}>
            {qrCodeDataUrl ? (
              <img
                ref={qrImgRef}
                src={qrCodeDataUrl}
                alt="QR Code"
                width={180}
                height={180}
                style={{
                  display: 'block',
                  width: '180px',
                  height: '180px',
                }}
                onLoad={handleQRLoad}
                onError={handleQRLoad}
              />
            ) : (
              <div style={{
                width: '180px',
                height: '180px',
                background: '#F5F5F7',
                borderRadius: '12px',
              }} />
            )}
          </div>

          {/* 品牌署名 */}
          <div style={{
            fontSize: '22px',
            color: '#8E8E93',
            marginTop: '28px',
            fontWeight: 400,
          }}>
            今天吃啥 · 让选择变得简单
          </div>
        </div>
      </div>
    );
  }
);

SharePoster.displayName = 'SharePoster';

/**
 * 迷你转盘组件 - 简洁优雅的设计
 */
interface MiniTurntableProps {
  options: TurntableOption[];
  selectedIndex: number;
  size: number;
}

const MiniTurntable: React.FC<MiniTurntableProps> = ({ options, selectedIndex, size }) => {
  const total = options.length;
  const anglePerSegment = 360 / total;
  const radius = size / 2;

  // 计算旋转角度（让选中的扇区在顶部）
  const selectedAngle = selectedIndex * anglePerSegment + anglePerSegment / 2;
  const rotation = -selectedAngle + 90;

  return (
    <div style={{
      display: 'inline-block',
      position: 'relative',
      width: `${size}px`,
      height: `${size}px`,
    }}>
      {/* 指针 */}
      <div style={{
        position: 'absolute',
        top: '-16px',
        left: '50%',
        marginLeft: '-14px',
        zIndex: 10,
        width: '0',
        height: '0',
        borderLeft: '14px solid transparent',
        borderRight: '14px solid transparent',
        borderTop: '24px solid #FF6B6B',
        filter: 'drop-shadow(0 2px 4px rgba(255,107,107,0.3))',
      }} />

      {/* 转盘 SVG */}
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ filter: 'drop-shadow(0 4px 12px rgba(0,0,0,0.08))' }}
      >
        <g transform={`rotate(${rotation}, ${radius}, ${radius})`}>
          {/* 扇区 */}
          {options.map((_, index) => {
            const startAngle = (index * anglePerSegment - 90) * (Math.PI / 180);
            const endAngle = ((index + 1) * anglePerSegment - 90) * (Math.PI / 180);
            const r = radius - 2;

            const x1 = radius + r * Math.cos(startAngle);
            const y1 = radius + r * Math.sin(startAngle);
            const x2 = radius + r * Math.cos(endAngle);
            const y2 = radius + r * Math.sin(endAngle);

            const largeArc = anglePerSegment > 180 ? 1 : 0;

            return (
              <path
                key={index}
                d={`M ${radius} ${radius} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={COLORS[index % COLORS.length]}
                stroke="white"
                strokeWidth="2"
              />
            );
          })}

          {/* 中心装饰圆 */}
          <circle
            cx={radius}
            cy={radius}
            r={radius * 0.22}
            fill="white"
          />
          <circle
            cx={radius}
            cy={radius}
            r={radius * 0.08}
            fill="#FF6B6B"
          />
        </g>
      </svg>
    </div>
  );
};
