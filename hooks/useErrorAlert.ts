/**
 * useErrorAlert Hook
 *
 * 管理错误弹窗的状态和行为
 *
 * 功能:
 * - 管理错误弹窗的显示/隐藏
 * - 根据错误码获取对应的错误信息
 * - 支持错误的操作回调（重试/返回）
 * - 处理致命错误和可重试错误
 */

'use client';

import { useState, useCallback } from 'react';
import { getErrorInfo } from '@/lib/errorConfig';
import type { ErrorInfo } from '@/types';

export interface UseErrorAlertReturn {
  isOpen: boolean;
  errorInfo: ErrorInfo | null;
  show: (errorCode: string, onAction?: () => void) => void;
  close: () => void;
  onAction?: () => void;
}

export function useErrorAlert(): UseErrorAlertReturn {
  const [isOpen, setIsOpen] = useState(false);
  const [errorInfo, setErrorInfo] = useState<ErrorInfo | null>(null);
  const [onActionCallback, setOnActionCallback] = useState<(() => void) | undefined>();

  const show = useCallback((errorCode: string, onAction?: () => void) => {
    const info = getErrorInfo(errorCode);
    setErrorInfo(info);
    setOnActionCallback(() => onAction);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    // 稍微延迟清空数据，让动画完成
    setTimeout(() => {
      setErrorInfo(null);
      setOnActionCallback(undefined);
    }, 300);
  }, []);

  return {
    isOpen,
    errorInfo,
    show,
    close,
    onAction: onActionCallback,
  };
}
