/**
 * SharePoster 组件
 *
 * Apple 风格的分享海报 - Aurora Flow (流体极光) 设计
 * 尺寸: 1080x1440 (3:4)
 *
 * 设计理念 (Design Philosophy):
 * - Emotion (情绪): 传递"终于决定了"的愉悦与期待
 * - Depth (纵深): 通过层叠、阴影和模糊构建空间感
 * - Vibrancy (活力): 使用高饱和度流体渐变作为背景
 *
 * 技术约束:
 * - 必须使用内联样式以兼容 html2canvas
 * - 避免使用高级 CSS 特性 (如 backdrop-filter)，改用半透明叠加模拟
 */

'use client';

import React, { forwardRef, useEffect, useRef, useCallback } from 'react';
import { Restaurant, TurntableOption, isCustomOption } from '@/types';

// -----------------------------------------------------------------------------
// 视觉常量定义
// -----------------------------------------------------------------------------

// 极光背景色板
const AURORA_COLORS = {
  bg: '#FFF8F6',
  orb1: '#FF9A9E', // 暖粉
  orb2: '#FECFEF', // 浅紫
  orb3: '#A18CD1', // 梦幻紫
  orb4: '#FBC2EB', // 玫瑰粉
  accent: '#FF6B6B', // 强调色
};

// 装饰性 Emoji 列表 (3D 质感)
const DECO_EMOJIS = ['🍔', '🍱', '🍜', '🍕', '🍣', '🥨', '🥑', '🥩'];

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

    // 随机选择几个装饰 Emoji
    const randomDecos = useRef(
      DECO_EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3)
    ).current;

    const handleQRLoad = useCallback(() => {
      if (onReady) setTimeout(onReady, 100);
    }, [onReady]);

    useEffect(() => {
      if (!qrCodeDataUrl && onReady) setTimeout(onReady, 100);
    }, [qrCodeDataUrl, onReady]);

    const formatDistance = (distance: number) => {
      if (distance < 1000) return `${Math.round(distance)}m`;
      return `${(distance / 1000).toFixed(1)}km`;
    };

    return (
      <div
        ref={ref}
        style={{
          width: '1080px',
          height: '1440px',
          background: AURORA_COLORS.bg,
          fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC", "Segoe UI", Roboto, sans-serif',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {/* ========================================================================
           1. 背景层 (Aurora Orbs)
           使用多个径向渐变模拟流体极光效果
           ======================================================================== */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 0,
        }}>
          {/* 左上 - 暖粉 */}
          <div style={{
            position: 'absolute',
            top: '-20%',
            left: '-20%',
            width: '80%',
            height: '60%',
            background: `radial-gradient(circle, ${AURORA_COLORS.orb1} 0%, rgba(255,255,255,0) 70%)`,
            opacity: 0.8,
          }} />
          {/* 右上 - 浅紫 */}
          <div style={{
            position: 'absolute',
            top: '-10%',
            right: '-10%',
            width: '70%',
            height: '50%',
            background: `radial-gradient(circle, ${AURORA_COLORS.orb2} 0%, rgba(255,255,255,0) 70%)`,
            opacity: 0.9,
          }} />
          {/* 左下 - 梦幻紫 */}
          <div style={{
            position: 'absolute',
            bottom: '-10%',
            left: '-10%',
            width: '60%',
            height: '60%',
            background: `radial-gradient(circle, ${AURORA_COLORS.orb3} 0%, rgba(255,255,255,0) 70%)`,
            opacity: 0.6,
          }} />
          {/* 右下 - 玫瑰粉 */}
          <div style={{
            position: 'absolute',
            bottom: '10%',
            right: '-20%',
            width: '80%',
            height: '50%',
            background: `radial-gradient(circle, ${AURORA_COLORS.orb4} 0%, rgba(255,255,255,0) 70%)`,
            opacity: 0.7,
          }} />
        </div>

        {/* ========================================================================
           2. 悬浮装饰层 (Floating 3D Elements)
           增加画面的空间感
           ======================================================================== */}
        <div style={{
          position: 'absolute',
          top: '120px',
          right: '80px',
          fontSize: '120px',
          transform: 'rotate(15deg)',
          filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.15))',
          zIndex: 1,
        }}>
          {randomDecos[0]}
        </div>
        <div style={{
          position: 'absolute',
          bottom: '380px',
          left: '-40px',
          fontSize: '140px',
          transform: 'rotate(-25deg)',
          filter: 'blur(1px) drop-shadow(0 20px 30px rgba(0,0,0,0.12))',
          zIndex: 1,
        }}>
          {randomDecos[1]}
        </div>
        <div style={{
          position: 'absolute',
          top: '400px',
          right: '-50px',
          fontSize: '100px',
          transform: 'rotate(45deg)',
          filter: 'blur(2px) drop-shadow(0 15px 25px rgba(0,0,0,0.1))',
          zIndex: 1,
        }}>
          {randomDecos[2]}
        </div>


        {/* ========================================================================
           3. 主要内容区域 (Content)
           ======================================================================== */}
        <div style={{
          width: '100%',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          zIndex: 10,
          padding: '100px 64px 0',
        }}>

          {/* 标题组 */}
          <div style={{ textAlign: 'center', marginBottom: '60px' }}>
            <div style={{
              display: 'inline-block',
              padding: '12px 24px',
              background: 'rgba(255,255,255,0.6)',
              borderRadius: '100px',
              marginBottom: '24px',
              border: '1px solid rgba(255,255,255,0.8)',
              boxShadow: '0 4px 20px rgba(255,107,107,0.1)',
            }}>
              <span style={{ fontSize: '20px', color: '#666', fontWeight: 500, letterSpacing: '2px' }}>
                DECISION MADE
              </span>
            </div>

            <div style={{
              fontSize: '84px',
              fontWeight: 800,
              color: '#1D1D1F',
              lineHeight: 1,
              letterSpacing: '-2px',
              marginBottom: '16px',
              textShadow: '0 20px 40px rgba(255,255,255,0.8)', // 增加一点光晕增强对比
            }}>
              今天吃啥?
            </div>
            <div style={{
              fontSize: '32px',
              color: '#6E6E73',
              fontWeight: 400,
              letterSpacing: '1px',
            }}>
              {query ? `在「${query}」找到了答案` : '选择困难症的终极解药'}
            </div>
          </div>

          {/* 转盘选中结果 - 核心卡片 */}
          <div style={{
            position: 'relative',
            width: '100%',
            background: 'rgba(255,255,255,0.75)',
            borderRadius: '48px',
            padding: '72px 56px',
            // 模拟 Glassmorphism: 双重阴影做层次，边框做高光
            boxShadow: `
                0 20px 60px -10px rgba(50,50,93,0.1),
                0 12px 24px -10px rgba(0,0,0,0.05),
                inset 0 0 0 2px rgba(255,255,255,0.8)
            `,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: '64px',
          }}>
            {/* 顶部挂饰 - 迷你转盘 */}
            <div style={{
              position: 'absolute',
              top: '-50px',
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'white',
              padding: '10px',
              borderRadius: '50%',
              boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            }}>
              <MiniTurntable options={allOptions} selectedIndex={selectedIndex} size={100} />
            </div>

            <div style={{ height: '30px' }}></div> {/* Spacer for turntable */}

            {/* 选中文字 */}
            <div style={{
              fontSize: '24px',
              color: AURORA_COLORS.accent,
              fontWeight: 700,
              letterSpacing: '4px',
              textTransform: 'uppercase',
              marginBottom: '28px',
              display: 'flex',
              alignItems: 'center',
            }}>
              <span style={{ fontSize: '24px', marginRight: '8px' }}>✨</span>
              THE WINNER IS
              <span style={{ fontSize: '24px', marginLeft: '8px' }}>✨</span>
            </div>

            {/* 餐厅名称 (Hero Text) */}
            <div style={{
              fontSize: selectedOption.name.length > 8 ? '56px' : '72px',
              fontWeight: 800,
              color: '#000',
              textAlign: 'center',
              lineHeight: 1.1,
              marginBottom: '36px',
              // 文字渐变模拟
              background: '-webkit-linear-gradient(45deg, #1D1D1F 30%, #484848 90%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              // Fallback for html2canvas support (sometimes gradient text is tricky, use color directly if needed)
              // html2canvas text-gradient support is partial, keeping standard color fallback just in case
            }}>
              {selectedOption.name}
            </div>

            {/* 信息标签 Chip Group */}
            {restaurant && (
              <div style={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'center',
                gap: '16px',
              }}>
                <Tag icon="🥘" text={restaurant.cuisineType} />
                {restaurant.distance !== undefined && (
                  <Tag icon="📍" text={formatDistance(restaurant.distance)} />
                )}
                {restaurant.rating && (
                  <Tag icon="⭐" text={restaurant.rating.toFixed(1)} />
                )}
              </div>
            )}
            {isCustom && (
              <Tag icon="✏️" text="自定义选项" />
            )}
          </div>
        </div>

        {/* ========================================================================
           4. 底部栏 (Footer)
           ======================================================================== */}
        <div style={{
          width: '100%',
          background: 'white',
          padding: '60px 80px',
          borderTopLeftRadius: '60px',
          borderTopRightRadius: '60px',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.03)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          zIndex: 20,
        }}>
          {/* 左侧文字信息 */}
          <div style={{ flex: 1 }}>
            <div style={{
              fontSize: '36px',
              fontWeight: 700,
              color: '#1D1D1F',
              marginBottom: '12px',
            }}>
              扫码也来转一转
            </div>
            <div style={{
              fontSize: '24px',
              color: '#86868B',
            }}>
              今天吃啥 · 你的美食决策助手
            </div>
          </div>

          {/* 右侧二维码 */}
          <div style={{
            background: '#F5F5F7',
            padding: '12px',
            borderRadius: '20px',
          }}>
            {qrCodeDataUrl ? (
              <img
                ref={qrImgRef}
                src={qrCodeDataUrl}
                alt="QR Code"
                width={140}
                height={140}
                style={{
                  display: 'block',
                  borderRadius: '12px',
                }}
                onLoad={handleQRLoad}
                onError={handleQRLoad}
              />
            ) : (
              <div style={{
                width: '140px',
                height: '140px',
                borderRadius: '12px',
              }} />
            )}
          </div>
        </div>
      </div>
    );
  }
);

SharePoster.displayName = 'SharePoster';

// -----------------------------------------------------------------------------
// 子组件
// -----------------------------------------------------------------------------

const Tag = ({ icon, text }: { icon: string; text: string }) => (
  <div style={{
    display: 'inline-flex',
    alignItems: 'center',
    padding: '12px 24px',
    borderRadius: '100px',
    backgroundColor: 'rgba(255,255,255,0.6)',
    border: '1px solid rgba(0,0,0,0.04)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
  }}>
    <span style={{ fontSize: '24px', marginRight: '8px' }}>{icon}</span>
    <span style={{ fontSize: '24px', fontWeight: 600, color: '#424245' }}>{text}</span>
  </div>
);

/**
 * 迷你转盘组件 (Simplified Version)
 */
interface MiniTurntableProps {
  options: TurntableOption[];
  selectedIndex: number;
  size: number;
}

const MiniTurntable: React.FC<MiniTurntableProps> = ({ options, selectedIndex, size }) => {
  const total = options.length;
  // 限制最大显示数量，避免视觉过于密集
  const displayTotal = Math.min(total, 12);
  const anglePerSegment = 360 / displayTotal;
  const radius = size / 2;
  const rotation = -(selectedIndex * (360 / total) + (360 / total) / 2) + 90;

  // 使用更柔和的色板对应 Poster 主题
  const PALETTE = [
    '#FF9A9E', '#FECFEF', '#A18CD1', '#FBC2EB', '#fad0c4', '#ffd1ff'
  ];

  return (
    <div style={{
      width: `${size}px`,
      height: `${size}px`,
      position: 'relative',
    }}>
      {/* 指针 */}
      <div style={{
        position: 'absolute',
        top: '-8px',
        left: '50%',
        transform: 'translateX(-50%)',
        width: '0',
        height: '0',
        borderLeft: '8px solid transparent',
        borderRight: '8px solid transparent',
        borderTop: `12px solid ${AURORA_COLORS.accent}`,
        zIndex: 10,
        filter: 'drop-shadow(0 2px 2px rgba(0,0,0,0.2))',
      }} />

      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`rotate(${rotation}, ${radius}, ${radius})`}>
          {Array.from({ length: displayTotal }).map((_, index) => {
            // 简化的扇形绘制
            const startAngle = (index * anglePerSegment - 90) * (Math.PI / 180);
            const endAngle = ((index + 1) * anglePerSegment - 90) * (Math.PI / 180);
            const r = radius;
            const x1 = radius + r * Math.cos(startAngle);
            const y1 = radius + r * Math.sin(startAngle);
            const x2 = radius + r * Math.cos(endAngle);
            const y2 = radius + r * Math.sin(endAngle);
            const largeArc = anglePerSegment > 180 ? 1 : 0;
            return (
              <path
                key={index}
                d={`M ${radius} ${radius} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z`}
                fill={PALETTE[index % PALETTE.length]}
                stroke="white"
                strokeWidth="1.5"
              />
            );
          })}
          {/* 中心白点 */}
          <circle cx={radius} cy={radius} r={radius * 0.15} fill="white" />
        </g>
      </svg>
    </div>
  );
};
