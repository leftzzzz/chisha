/**
 * 海报 Canvas 绘制工具
 *
 * 使用原生 Canvas API 直接绘制海报，避免 html2canvas 的不稳定性
 */

import { Restaurant, TurntableOption, isCustomOption } from '@/types';

// 马卡龙配色
const COLORS = [
  '#FFB5BA', '#B8E0D2', '#D6EADF', '#EAC4D5',
  '#FFE5B4', '#D4E4ED', '#E8D5C4', '#C9B1FF',
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
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/**
 * 绘制转盘
 */
function drawTurntable(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  radius: number,
  options: TurntableOption[],
  selectedIndex: number
) {
  const total = options.length;
  if (total === 0) return; // 防止除以 0

  const anglePerSegment = (2 * Math.PI) / total;

  // 计算旋转角度（让选中的扇区在顶部）
  const safeSelectedIndex = selectedIndex >= 0 ? selectedIndex : 0;
  const selectedAngle = safeSelectedIndex * anglePerSegment + anglePerSegment / 2;
  const rotation = -selectedAngle + Math.PI / 2;

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(rotation);
  ctx.translate(-centerX, -centerY);

  // 绘制阴影
  ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;

  // 绘制扇区
  for (let i = 0; i < total; i++) {
    const startAngle = i * anglePerSegment - Math.PI / 2;
    const endAngle = (i + 1) * anglePerSegment - Math.PI / 2;

    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius - 4, startAngle, endAngle);
    ctx.closePath();

    ctx.fillStyle = COLORS[i % COLORS.length];
    ctx.fill();

    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // 清除阴影
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 绘制中心白圆
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'white';
  ctx.fill();

  // 绘制中心红点
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = '#FF6B6B';
  ctx.fill();

  ctx.restore();

  // 绘制指针（不旋转）
  ctx.save();
  ctx.shadowColor = 'rgba(255, 107, 107, 0.3)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 4;

  ctx.beginPath();
  ctx.moveTo(centerX - 14, centerY - radius - 16);
  ctx.lineTo(centerX + 14, centerY - radius - 16);
  ctx.lineTo(centerX, centerY - radius + 8);
  ctx.closePath();
  ctx.fillStyle = '#FF6B6B';
  ctx.fill();
  ctx.restore();
}

/**
 * 绘制胶囊标签
 */
function drawPill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  bgColor: string,
  textColor: string,
  fontSize: number = 24,
  paddingX: number = 20,
  paddingY: number = 10,
  icon?: string
) {
  ctx.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif`;

  const displayText = icon ? `${icon} ${text}` : text;
  const textWidth = ctx.measureText(displayText).width;
  const width = textWidth + paddingX * 2;
  const height = fontSize + paddingY * 2;

  // 绘制背景
  roundRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = bgColor;
  ctx.fill();

  // 绘制文字
  ctx.fillStyle = textColor;
  ctx.textBaseline = 'middle';
  ctx.fillText(displayText, x + paddingX, y + height / 2);

  return width;
}

/**
 * 生成海报
 */
export async function generatePosterCanvas(data: PosterData): Promise<string> {
  const { query, selectedOption, allOptions, qrCodeDataUrl } = data;

  // 防御性检查
  if (!selectedOption) {
    throw new Error('selectedOption is required');
  }

  const isCustom = isCustomOption(selectedOption);
  const restaurant = isCustom ? null : (selectedOption as Restaurant);
  const selectedIndex = allOptions.findIndex(opt => opt.id === selectedOption.id);

  // 创建 canvas
  const canvas = document.createElement('canvas');
  const width = 1080;
  const height = 1440;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');

  // 绘制背景渐变
  const bgGradient = ctx.createLinearGradient(0, 0, width * 0.3, height);
  bgGradient.addColorStop(0, '#FFF8F6');
  bgGradient.addColorStop(0.5, '#FFF5F8');
  bgGradient.addColorStop(1, '#FDF6FF');
  ctx.fillStyle = bgGradient;
  ctx.fillRect(0, 0, width, height);

  // 绘制装饰性渐变圆
  const grad1 = ctx.createRadialGradient(width + 100, -100, 0, width + 100, -100, 400);
  grad1.addColorStop(0, 'rgba(255, 182, 193, 0.15)');
  grad1.addColorStop(1, 'transparent');
  ctx.fillStyle = grad1;
  ctx.fillRect(0, 0, width, height);

  const grad2 = ctx.createRadialGradient(-100, height + 50, 0, -100, height + 50, 350);
  grad2.addColorStop(0, 'rgba(200, 180, 255, 0.12)');
  grad2.addColorStop(1, 'transparent');
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, width, height);

  // 绘制转盘外圈光晕
  const turntableCenterX = width / 2;
  const turntableCenterY = 210;
  const turntableRadius = 110;

  ctx.beginPath();
  ctx.arc(turntableCenterX, turntableCenterY, turntableRadius + 30, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
  ctx.fill();

  // 绘制转盘
  drawTurntable(ctx, turntableCenterX, turntableCenterY, turntableRadius, allOptions, selectedIndex);

  // 绘制标题
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '700 72px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.fillText('今天吃啥?', width / 2, 400);

  // 绘制副标题
  ctx.fillStyle = '#6E6E73';
  ctx.font = '400 28px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.fillText(query ? `「${query}」` : '让选择变得简单', width / 2, 450);

  // 绘制结果卡片
  const cardX = 64;
  const cardY = 510;
  const cardWidth = width - 128;
  const cardHeight = 280;

  // 卡片阴影
  ctx.shadowColor = 'rgba(255, 107, 107, 0.06)';
  ctx.shadowBlur = 48;
  ctx.shadowOffsetY = 12;

  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 32);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.fill();

  // 清除阴影
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;

  // 卡片边框
  roundRect(ctx, cardX, cardY, cardWidth, cardHeight, 32);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 绘制选中标签
  ctx.textAlign = 'left';
  const pillGradient = ctx.createLinearGradient(cardX + 48, cardY + 48, cardX + 200, cardY + 48);
  pillGradient.addColorStop(0, '#FF6B6B');
  pillGradient.addColorStop(1, '#FF8E8E');

  ctx.font = '600 22px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  const pillText = '✦ 转盘选中';
  const pillWidth = ctx.measureText(pillText).width + 48;

  roundRect(ctx, cardX + 48, cardY + 48, pillWidth, 44, 22);
  ctx.fillStyle = pillGradient;
  ctx.fill();

  // 标签阴影
  ctx.shadowColor = 'rgba(255, 107, 107, 0.25)';
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  roundRect(ctx, cardX + 48, cardY + 48, pillWidth, 44, 22);
  ctx.fillStyle = pillGradient;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  ctx.fillStyle = 'white';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillText, cardX + 48 + 24, cardY + 48 + 22);

  // 绘制餐厅名称
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '700 52px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillText(selectedOption.name, cardX + 48, cardY + 120);

  // 绘制标签组
  let tagX = cardX + 48;
  const tagY = cardY + 195;

  if (restaurant) {
    // 菜系标签
    const cuisineWidth = drawPill(
      ctx, tagX, tagY,
      restaurant.cuisineType,
      'rgba(255, 107, 107, 0.12)',
      '#E85555'
    );
    tagX += cuisineWidth + 12;

    // 距离标签
    if (restaurant.distance) {
      const distanceText = restaurant.distance < 1000
        ? `${Math.round(restaurant.distance)}m`
        : `${(restaurant.distance / 1000).toFixed(1)}km`;
      const distanceWidth = drawPill(
        ctx, tagX, tagY,
        distanceText,
        'rgba(110, 110, 115, 0.08)',
        '#6E6E73',
        24, 20, 10, '📍'
      );
      tagX += distanceWidth + 12;
    }

    // 评分标签
    if (restaurant.rating) {
      drawPill(
        ctx, tagX, tagY,
        restaurant.rating.toFixed(1),
        'rgba(255, 193, 7, 0.12)',
        '#D4A000',
        24, 20, 10, '⭐'
      );
    }
  } else if (isCustom) {
    drawPill(
      ctx, tagX, tagY,
      '自定义选项',
      'rgba(110, 110, 115, 0.08)',
      '#6E6E73'
    );
  }

  // 底部区域
  ctx.textAlign = 'center';
  ctx.fillStyle = '#1D1D1F';
  ctx.font = '600 28px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.fillText('扫码一起来选吧', width / 2, height - 460);

  // 绘制二维码容器
  const qrContainerSize = 360;
  const qrX = (width - qrContainerSize) / 2;
  const qrY = height - 440;

  // 二维码容器阴影
  ctx.shadowColor = 'rgba(0, 0, 0, 0.06)';
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 4;

  roundRect(ctx, qrX, qrY, qrContainerSize, qrContainerSize, 28);
  ctx.fillStyle = 'white';
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;

  // 绘制二维码
  if (qrCodeDataUrl) {
    try {
      const qrImage = await loadImage(qrCodeDataUrl);
      const qrSize = 300; // 二维码尺寸增大50%
      const qrOffsetX = qrX + (qrContainerSize - qrSize) / 2;
      const qrOffsetY = qrY + (qrContainerSize - qrSize) / 2;
      ctx.drawImage(qrImage, qrOffsetX, qrOffsetY, qrSize, qrSize);
    } catch (e) {
      console.error('Failed to draw QR code:', e);
      // 绘制占位符
      ctx.fillStyle = '#F5F5F7';
      roundRect(ctx, qrX + 20, qrY + 20, qrContainerSize - 40, qrContainerSize - 40, 12);
      ctx.fill();
    }
  }

  // 绘制底部品牌
  ctx.fillStyle = '#8E8E93';
  ctx.font = '400 22px -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif';
  ctx.fillText('今天吃啥 · 让选择变得简单', width / 2, height - 50);

  return canvas.toDataURL('image/png', 1.0);
}
