/**
 * LocationPicker 组件
 *
 * 位置选择器，支持自动定位和手动输入
 */

import React, { useState, useEffect } from 'react';
import { Location } from '@/types';
import { Button } from '@/components/ui';

export interface LocationPickerProps {
  location: Location | null;
  onLocationChange: (location: Location | null) => void;
  isLoading?: boolean;
  error?: string;
  onAutoLocate: () => void;
  onManualAddressSubmit?: (address: string) => void;
}

export const LocationPicker: React.FC<LocationPickerProps> = ({
  location,
  onLocationChange,
  isLoading = false,
  error,
  onAutoLocate,
  onManualAddressSubmit,
}) => {
  const [manualAddress, setManualAddress] = useState(location?.address || '');
  const [isManual, setIsManual] = useState(false);
  // 保存切换到手动模式前的位置，用于切回时恢复
  const [savedLocation, setSavedLocation] = useState<Location | null>(null);

  // 当 location 变化时，同步更新 manualAddress
  useEffect(() => {
    if (location?.address) {
      setManualAddress(location.address);
    } else if (location === null) {
      setManualAddress('');
    }
  }, [location]);

  // 处理手动地址输入
  const handleManualSubmit = () => {
    if (manualAddress.trim()) {
      // 提交手动地址后，清除保存的位置（因为用户确认了新地址）
      setSavedLocation(null);
      // 调用父组件提供的地址编码方法
      onManualAddressSubmit?.(manualAddress.trim());
      setIsManual(false);
    }
  };

  return (
    <div className="w-full space-y-3">
      <label className="block text-sm font-bold text-dark">
        位置信息
      </label>

      {/* 自动定位按钮 */}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="md"
          onClick={onAutoLocate}
          loading={isLoading}
          disabled={isLoading || isManual}
          className="flex-1"
          ariaLabel="自动定位"
        >
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {isLoading ? '定位中…' : '自动定位'}
        </Button>

        <Button
          variant="secondary"
          size="md"
          onClick={() => {
            const newIsManual = !isManual;
            setIsManual(newIsManual);
            if (newIsManual) {
              // 切换到手动模式：保存当前位置，清空输入框
              if (location) {
                setSavedLocation(location);
              }
              setManualAddress('');
            } else {
              // 切换回自动模式：恢复之前的位置或触发自动定位
              if (savedLocation) {
                // 恢复之前保存的位置
                onLocationChange(savedLocation);
                setSavedLocation(null);
              } else if (!location) {
                // 没有保存的位置也没有当前位置，触发自动定位
                onAutoLocate();
              }
            }
          }}
          disabled={isLoading}
          ariaLabel={isManual ? '使用自动定位' : '手动输入地址'}
        >
          {isManual ? '自动' : '手动'}
        </Button>
      </div>

      {/* 手动地址输入 */}
      {isManual && (
        <div className="space-y-2 animate-slideUp">
          <div className="flex gap-2">
            <input
              type="text"
              value={manualAddress}
              onChange={(e) => setManualAddress(e.target.value)}
              placeholder="输入详细地址…"
              className="min-w-0 flex-1 rounded-xl border border-black/10 bg-[#fffaf1]/88 px-4 py-2 font-medium text-dark placeholder:text-[#9a8d81] transition-[border-color,box-shadow,background-color] duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus:border-primary"
              aria-label="手动输入地址"
              name="manual-address"
              autoComplete="street-address"
            />
            <Button
              variant="primary"
              size="md"
              onClick={handleManualSubmit}
              disabled={!manualAddress.trim()}
              ariaLabel="确认地址"
            >
              确认
            </Button>
          </div>
        </div>
      )}

      {/* 当前位置显示 */}
      {location && !isManual && (
        <div className="rounded-2xl border border-secondary/15 bg-secondary/10 p-3 animate-fadeIn">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-secondary flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-dark">当前位置</p>
              <p className="truncate text-sm font-medium text-[#5f544b]">
                {location.address || `${location.lat.toFixed(6)}, ${location.lng.toFixed(6)}`}
              </p>
            </div>
            <button
              onClick={() => onLocationChange(null)}
              className="rounded-lg p-1 text-[#8a7a6d] transition-colors hover:bg-white/60 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              aria-label="清除位置"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* 错误提示 */}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 animate-slideUp">
          <p className="text-sm font-semibold text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
};
