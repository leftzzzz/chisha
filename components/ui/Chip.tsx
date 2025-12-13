/**
 * Chip 组件
 *
 * 胶囊样式标签组件
 */

import React from 'react';

export interface ChipProps {
  label: string;
  onClose?: () => void;
  variant?: 'default' | 'success' | 'error' | 'warning';
  size?: 'sm' | 'md';
  className?: string;
}

export const Chip: React.FC<ChipProps> = ({
  label,
  onClose,
  variant = 'default',
  size = 'md',
  className = '',
}) => {
  // 变体样式
  const variantStyles = {
    default: 'bg-gray-100 text-gray-700 hover:bg-gray-200',
    success: 'bg-green-100 text-green-700 hover:bg-green-200',
    error: 'bg-red-100 text-red-700 hover:bg-red-200',
    warning: 'bg-orange-100 text-orange-700 hover:bg-orange-200',
  };

  // 尺寸样式
  const sizeStyles = {
    sm: 'px-2 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
  };

  // 组合样式
  const combinedClassName = `inline-flex items-center gap-1 rounded-full font-medium transition-colors ${variantStyles[variant]} ${sizeStyles[size]} ${className}`;

  return (
    <span className={combinedClassName}>
      <span>{label}</span>
      {onClose && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="ml-1 hover:opacity-70 focus:outline-none focus:ring-2 focus:ring-current rounded-full"
          aria-label={`删除 ${label}`}
        >
          <svg
            className="h-3.5 w-3.5"
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
    </span>
  );
};
