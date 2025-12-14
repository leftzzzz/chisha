/**
 * BottomSheet 组件
 *
 * Apple 风格底部弹出卡片，支持手势下拉关闭
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
  /** 是否显示拖动条 */
  showHandle?: boolean;
  /** 点击遮罩关闭 */
  closeOnOverlayClick?: boolean;
  /** 最大高度百分比 (0-100) */
  maxHeightPercent?: number;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  isOpen,
  onClose,
  children,
  showHandle = true,
  closeOnOverlayClick = true,
  maxHeightPercent = 85,
}) => {
  const sheetRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const startY = useRef(0);
  const currentY = useRef(0);

  // 关闭动画状态
  const [isClosing, setIsClosing] = useState(false);

  // 处理关闭
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setDragOffset(0);
      onClose();
    }, 300);
  }, [onClose]);

  // ESC 键关闭
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, handleClose]);

  // 触摸开始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    setIsDragging(true);
  }, []);

  // 触摸移动
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return;
    currentY.current = e.touches[0].clientY;
    const delta = currentY.current - startY.current;
    // 只允许向下拖动
    if (delta > 0) {
      setDragOffset(delta);
    }
  }, [isDragging]);

  // 触摸结束
  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
    // 如果拖动超过 100px，关闭
    if (dragOffset > 100) {
      handleClose();
    } else {
      setDragOffset(0);
    }
  }, [dragOffset, handleClose]);

  // 鼠标拖动支持 (桌面端)
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    startY.current = e.clientY;
    currentY.current = e.clientY;
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      currentY.current = e.clientY;
      const delta = currentY.current - startY.current;
      if (delta > 0) {
        setDragOffset(delta);
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      if (dragOffset > 100) {
        handleClose();
      } else {
        setDragOffset(0);
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, dragOffset, handleClose]);

  if (!isOpen && !isClosing) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
    >
      {/* 遮罩层 - 毛玻璃效果 */}
      <div
        className={`
          absolute inset-0 bg-black/30 backdrop-blur-sm
          transition-opacity duration-300
          ${isClosing ? 'opacity-0' : 'opacity-100'}
        `}
        onClick={closeOnOverlayClick ? handleClose : undefined}
        aria-hidden="true"
      />

      {/* 底部弹出卡片 */}
      <div
        ref={sheetRef}
        className={`
          absolute bottom-0 left-0 right-0
          bg-white rounded-t-3xl shadow-2xl
          transform transition-transform
          ${isDragging ? 'transition-none' : 'duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]'}
          ${isClosing ? 'translate-y-full' : 'translate-y-0'}
        `}
        style={{
          maxHeight: `${maxHeightPercent}vh`,
          transform: isClosing
            ? 'translateY(100%)'
            : `translateY(${dragOffset}px)`,
          paddingBottom: 'env(safe-area-inset-bottom, 20px)',
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* 拖动条 */}
        {showHandle && (
          <div
            className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing"
            onMouseDown={handleMouseDown}
          >
            <div className="w-10 h-1 bg-gray-300 rounded-full" />
          </div>
        )}

        {/* 内容区域 */}
        <div
          className="overflow-y-auto overscroll-contain"
          style={{ maxHeight: `calc(${maxHeightPercent}vh - 40px)` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
};
