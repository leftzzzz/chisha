/**
 * 分享功能工具函数
 *
 * 使用二进制格式 + fflate 压缩，实现极致压缩
 * 支持完整分享模式，朋友可以重新转盘和导航
 */

import { compressShareData, decompressShareData, ShareData } from './binaryCodec';
import { Restaurant, CustomOption } from '@/types';
import QRCode from 'qrcode';

// ==================== 分享链接生成与解析 ====================

/**
 * 生成分享链接
 */
export function generateShareUrl(
  query: string,
  restaurants: Restaurant[],
  customOptions?: CustomOption[]
): string {
  const shareData: ShareData = {
    query,
    restaurants,
    customOptions: customOptions || [],
  };

  const compressed = compressShareData(shareData);
  const baseUrl = typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}`
    : '';

  return `${baseUrl}?s=${compressed}`;
}

/**
 * 解析分享链接参数
 */
export function parseShareData(shareParam: string): {
  query: string;
  restaurants: Restaurant[];
  customOptions: CustomOption[];
} | null {
  const result = decompressShareData(shareParam);
  if (!result) return null;

  return {
    query: result.query,
    restaurants: result.restaurants,
    customOptions: result.customOptions,
  };
}

// ==================== 工具函数 ====================

/**
 * 复制文本到剪贴板
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const result = document.execCommand('copy');
    document.body.removeChild(textArea);
    return result;
  } catch {
    console.error('Failed to copy to clipboard');
    return false;
  }
}

/**
 * 从当前 URL 获取分享参数
 */
export function getShareParamFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  const urlParams = new URLSearchParams(window.location.search);
  // 支持新格式 's' 和旧格式 'share'
  return urlParams.get('s') || urlParams.get('share');
}

/**
 * 清除 URL 中的分享参数
 */
export function clearShareParamFromUrl(): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('s');
  url.searchParams.delete('share');
  window.history.replaceState({}, '', url.toString());
}

/**
 * 生成二维码 Data URL
 */
export async function generateQRCode(url: string, size: number = 300): Promise<string> {
  try {
    const dataUrl = await QRCode.toDataURL(url, {
      width: size,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
      errorCorrectionLevel: 'M',
    });
    return dataUrl;
  } catch (error) {
    console.error('Failed to generate QR code:', error);
    throw error;
  }
}

/**
 * 下载图片
 */
export function downloadImage(dataUrl: string, filename: string = 'share-poster.png'): void {
  const link = document.createElement('a');
  link.download = filename;
  link.href = dataUrl;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 复制图片到剪贴板
 */
export async function copyImageToClipboard(dataUrl: string): Promise<boolean> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    if (navigator.clipboard && 'write' in navigator.clipboard) {
      await navigator.clipboard.write([
        new ClipboardItem({
          [blob.type]: blob,
        }),
      ]);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Failed to copy image to clipboard:', error);
    return false;
  }
}
