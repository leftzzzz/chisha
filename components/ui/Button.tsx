/**
 * Button 组件
 *
 * 通用按钮组件，支持多种变体、尺寸和状态
 */

import React from 'react';

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
  ariaLabel?: string;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  onClick,
  disabled = false,
  variant = 'primary',
  size = 'md',
  loading = false,
  type = 'button',
  className = '',
  ariaLabel,
}) => {
  // 基础样式
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  // 变体样式
  const variantStyles = {
    primary: 'bg-primary hover:bg-primary/90 text-white focus:ring-primary',
    secondary: 'bg-secondary hover:bg-secondary/90 text-white focus:ring-secondary',
    danger: 'bg-red-500 hover:bg-red-600 text-white focus:ring-red-500',
    success: 'bg-green-500 hover:bg-green-600 text-white focus:ring-green-500',
  };

  // 尺寸样式
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  // 悬停效果 - 放大
  const hoverEffect = !disabled && !loading ? 'hover:scale-105' : '';

  // 组合样式
  const combinedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${hoverEffect} ${className}`;

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={combinedClassName}
      aria-label={ariaLabel || (typeof children === 'string' ? children : undefined)}
      aria-busy={loading}
    >
      {loading && (
        <svg
          className="animate-spin -ml-1 mr-2 h-4 w-4"
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
      )}
      {children}
    </button>
  );
};
