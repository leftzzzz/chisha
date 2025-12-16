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

  // 随机选择 Emoji
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
  // 1. 绘制极光背景 (全屏延伸)
  // --------------------------------------------------------
  ctx.fillStyle = AURORA_COLORS.bg;
  ctx.fillRect(0, 0, width, height);

  // Orb 1: 左上 - 暖粉
  const g1 = ctx.createRadialGradient(0, 0, 0, 0, 0, 900);
  g1.addColorStop(0, AURORA_COLORS.orb1 + 'CC');
  g1.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g1;
  ctx.fillRect(0, 0, width, height);

  // Orb 2: 右上 - 浅紫
  const g2 = ctx.createRadialGradient(width, 0, 0, width, 0, 800);
  g2.addColorStop(0, AURORA_COLORS.orb2 + 'E6');
  g2.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, width, height);

  // Orb 3: 左下 - 梦幻紫 (位置稍微上移，避免被底部遮挡太多)
  const g3 = ctx.createRadialGradient(100, height - 300, 0, 100, height - 300, 700);
  g3.addColorStop(0, AURORA_COLORS.orb3 + '99');
  g3.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g3;
  ctx.fillRect(0, 0, width, height);

  // Orb 4: 右下 - 玫瑰粉
  const g4 = ctx.createRadialGradient(width, height - 200, 0, width, height - 200, 700);
  g4.addColorStop(0, AURORA_COLORS.orb4 + 'B3');
  g4.addColorStop(0.7, 'rgba(255,255,255,0)');
  ctx.fillStyle = g4;
  ctx.fillRect(0, 0, width, height);

  // --------------------------------------------------------
  // 2. 绘制悬浮装饰 Emoji (位置微调)
  // --------------------------------------------------------
  drawRotatedEmoji(ctx, emojis[0], width - 80, 140, 130, 15);
  drawRotatedEmoji(ctx, emojis[1], 60, height - 420, 150, -25, 2); // 稍微上移
  drawRotatedEmoji(ctx, emojis[2], width + 40, 480, 110, 45, 3);

  // --------------------------------------------------------
  // 3. 绘制标题区域
  // --------------------------------------------------------
  const contentStartY = 200; // 整体上移一点

  // Badge: "今天吃这个"
  ctx.textAlign = 'center';
  const badgeText = '今天吃这个';
  ctx.font = '500 24px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  const badgeWidth = ctx.measureText(badgeText).width + 56; // 增加一点宽度
  const badgeHeight = 46;
  const badgeX = (width - badgeWidth) / 2;
  const badgeY = contentStartY;

  ctx.save();
  ctx.shadowColor = 'rgba(255,107,107,0.15)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  roundRect(ctx, badgeX, badgeY, badgeWidth, badgeHeight, 50);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = '#666';
  ctx.textBaseline = 'middle';
  ctx.fillText(badgeText, width / 2, badgeY + badgeHeight / 2 + 2); // +2 optical adjustment

  // Main Title: "今天吃啥?"
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '800 96px -apple-system, BlinkMacSystemFont, "SF Pro Display"'; // 字体加大
  ctx.shadowColor = 'rgba(255,255,255,0.5)';
  ctx.shadowBlur = 30;
  const titleY = contentStartY + 140;
  ctx.fillText('今天吃啥?', width / 2, titleY);
  ctx.shadowColor = 'transparent';

  // Subtitle
  ctx.fillStyle = '#6E6E73';
  ctx.font = '400 34px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText(query ? `在「${query}」找到了答案` : '选择困难症的终极解药', width / 2, titleY + 65);

  // --------------------------------------------------------
  // 4. 绘制结果卡片
  // --------------------------------------------------------
  const cardX = 64;
  const cardWidth = width - cardX * 2;
  const cardHeight = 480;
  const cardY = titleY + 140; // 拉开与标题的距离
  const cardRadius = 56;

  // 卡片主体
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.06)'; // 更柔和的投影
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 24;
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, cardRadius);
  ctx.fillStyle = 'rgba(255,255,255,0.92)'; // 奶昔白，更不透明一点
  ctx.fill();
  ctx.restore();

  // 4.1 顶部迷你转盘挂饰
  const miniTurntableRadius = 54;
  const mtCx = width / 2;
  const mtCy = cardY;

  // 背景遮罩
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.05)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 6;
  ctx.beginPath();
  ctx.arc(mtCx, mtCy, miniTurntableRadius + 8, 0, Math.PI * 2);
  ctx.fillStyle = '#FFF';
  ctx.fill();
  ctx.restore();

  drawMiniTurntable(ctx, mtCx, mtCy, miniTurntableRadius, allOptions, selectedIndex);

  // 4.2 引导文案
  const innerStartY = cardY + 100;
  ctx.fillStyle = AURORA_COLORS.accent;
  ctx.font = '700 26px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText('✨ 决定是你了 ✨', width / 2, innerStartY);

  // 4.3 餐厅名称
  // 根据字数动态调整大小，避免换行
  const nameY = innerStartY + 85;
  let nameFontSize = 80;
  if (selectedOption.name.length > 10) nameFontSize = 52;
  else if (selectedOption.name.length > 6) nameFontSize = 64;

  ctx.font = `800 ${nameFontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display"`;

  // 渐变文字
  const textGrad = ctx.createLinearGradient(0, nameY - 40, 0, nameY + 40);
  textGrad.addColorStop(0.2, '#1D1D1F');
  textGrad.addColorStop(1, '#424245');
  ctx.fillStyle = textGrad;
  ctx.fillText(selectedOption.name, width / 2, nameY);

  // 4.4 标签组
  const tagsY = nameY + 90;
  const tags: { icon: string, text: string }[] = [];
  if (restaurant) {
    tags.push({ icon: '🥘', text: restaurant.cuisineType });
    if (restaurant.distance) tags.push({ icon: '📍', text: formatDistance(restaurant.distance) });
    if (restaurant.rating) tags.push({ icon: '⭐', text: restaurant.rating.toFixed(1) });
  } else if (isCustom) {
    tags.push({ icon: '✏️', text: '自定义选项' });
  }

  // 重新计算标签宽度
  let tempTotalWidth = 0;
  const tagWidths: number[] = [];
  // 标签视觉参数
  const tagIconSize = 26; // icon 字体
  const tagTextSize = 26; // text 字体
  const tagGap = 12; // 图标和文字的间距 (widened)
  const tagPadX = 26;
  const tagPadY = 14;
  const tagMargin = 16; // 标签之间的间距

  ctx.font = `600 ${tagTextSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;

  tags.forEach((tag) => {
    // Measure explicitly
    ctx.font = `${tagIconSize}px -apple-system`;
    const iconW = ctx.measureText(tag.icon).width;
    ctx.font = `600 ${tagTextSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
    const textW = ctx.measureText(tag.text).width;

    // Total tag width
    const w = tagPadX * 2 + iconW + tagGap + textW;
    tagWidths.push(w);
    tempTotalWidth += w;
  });
  tempTotalWidth += (tags.length - 1) * tagMargin;

  // 绘制标签
  let currentTagX = (width - tempTotalWidth) / 2;

  tags.forEach((tag, idx) => {
    const w = tagWidths[idx];
    const h = tagTextSize + tagPadY * 2;
    const y = tagsY - h / 2; // Center vertically at tagsY

    // Bg
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.03)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    roundRect(ctx, currentTagX, y, w, h, h / 2);
    ctx.fillStyle = 'rgba(252,252,254,0.7)'; // Slightly transparent
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.03)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Content
    const contentCenterY = y + h / 2 + 2; // Optical center
    const startX = currentTagX + tagPadX;

    // Icon
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = `${tagIconSize}px -apple-system`;
    ctx.fillStyle = '#000';
    ctx.fillText(tag.icon, startX, contentCenterY);

    const iconRealW = ctx.measureText(tag.icon).width;

    // Text
    ctx.font = `600 ${tagTextSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;
    ctx.fillStyle = '#424245';
    ctx.fillText(tag.text, startX + iconRealW + tagGap, contentCenterY);

    currentTagX += w + tagMargin;
  });

  // --------------------------------------------------------
  // 5. 底部悬浮 Footer (Floating Glass Stack)
  // --------------------------------------------------------
  const footerMarginX = 64;
  const footerWidth = width - footerMarginX * 2;
  const footerHeight = 280; // 适应 QR 240 + padding
  const footerBottomMargin = 80; // Distance from bottom edge
  const footerY = height - footerHeight - footerBottomMargin;

  ctx.save();
  // Deep shadow for floating effect
  ctx.shadowColor = 'rgba(50,50,93,0.15)';
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;

  roundRect(ctx, footerMarginX, footerY, footerWidth, footerHeight, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.95)'; // Near solid white
  ctx.fill();
  ctx.restore();

  // Footer Inner Layout
  // QR Code: Fixed 240px, vertically centered
  const qrSize = 240;
  const qrPadding = (footerHeight - qrSize) / 2; // 20px
  const qrX = footerMarginX + footerWidth - qrSize - qrPadding - 10; // Right aligned with padding
  const qrY = footerY + qrPadding;

  // QR Bg (Subtle frame)
  roundRect(ctx, qrX - 4, qrY - 4, qrSize + 8, qrSize + 8, 16);
  ctx.fillStyle = '#FFF';
  ctx.fill();

  if (qrCodeDataUrl) {
    try {
      const qrImg = await loadImage(qrCodeDataUrl);
      ctx.drawImage(qrImg, qrX, qrY, qrSize, qrSize);
    } catch (e) {
      console.error('QR Load Fail', e);
    }
  }

  // Text Content (Left aligned)
  const textLeftX = footerMarginX + 60;
  const textCenterY = footerY + footerHeight / 2;

  ctx.textAlign = 'left';

  // Title
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '800 42px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText('扫码也来转一转', textLeftX, textCenterY - 24);

  // Subtitle
  ctx.fillStyle = '#86868B';
  ctx.font = '400 28px -apple-system, BlinkMacSystemFont, "SF Pro Display"';
  ctx.fillText('今天吃啥 · 你的美食决策助手', textLeftX, textCenterY + 28);

  return canvas.toDataURL('image/png', 1.0);
}
