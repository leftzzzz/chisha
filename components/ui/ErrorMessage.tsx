/**
 * ErrorMessage 组件
 *
 * 错误消息组件，支持重试机制
 */

import React from 'react';
import { Button } from './Button';

export interface ErrorMessageProps {
  error: string | Error;
  onDismiss?: () => void;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({
  error,
  onDismiss,
  actionLabel = '重试',
  onAction,
  className = '',
}) => {
  const errorMessage = typeof error === 'string' ? error : error.message;

  return (
    <div
      className={`bg-red-50 border border-red-200 rounded-lg p-4 animate-slideUp ${className}`}
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        {/* 错误图标 */}
        <div className="flex-shrink-0">
          <svg
            className="h-5 w-5 text-red-500"
            fill="currentColor"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
              clipRule="evenodd"
            />
          </svg>
        </div>

        {/* 错误内容 */}
        <div className="flex-1">
          <h3 className="text-sm font-medium text-red-800">出错了</h3>
          <p className="mt-1 text-sm text-red-700">{errorMessage}</p>

          {/* 操作按钮 */}
          {(onAction || onDismiss) && (
            <div className="mt-3 flex gap-2">
              {onAction && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={onAction}
                  aria-label={actionLabel}
                >
                  {actionLabel}
                </Button>
              )}
              {onDismiss && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onDismiss}
                  aria-label="关闭错误消息"
                >
                  关闭
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 关闭按钮 */}
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-red-400 hover:text-red-600 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            aria-label="关闭"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
};
