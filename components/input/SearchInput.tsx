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
  placeholder = '比如：想吃热乎的，别太贵，走路 15 分钟内…',
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
    if (length > maxLength * 0.9) return 'text-red-600';
    if (length > maxLength * 0.7) return 'text-primary';
    return 'text-[#9a8d81]';
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
            min-h-[9.5rem] w-full resize-none rounded-3xl border px-5 py-4 pr-20 text-lg font-semibold leading-7 text-dark placeholder:text-[#9a8d81]
            shadow-inner transition-[border-color,box-shadow,background-color] duration-200 focus:outline-none focus-visible:ring-2
            ${
              error || showError
                ? 'border-red-500 focus-visible:ring-red-500 focus:border-red-500'
                : 'border-black/10 focus-visible:ring-primary focus:border-primary'
            }
            ${disabled ? 'bg-black/5 cursor-not-allowed text-[#8b7c70]' : 'bg-[#fffaf1]/88'}
            ${isFocused ? 'shadow-[inset_0_1px_0_rgba(255,255,255,0.7),0_0_0_4px_rgba(232,74,50,0.08)]' : ''}
          `}
          aria-label="搜索输入框"
          aria-describedby={error ? 'search-error' : 'search-hint'}
          aria-invalid={!!error || showError}
        />

        {/* 字数统计 */}
        <div className={`absolute bottom-4 right-5 text-xs font-bold ${getCountColor()}`}>
          {value.length}/{maxLength}
        </div>
      </div>

      {/* 错误信息 */}
      {(showError || error) && (
        <div className="mt-2 flex items-center justify-end">
          {showError && (
            <p id="search-error" className="text-xs font-semibold text-red-600" role="alert">
              {value.trim().length < minLength
                ? `至少输入 ${minLength} 个字符`
                : `最多输入 ${maxLength} 个字符`}
            </p>
          )}
          {error && (
            <p id="search-error" className="text-xs font-semibold text-red-600" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
};
