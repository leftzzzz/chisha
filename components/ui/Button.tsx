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
  const baseStyles = 'inline-flex items-center justify-center whitespace-nowrap font-semibold rounded-xl transition-[background-color,color,border-color,box-shadow,transform] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:active:scale-100';

  // 变体样式
  const variantStyles = {
    primary: 'bg-primary text-white shadow-[0_14px_34px_rgba(232,74,50,0.28)] hover:bg-[#d33e28] focus-visible:ring-primary focus-visible:ring-offset-[#fffaf1]',
    secondary: 'border border-black/10 bg-white/72 text-[#251f1b] shadow-sm hover:bg-white hover:border-black/20 focus-visible:ring-secondary focus-visible:ring-offset-[#fffaf1]',
    danger: 'bg-[#b83222] hover:bg-[#9f2b1e] text-white shadow-[0_14px_34px_rgba(184,50,34,0.22)] focus-visible:ring-[#b83222] focus-visible:ring-offset-[#fffaf1]',
    success: 'bg-secondary hover:bg-[#1b483c] text-white shadow-[0_14px_34px_rgba(35,90,74,0.22)] focus-visible:ring-secondary focus-visible:ring-offset-[#fffaf1]',
  };

  // 尺寸样式
  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-base',
    lg: 'px-6 py-3 text-lg',
  };

  // 悬停效果 - 放大
  const hoverEffect = !disabled && !loading ? 'hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98]' : '';

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
          className="loading-spinner -ml-1 mr-2 h-4 w-4"
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
