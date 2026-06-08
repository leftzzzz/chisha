/**
 * Input 组件
 *
 * 通用输入框组件，支持错误状态和验证反馈
 */

import React from 'react';

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  type?: 'text' | 'email' | 'password' | 'number' | 'tel' | 'url';
  label?: string;
  maxLength?: number;
  showCount?: boolean;
  className?: string;
  id?: string;
}

export const Input: React.FC<InputProps> = ({
  value,
  onChange,
  placeholder,
  disabled = false,
  error,
  type = 'text',
  label,
  maxLength,
  showCount = false,
  className = '',
  id,
}) => {
  const inputId = id || `input-${Math.random().toString(36).substr(2, 9)}`;

  // 基础样式
  const baseStyles = 'w-full rounded-xl border px-4 py-2 font-medium transition-[border-color,box-shadow,background-color] duration-200 focus:outline-none focus-visible:ring-2';

  // 状态样式
  const stateStyles = error
    ? 'border-red-500 focus-visible:ring-red-500 focus:border-red-500'
    : 'border-black/10 focus-visible:ring-primary focus:border-primary';

  // 禁用样式
  const disabledStyles = disabled
    ? 'bg-black/5 cursor-not-allowed text-[#8b7c70]'
    : 'bg-[#fffaf1]/88 text-dark placeholder:text-[#9a8d81]';

  // 组合样式
  const combinedClassName = `${baseStyles} ${stateStyles} ${disabledStyles} ${className}`;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-2 block text-sm font-bold text-dark"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          className={combinedClassName}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          name={inputId}
          autoComplete="off"
        />
        {showCount && maxLength && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-[#9a8d81]">
            {value.length}/{maxLength}
          </div>
        )}
      </div>
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 text-sm font-semibold text-red-600"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
