/**
 * SearchInput 组件
 *
 * 搜索输入框，支持回车提交和字数统计
 */

import React, { useState } from 'react';

export interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  disabled?: boolean;
  error?: string;
  maxLength?: number;
  minLength?: number;
}

export const SearchInput: React.FC<SearchInputProps> = ({
  value,
  onChange,
  onSubmit,
  placeholder = '描述你想吃什么...',
  disabled = false,
  error,
  maxLength = 500,
  minLength = 1,
}) => {
  const [isFocused, setIsFocused] = useState(false);

  // 处理回车提交
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (value.trim().length >= minLength && value.trim().length <= maxLength) {
        onSubmit();
      }
    }
  };

  // 验证输入长度
  const isValid = value.trim().length >= minLength && value.trim().length <= maxLength;
  const showError = !isValid && value.trim().length > 0;

  // 字数统计颜色
  const getCountColor = () => {
    const length = value.length;
    if (length > maxLength * 0.9) return 'text-red-500';
    if (length > maxLength * 0.7) return 'text-orange-500';
    return 'text-gray-400';
  };

  return (
    <div className="w-full">
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          maxLength={maxLength}
          rows={3}
          className={`
            w-full px-4 py-3 pr-20 border rounded-lg resize-none
            transition-all duration-200 focus:outline-none focus:ring-2
            ${
              error || showError
                ? 'border-red-500 focus:ring-red-500 focus:border-red-500'
                : 'border-gray-300 focus:ring-primary focus:border-primary'
            }
            ${disabled ? 'bg-gray-100 cursor-not-allowed text-gray-500' : 'bg-white'}
            ${isFocused ? 'shadow-md' : ''}
          `}
          aria-label="搜索输入框"
          aria-describedby={error ? 'search-error' : 'search-hint'}
          aria-invalid={!!error || showError}
        />

        {/* 字数统计 */}
        <div className={`absolute right-3 bottom-3 text-xs font-medium ${getCountColor()}`}>
          {value.length}/{maxLength}
        </div>
      </div>

      {/* 提示信息 */}
      <div className="mt-2 flex items-center justify-between">
        <p id="search-hint" className="text-xs text-gray-500">
          按 Enter 提交，Shift+Enter 换行
        </p>
        {showError && (
          <p id="search-error" className="text-xs text-red-500" role="alert">
            {value.trim().length < minLength
              ? `至少输入 ${minLength} 个字符`
              : `最多输入 ${maxLength} 个字符`}
          </p>
        )}
        {error && (
          <p id="search-error" className="text-xs text-red-500" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
};
