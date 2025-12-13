/**
 * ResultPanel 组件
 *
 * 结果展示面板，集成加载、结果、错误和空状态
 */

import React from 'react';
import { Restaurant } from '@/types';
import { RestaurantCard } from './RestaurantCard';
import { Loading, ErrorMessage } from '@/components/ui';

export interface ResultPanelProps {
  restaurant: Restaurant | null;
  isLoading?: boolean;
  error?: string | null;
  onNavigate?: () => void;
  onRemove?: () => void;
  onRetry?: () => void;
  onSave?: () => void;
  onClose?: () => void;
}

export const ResultPanel: React.FC<ResultPanelProps> = ({
  restaurant,
  isLoading = false,
  error,
  onNavigate,
  onRemove,
  onRetry,
  onSave,
  onClose,
}) => {
  // 加载状态
  if (isLoading) {
    return (
      <div className="w-full p-8">
        <Loading
          variant="spinner"
          size="lg"
          message="正在加载餐厅信息..."
        />
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div className="w-full p-8">
        <ErrorMessage
          error={error}
          onAction={onRetry}
          actionLabel="重试"
          onDismiss={onClose}
        />
      </div>
    );
  }

  // 空状态
  if (!restaurant) {
    return (
      <div className="w-full p-8 text-center">
        <svg
          className="w-20 h-20 mx-auto text-gray-300 mb-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无结果</h3>
        <p className="text-sm text-gray-500 mb-4">
          请先进行搜索或转动转盘
        </p>
      </div>
    );
  }

  // 有结果 - 显示餐厅卡片
  return (
    <div className="w-full p-4 animate-slideUp">
      <RestaurantCard
        restaurant={restaurant}
        onNavigate={onNavigate}
        onRemove={onRemove}
        onSave={onSave}
        onClose={onClose}
      />
    </div>
  );
};
