/**
 * ErrorAlert 组件
 *
 * 显示错误弹窗，支持三个级别：
 * - error: 致命错误（红色），显示返回按钮
 * - warning: 可重试错误（橙色），显示重试按钮
 * - info: 信息提示（蓝色），显示关闭按钮
 */

'use client';

import React from 'react';
import type { ErrorSeverity } from '@/types';

export interface ErrorAlertProps {
  isOpen: boolean;
  onClose: () => void;
  onAction?: () => void; // 操作按钮回调（重试/返回）
  title?: string;
  message: string;
  description?: string;
  severity?: ErrorSeverity; // 默认 'warning'
  actionLabel?: string; // 操作按钮文本
}

export const ErrorAlert: React.FC<ErrorAlertProps> = ({
  isOpen,
  onClose,
  onAction,
  title,
  message,
  description,
  severity = 'warning',
  actionLabel,
}) => {
  if (!isOpen) return null;

  // 根据级别选择样式
  const severityStyles = {
    error: {
      container: 'border-l-4 border-red-500 bg-red-50',
      icon: 'text-red-500',
      title: 'text-red-800',
      message: 'text-red-700',
      description: 'text-red-600',
      button: 'bg-red-600 hover:bg-red-700 text-white',
      overlay: 'bg-black/50',
    },
    warning: {
      container: 'border-l-4 border-amber-500 bg-amber-50',
      icon: 'text-amber-500',
      title: 'text-amber-800',
      message: 'text-amber-700',
      description: 'text-amber-600',
      button: 'bg-amber-600 hover:bg-amber-700 text-white',
      overlay: 'bg-black/50',
    },
    info: {
      container: 'border-l-4 border-blue-500 bg-blue-50',
      icon: 'text-blue-500',
      title: 'text-blue-800',
      message: 'text-blue-700',
      description: 'text-blue-600',
      button: 'bg-blue-600 hover:bg-blue-700 text-white',
      overlay: 'bg-black/50',
    },
  };

  const styles = severityStyles[severity];

  // 确定图标
  const icons = {
    error: (
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    ),
    warning: (
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
    info: (
      <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
          clipRule="evenodd"
        />
      </svg>
    ),
  };

  const handleAction = () => {
    if (onAction) {
      onAction();
    }
    onClose();
  };

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 z-40 ${styles.overlay} backdrop-blur-sm`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* 弹窗内容 */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="pointer-events-auto w-full max-w-md">
          <div
            className={`rounded-lg shadow-xl p-6 ${styles.container} animate-slideUp`}
            role="alert"
            aria-live="assertive"
          >
            {/* 头部 - 图标和标题 */}
            <div className="flex items-start gap-3 mb-3">
              <div className={`flex-shrink-0 ${styles.icon}`}>{icons[severity]}</div>
              <div className="flex-1">
                {title && <h3 className={`text-lg font-semibold ${styles.title}`}>{title}</h3>}
                <p className={`font-medium ${styles.message}`}>{message}</p>
              </div>

              {/* 关闭按钮 */}
              <button
                onClick={onClose}
                className={`flex-shrink-0 ${styles.icon} hover:opacity-70 transition-opacity focus:outline-none focus:ring-2 focus:ring-offset-2`}
                aria-label="关闭"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>

            {/* 描述文本 */}
            {description && <p className={`text-sm ${styles.description} mb-4 leading-relaxed`}>{description}</p>}

            {/* 操作按钮 */}
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2"
              >
                关闭
              </button>
              {onAction && actionLabel && (
                <button
                  onClick={handleAction}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 ${styles.button}`}
                >
                  {actionLabel}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
