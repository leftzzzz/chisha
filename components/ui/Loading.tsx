/**
 * Loading 组件
 *
 * 加载动画组件，支持多种变体
 */

import React from 'react';

export interface LoadingProps {
  message?: string;
  variant?: 'spinner' | 'dots' | 'pulse';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const Loading: React.FC<LoadingProps> = ({
  message,
  variant = 'spinner',
  size = 'md',
  className = '',
}) => {
  // 尺寸映射
  const sizeMap = {
    sm: { spinner: 'h-4 w-4', dot: 'h-2 w-2', text: 'text-sm' },
    md: { spinner: 'h-8 w-8', dot: 'h-3 w-3', text: 'text-base' },
    lg: { spinner: 'h-12 w-12', dot: 'h-4 w-4', text: 'text-lg' },
  };

  // Spinner 变体
  const renderSpinner = () => (
    <svg
      className={`animate-spin ${sizeMap[size].spinner}`}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );

  // Dots 变体
  const renderDots = () => (
    <div className="flex space-x-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className={`${sizeMap[size].dot} bg-primary rounded-full animate-pulse`}
          style={{ animationDelay: `${i * 0.15}s` }}
          aria-hidden="true"
        />
      ))}
    </div>
  );

  // Pulse 变体
  const renderPulse = () => (
    <div
      className={`${sizeMap[size].spinner} bg-primary rounded-full animate-pulse`}
      aria-hidden="true"
    />
  );

  const loadingVariants = {
    spinner: renderSpinner,
    dots: renderDots,
    pulse: renderPulse,
  };

  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      {loadingVariants[variant]()}
      {message && (
        <p className={`${sizeMap[size].text} text-gray-600 font-medium`}>
          {message}
        </p>
      )}
      <span className="sr-only">加载中…</span>
    </div>
  );
};
