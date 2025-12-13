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
  const baseStyles = 'w-full px-4 py-2 border rounded-lg transition-all duration-200 focus:outline-none focus:ring-2';

  // 状态样式
  const stateStyles = error
    ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
    : 'border-gray-300 focus:ring-primary focus:border-primary';

  // 禁用样式
  const disabledStyles = disabled
    ? 'bg-gray-100 cursor-not-allowed text-gray-500'
    : 'bg-white';

  // 组合样式
  const combinedClassName = `${baseStyles} ${stateStyles} ${disabledStyles} ${className}`;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="block text-sm font-medium text-gray-700 mb-2"
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
        />
        {showCount && maxLength && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">
            {value.length}/{maxLength}
          </div>
        )}
      </div>
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 text-sm text-red-500"
          role="alert"
        >
          {error}
        </p>
      )}
    </div>
  );
};
