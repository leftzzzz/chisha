/**
 * 海报 Canvas 绘制工具
 *
 * 使用原生 Canvas API 直接绘制海报
 * Apple 风格 - Aurora Flow (流体极光) 设计
 */

import { Restaurant, TurntableOption, isCustomOption } from '@/types';

// -----------------------------------------------------------------------------
// 视觉常量
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

// 装饰性 Emoji 列表
const DECO_EMOJIS = ['🍔', '🍱', '🍜', '🍕', '🍣', '🥨', '🥑', '🥩'];

// 迷你转盘色板
const TURNTABLE_PALETTE = [
  '#FF9A9E', '#FECFEF', '#A18CD1', '#FBC2EB', '#fad0c4', '#ffd1ff'
];

interface PosterData {
  query: string;
  selectedOption: TurntableOption;
  allOptions: TurntableOption[];
  qrCodeDataUrl: string;
}

/**
 * 加载图片
 */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * 绘制圆角矩形
 */
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number | { tl: number; tr: number; br: number; bl: number }
) {
  const r = typeof radius === 'number'
    ? { tl: radius, tr: radius, br: radius, bl: radius }
    : radius;

  ctx.beginPath();
  ctx.moveTo(x + r.tl, y);
  ctx.lineTo(x + width - r.tr, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
  ctx.lineTo(x + width, y + height - r.br);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
  ctx.lineTo(x + r.bl, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
  ctx.lineTo(x, y + r.tl);
  ctx.quadraticCurveTo(x, y, x + r.tl, y);
  ctx.closePath();
}

/**
 * 绘制迷你转盘
 */
function drawMiniTurntable(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  options: TurntableOption[],
  selectedIndex: number
) {
  const total = options.length;
  // 限制最大显示数量
  const displayTotal = Math.min(total, 12);
  const anglePerSegment = (2 * Math.PI) / displayTotal;

  // 计算旋转角度（让选中的扇区在顶部）
  const rotation = -(selectedIndex * ((2 * Math.PI) / total) + ((2 * Math.PI) / total) / 2) + Math.PI / 2;

  ctx.save();
  ctx.translate(centerX, centerY);

  // 绘制背景圆
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  // 绘制内容并旋转
  ctx.rotate(rotation);

  // 绘制扇区
  for (let i = 0; i < displayTotal; i++) {
    const startAngle = i * anglePerSegment - Math.PI / 2;
    const endAngle = (i + 1) * anglePerSegment - Math.PI / 2;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, radius - 2, startAngle, endAngle);
    ctx.closePath();

    ctx.fillStyle = TURNTABLE_PALETTE[i % TURNTABLE_PALETTE.length];
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 绘制中心白圆
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.15, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  ctx.restore();

  // 绘制指针 (不旋转)
  ctx.save();
  ctx.translate(centerX, centerY);

  // 指针阴影
  ctx.shadowColor = 'rgba(0,0,0,0.2)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 2;

  ctx.beginPath();
  ctx.moveTo(0, -radius - 8); // 顶点
  ctx.lineTo(8, -radius + 4);
  ctx.lineTo(-8, -radius + 4);
  ctx.closePath();
  ctx.fillStyle = AURORA_COLORS.accent;
  ctx.fill();

  ctx.restore();
}

/**
 * 绘制标签 (Tag)
 */
function drawTag(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  icon: string,
  text: string
) {
  const fontSize = 24;
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;

  const iconText = icon;
  const contentText = text;

  // 测量宽度
  const iconWidth = ctx.measureText(iconText).width;
  const textWidth = ctx.measureText(contentText).width;
  const paddingX = 24;
  const paddingY = 12;
  const gap = 8;

  const width = paddingX * 2 + iconWidth + gap + textWidth;
  const height = fontSize + paddingY * 2;

  // 背景
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.02)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;

  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();

  // 边框
  ctx.strokeStyle = 'rgba(0,0,0,0.04)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // 文字
  ctx.textBaseline = 'middle';

  // Icon
  ctx.font = `${fontSize}px -apple-system`; // Emoji font
  ctx.fillStyle = '#000';
  ctx.fillText(iconText, x + paddingX, y + height / 2);

  // Text
  ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
  ctx.fillStyle = '#424245';
  ctx.fillText(contentText, x + paddingX + iconWidth + gap, y + height / 2);

  return width;
}

/**
 * 绘制旋转的 Emoji
 */
function drawRotatedEmoji(
  ctx: CanvasRenderingContext2D,
  emoji: string,
  x: number,
  y: number,
  size: number,
  angleDeg: number,
  blur: number = 0
) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angleDeg * Math.PI / 180);

  if (blur > 0) {
    ctx.filter = `blur(${blur}px) drop-shadow(0 20px 30px rgba(0,0,0,0.15))`;
  } else {
    ctx.filter = `drop-shadow(0 20px 30px rgba(0,0,0,0.15))`;
  }

  ctx.font = `${size}px serif`; // Using serif for better emoji rendering in some envs
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, 0, 0);

  ctx.restore();
}

/**
 * 格式化距离
 */
function formatDistance(distance: number): string {
  if (distance < 1000) return `${Math.round(distance)}m`;
  return `${(distance / 1000).toFixed(1)}km`;
}

/**
 * 生成海报
 */
export async function generatePosterCanvas(data: PosterData): Promise<string> {
  const { query, selectedOption, allOptions, qrCodeDataUrl } = data;

  if (!selectedOption) throw new Error('selectedOption is required');

  const isCustom = isCustomOption(selectedOption);
  const restaurant = isCustom ? null : (selectedOption as Restaurant);
  const selectedIndex = allOptions.findIndex(opt => opt.id === selectedOption.id);

  // 随机选择 Emoji (固定种子以保持一致性? 这里简单随机即可，或者基于 query hash)
  const emojis = DECO_EMOJIS.sort(() => 0.5 - Math.random()).slice(0, 3);

  // 创建 canvas
  const width = 1080;
  const height = 1440;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // --------------------------------------------------------
  // 1. 绘制极光背景
  // --------------------------------------------------------
  ctx.fillStyle = AURORA_COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Orb 1: 左上 - 暖粉
  const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 800);
  g1.addColorStop(0, AURORA_COLORS.orb1 + 'CC'); // CC = 80% opacity
  g1.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, width, height);

  // Orb 2: 右上 - 浅紫
  const g2 = ctx.createRadialGradient(width, 0, 0, width, 0, 700);
  g2.addColorStop(0, AURORA_COLORS.orb2 + 'E6'); // E6 = 90%
  g2.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, width, height);

  // Orb 3: 左下 - 梦幻紫
  const g3 = ctx.createRadialGradient(100, height - 100, 0, 100, height - 100, 600);
  g3.addColorStop(0, AURORA_COLORS.orb3 + '99'); // 60%
  g3.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, width, height);

  // Orb 4: 右下 - 玫瑰粉
  const g4 = ctx.createRadialGradient(width, height, 0, width, height, 600);
  g4.addColorStop(0, AURORA_COLORS.orb4 + 'B3'); // 70%
  g4.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g4;
  ctx.fillRect(0, 0, width, height);

  // --------------------------------------------------------
  // 2. 绘制悬浮装饰 Emoji
  // --------------------------------------------------------
  drawRotatedEmoji(ctx, emojis[0], width - 80, 120, 120, 15);
  drawRotatedEmoji(ctx, emojis[1], 40, height - 380, 140, -25, 1);
  drawRotatedEmoji(ctx, emojis[2], width + 50, 400, 100, 45, 2);

  // --------------------------------------------------------
  // 3. 绘制标题区域
  // --------------------------------------------------------
  const contentStartY = 220;

  // 决定达成 Badge (原 DECISION MADE)
  ctx.textAlign = 'center';
  const badgeText = '今天吃这个';
  ctx.font = '500 22px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  const badgeWidth = ctx.measureText(badgeText).width + 48;
  const badgeHeight = 44;
  const badgeX = (width - badgeWidth) / 2;
  const badgeY = contentStartY;

  // Badge bg
  ctx.save();
  ctx.shadowColor = 'rgba(255,107,107,0.1)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 50);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Badge text
  ctx.fillStyle = '#666';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, width / 2, badgeY + badgeHeight / 2);

  // Main Title
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '800 84px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.shadowColor = 'rgba(255,255,255,0.8)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 20;
  ctx.fillText('今天吃啥?', width / 2, contentStartY + 130);
  ctx.shadowColor = 'transparent'; // reset shadow

  // Subtitle
  ctx.fillStyle = '#6E6E73';
  ctx.font = '400 32px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText(query ? `在「${query}」找到了答案` : '选择困难症的终极解药', width / 2, contentStartY + 190);

  // --------------------------------------------------------
  // 4. 绘制结果卡片
  // --------------------------------------------------------
  const cardX = 64;
  const cardWidth = width - cardX * 2;
  const cardHeight = 460; // Increased height
  const cardY = contentStartY + 270;
  const cardRadius = 48;

  // 卡片 Glassmorphism 效果
  ctx.save();

  // 底部阴影
  ctx.shadowColor = 'rgba(50,50,93,0.1)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 20;
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius);
  ctx.fillStyle = 'rgba(255,255,255,0.75)'; // base
  ctx.fill();

  // 环境光阴影
  ctx.shadowColor = 'rgba(0,0,0,0.05)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  ctx.fill();
  ctx.restore();

  // 内描边 (模拟 inset border)
  ctx.save();
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255,255,255,0.8)';
  ctx.lineWidth = 4; // 2px inside
  ctx.stroke();
  ctx.restore();

  // 4.1 绘制顶部迷你转盘挂饰
  const miniTurntableRadius = 50;
  const mtCx = width / 2;
  const mtCy = cardY; // half inside, half outside? Design said on top. Let's put slightly above.

  // 绘制转盘容器背景 (Circle shadow)
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.beginPath();
  ctx.arc(mtCx, mtCy, miniTurntableRadius + 10, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.restore();

  drawMiniTurntable(ctx, mtCx, mtCy, miniTurntableRadius, allOptions, selectedIndex);

  // 4.2 "THE WINNER IS" -> "决定是你了"
  const innerStartY = cardY + 90;
  ctx.fillStyle = AURORA_COLORS.accent;
  ctx.font = '700 24px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  // ctx.letterSpacing // Canvas API support varies, skipping explicit letterSpacing
  ctx.fillText('✨ 决定是你了 ✨', width / 2, innerStartY);

  // 4.3 餐厅名称
  const nameY = innerStartY + 80;
  const nameFontSize = selectedOption.name.length > 8 ? 56 : 72;
  ctx.font = `800 ${nameFontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display"`;

  // 模拟文字渐变
  const textGrad = ctx.createLinearGradient(0, nameY - 40, 40, nameY + 40);
  textGrad.addColorStop(0.3, '#1D1D1F');
  textGrad.addColorStop(0.9, '#484848');
  ctx.fillStyle = textGrad;
  ctx.fillText(selectedOption.name, width / 2, nameY);

  // 4.4 标签组
  const tagsY = nameY + 80;
  const tags: { icon: string, text: string }[] = [];
  if (restaurant) {
    tags.push({ icon: '🥘', text: restaurant.cuisineType });
    if (restaurant.distance) tags.push({ icon: '📍', text: formatDistance(restaurant.distance) });
    if (restaurant.rating) tags.push({ icon: '⭐', text: restaurant.rating.toFixed(1) });
  } else if (isCustom) {
    tags.push({ icon: '✏️', text: '自定义选项' });
  }

  // 计算标签总宽度并居中绘制
  let tempTotalWidth = 0;
  const tagWidths: number[] = [];

  ctx.font = '600 24px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  tags.forEach((tag, idx) => {
    // Re-measure exact width used in drawTag
    const iconWidth = ctx.measureText(tag.icon).width;
    const textWidth = ctx.measureText(tag.text).width;
    const w = 24 * 2 + iconWidth + 8 + textWidth;

    tagWidths.push(w);
    tempTotalWidth += w;
    if (idx < tags.length - 1) tempTotalWidth += 16; // gap
  });

  let currentTagX = (width - tempTotalWidth) / 2;
  tags.forEach((tag, idx) => {
    drawTag(ctx, currentTagX, tagsY, tag.icon, tag.text);
    currentTagX += tagWidths[idx] + 16;
  });

  // --------------------------------------------------------
  // 5. 底部 Footer
  // --------------------------------------------------------
  const footerHeight = 260; // Enough for QR and text
  const footerY = height - footerHeight;

  ctx.save();
  // Shadow for footer
  ctx.shadowColor = 'rgba(0,0,0,0.03)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = -10;

  // Draw footer bg with top rounded corners
  roundRect(ctx, 0, footerY, width, footerHeight, { tl: 60, tr: 60, br: 0, bl: 0 });
  ctx.fillStyle = 'white';
  ctx.fill();
  ctx.restore();

  // Footer Content
  const footerContentY = footerY + 80; // approximate center Y for text block

  // Left: Text
  ctx.textAlign = 'left';
  const leftMargin = 80;

  ctx.fillStyle = '#1D1D1F';
  ctx.font = '700 36px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText('扫码也来转一转', leftMargin, footerContentY + 20);

  ctx.fillStyle = '#86868B';
  ctx.font = '400 24px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText('今天吃啥 · 你的美食决策助手', leftMargin, footerContentY + 70);

  // Right: QR Code - 进一步加大
  const qrSize = 240;
  const rightMargin = 60; // 稍微减小右边距
  const qrX = width - rightMargin - qrSize;
  const qrY = footerY + (footerHeight - qrSize) / 2;

  // QR Bg
  roundRect(ctx, qrX - 12, qrY - 12, qrSize + 24, qrSize + 24, 20);
  ctx.fillStyle = '#F5F5F7';
  ctx.fill();

  // QR Image
  if (qrCodeDataUrl) {
    try {
      const qrImg = await loadImage(qrCodeDataUrl);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    } catch (e) {
      console.error('QR Load Fail', e);
    }
  }

  return canvas.toDataURL('image/png', 1.0);
}
