/**
 * ShareModal 组件
 *
 * 分享弹窗，包含海报预览和分享操作
 * - 移动端：底部弹出
 * - PC端：居中悬浮卡片
 */

'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Restaurant, CustomOption, TurntableOption } from '@/types';
import { BottomSheet, Button, useToast } from '@/components/ui';
import {
  generateShareUrl,
  generateQRCode,
  copyToClipboard,
  downloadImage,
} from '@/lib/share';
import { generatePosterCanvas } from '@/lib/posterCanvas';

export interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  restaurants: Restaurant[];
  customOptions: CustomOption[];
  selectedOption: TurntableOption;
  isDesktop?: boolean;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  query,
  restaurants,
  customOptions,
  selectedOption,
  isDesktop = false,
}) => {
  const { showToast } = useToast();

  // 状态
  const [isLoading, setIsLoading] = useState(true);
  const [posterDataUrl, setPosterDataUrl] = useState<string | null>(null);
  const [shortUrl, setShortUrl] = useState<string>('');
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 生成分享链接、二维码和海报
  useEffect(() => {
    if (!isOpen) return;

    setIsLoading(true);
    setPosterDataUrl(null);

    const generateAll = async () => {
      try {
        // 1. 生成完整分享链接（用于二维码和复制）
        const shareUrl = generateShareUrl(query, restaurants, customOptions);
        setShortUrl(shareUrl);

        // 2. 生成二维码（大尺寸确保清晰）
        const qrCode = await generateQRCode(shareUrl, 600);

        // 3. 直接使用 Canvas 生成海报
        const posterUrl = await generatePosterCanvas({
          query,
          selectedOption,
          allOptions: [...restaurants, ...customOptions],
          qrCodeDataUrl: qrCode,
        });

        setPosterDataUrl(posterUrl);
        setIsLoading(false);
      } catch (error) {
        console.error('Failed to generate share data:', error);
        showToast('生成分享数据失败', 'error');
        setIsLoading(false);
      }
    };

    generateAll();
  }, [isOpen, query, restaurants, customOptions, selectedOption, showToast]);

  // 保存海报
  const handleSavePoster = useCallback(async () => {
    if (!posterDataUrl) {
      showToast('海报生成中，请稍候', 'info');
      return;
    }
    setIsSaving(true);
    try {
      downloadImage(posterDataUrl, `今天吃啥-${selectedOption.name}.png`);
      showToast('海报已保存', 'success');
    } finally {
      setIsSaving(false);
    }
  }, [posterDataUrl, selectedOption.name, showToast]);

  // 复制链接
  const handleCopyLink = useCallback(async () => {
    if (!shortUrl) {
      showToast('链接生成中，请稍候', 'info');
      return;
    }

    const success = await copyToClipboard(shortUrl);
    if (success) {
      showToast('链接已复制', 'success');
    } else {
      showToast('复制失败', 'error');
    }
  }, [shortUrl, showToast]);

  // 关闭时重置状态
  useEffect(() => {
    if (!isOpen) {
      setPosterDataUrl(null);
      setShortUrl('');
      setShowFullscreen(false);
      setIsLoading(true);
    }
  }, [isOpen]);

  // 内容渲染
  const content = (
    <>
      {/* 标题 */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">分享海报</h2>
        <button
          onClick={onClose}
          className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition-colors"
          aria-label="关闭"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 海报预览 */}
      <div
        className="relative bg-gradient-to-b from-[#FFF5F0] to-[#FFF0F5] rounded-2xl overflow-hidden mb-4 cursor-pointer"
        style={{ aspectRatio: '3/4' }}
        onClick={() => posterDataUrl && setShowFullscreen(true)}
      >
        {isLoading ? (
          // 加载状态
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="relative w-16 h-16 mb-4">
              {/* 旋转的转盘图标 */}
              <svg className="w-16 h-16 animate-spin" viewBox="0 0 64 64">
                <circle cx="32" cy="32" r="28" fill="none" stroke="#FFE4E1" strokeWidth="4" />
                <path
                  d="M32 4 A28 28 0 0 1 60 32"
                  fill="none"
                  stroke="#FF6B6B"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <p className="text-sm text-gray-500">正在生成海报...</p>
          </div>
        ) : posterDataUrl ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={posterDataUrl}
              alt="分享海报"
              className="w-full h-full object-contain"
            />
            {/* 点击放大提示 */}
            <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
              </svg>
              点击放大
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-sm text-gray-400">海报生成失败</p>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={handleSavePoster}
          disabled={isLoading || isSaving}
          loading={isSaving}
        >
          <svg className="w-5 h-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          保存海报
        </Button>
        <Button
          variant="secondary"
          size="md"
          onClick={handleCopyLink}
          disabled={isLoading || !shortUrl}
        >
          <svg className="w-5 h-5 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
          复制链接
        </Button>
      </div>

      {/* 链接预览 */}
      {shortUrl && (
        <p className="text-xs text-gray-400 text-center mt-3 truncate">
          {shortUrl}
        </p>
      )}
    </>
  );

  // 全屏预览
  const fullscreenPreview = showFullscreen && posterDataUrl && (
    <div
      className="fixed inset-0 z-[200] bg-black/90 flex items-center justify-center"
      onClick={() => setShowFullscreen(false)}
    >
      <button
        className="absolute top-4 right-4 p-2 text-white/80 hover:text-white transition-colors"
        onClick={() => setShowFullscreen(false)}
        aria-label="关闭预览"
      >
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterDataUrl}
        alt="分享海报"
        className="max-w-full max-h-full object-contain p-4"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );

  // PC 端：居中悬浮卡片
  if (isDesktop) {
    if (!isOpen) return null;

    return (
      <>
        {/* 背景遮罩 */}
        <div
          className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* 悬浮卡片 */}
        <div className="fixed inset-0 z-[101] flex items-center justify-center p-4">
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </div>
        </div>

        {fullscreenPreview}
      </>
    );
  }

  // 移动端：底部弹出
  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} maxHeightPercent={85}>
        <div className="px-4 pb-6">
          {content}
        </div>
      </BottomSheet>

      {fullscreenPreview}
    </>
  );
};
