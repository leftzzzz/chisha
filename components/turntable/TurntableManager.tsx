/**
 * TurntableManager 组件
 *
 * 转盘选项管理面板，支持：
 * - 查看/删除转盘上的选项
 * - 从候补池添加餐厅
 * - 恢复已移除的餐厅
 * - 添加自定义选项（搜索或纯文字）
 */

'use client';

import React, { useState, useCallback } from 'react';
import { Restaurant, CustomOption, Location } from '@/types';
import { BottomSheet } from '@/components/ui';
import { searchRestaurants } from '@/lib/api';

export interface TurntableManagerProps {
  isOpen: boolean;
  onClose: () => void;
  // 转盘上的选项
  restaurants: Restaurant[];
  customOptions: CustomOption[];
  // 候补池
  candidateRestaurants: Restaurant[];
  // 已移除
  removedRestaurants: Restaurant[];
  // 用户位置（用于搜索）
  userLocation: Location | null;
  // 操作回调
  onRestoreRestaurant: (index: number) => void;
  onAddFromCandidates: (index: number) => void;
  onRemoveToCandidates: (index: number) => void;
  onAddCustomOption: (option: CustomOption) => void;
  onRemoveCustomOption: (id: string) => void;
  onAddRestaurant: (restaurant: Restaurant) => void;
}

export const TurntableManager: React.FC<TurntableManagerProps> = ({
  isOpen,
  onClose,
  restaurants,
  customOptions,
  candidateRestaurants,
  removedRestaurants,
  userLocation,
  onRestoreRestaurant,
  onAddFromCandidates,
  onRemoveToCandidates,
  onAddCustomOption,
  onRemoveCustomOption,
  onAddRestaurant,
}) => {
  // 添加选项输入状态
  const [inputValue, setInputValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<Restaurant[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // 计算总选项数
  const totalOptions = restaurants.length + customOptions.length;
  const isFull = totalOptions >= 8;

  // 搜索餐厅
  const handleSearch = useCallback(async () => {
    if (!inputValue.trim() || !userLocation) return;

    setIsSearching(true);
    setShowSearchResults(true);
    try {
      const results = await searchRestaurants({
        keywords: [inputValue.trim()],
        location: userLocation,
        distance: 5000,
        count: 5,
      });
      setSearchResults(results);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [inputValue, userLocation]);

  // 添加纯文字选项
  const handleAddText = useCallback(() => {
    if (!inputValue.trim()) return;

    const option: CustomOption = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: inputValue.trim(),
      isCustom: true,
    };
    onAddCustomOption(option);
    setInputValue('');
    setShowSearchResults(false);
    setSearchResults([]);
  }, [inputValue, onAddCustomOption]);

  // 从搜索结果添加餐厅
  const handleAddFromSearch = useCallback((restaurant: Restaurant) => {
    onAddRestaurant(restaurant);
    setInputValue('');
    setShowSearchResults(false);
    setSearchResults([]);
  }, [onAddRestaurant]);

  // 关闭搜索结果
  const handleCloseSearchResults = useCallback(() => {
    setShowSearchResults(false);
    setSearchResults([]);
  }, []);

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} maxHeightPercent={85}>
      <div className="px-4 pb-6">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">管理选项</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="关闭"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 转盘上的选项 */}
        <Section
          title="转盘上"
          count={totalOptions}
          maxCount={8}
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2" />
            </svg>
          }
        >
          {restaurants.length === 0 && customOptions.length === 0 ? (
            <EmptyState text="暂无选项" />
          ) : (
            <div className="space-y-2">
              {restaurants.map((restaurant, index) => (
                <OptionItem
                  key={restaurant.id}
                  name={restaurant.name}
                  subtitle={restaurant.cuisineType}
                  onAction={() => onRemoveToCandidates(index)}
                  actionType="remove"
                />
              ))}
              {customOptions.map((option) => (
                <OptionItem
                  key={option.id}
                  name={option.name}
                  subtitle="自定义"
                  onAction={() => onRemoveCustomOption(option.id)}
                  actionType="delete"
                />
              ))}
            </div>
          )}
        </Section>

        {/* 候补池 */}
        {candidateRestaurants.length > 0 && (
          <Section
            title="候补池"
            count={candidateRestaurants.length}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            }
          >
            <div className="space-y-2">
              {candidateRestaurants.map((restaurant, index) => (
                <OptionItem
                  key={restaurant.id}
                  name={restaurant.name}
                  subtitle={restaurant.cuisineType}
                  onAction={() => onAddFromCandidates(index)}
                  actionType="add"
                  disabled={isFull}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 已移除 */}
        {removedRestaurants.length > 0 && (
          <Section
            title="已移除"
            count={removedRestaurants.length}
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            }
          >
            <div className="space-y-2">
              {removedRestaurants.map((restaurant, index) => (
                <OptionItem
                  key={restaurant.id}
                  name={restaurant.name}
                  subtitle={restaurant.cuisineType}
                  onAction={() => onRestoreRestaurant(index)}
                  actionType="restore"
                  disabled={isFull}
                />
              ))}
            </div>
          </Section>
        )}

        {/* 添加自定义选项 */}
        <Section
          title="添加选项"
          icon={
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          }
        >
          <div className="space-y-3">
            {/* 输入框 */}
            <div className="flex gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="输入餐厅名称..."
                className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSearch();
                  }
                }}
                disabled={isFull}
              />
              <button
                onClick={handleSearch}
                disabled={!inputValue.trim() || !userLocation || isSearching || isFull}
                className="px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isSearching ? '搜索中...' : '搜索'}
              </button>
            </div>

            {/* 直接添加为文字按钮 */}
            {inputValue.trim() && !showSearchResults && (
              <button
                onClick={handleAddText}
                disabled={isFull}
                className="w-full px-3 py-2 text-sm text-gray-600 border border-dashed border-gray-300 rounded-lg hover:border-gray-400 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                直接添加「{inputValue.trim()}」为选项
              </button>
            )}

            {/* 搜索结果 */}
            {showSearchResults && (
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-200">
                  <span className="text-xs font-medium text-gray-500">搜索结果</span>
                  <button
                    onClick={handleCloseSearchResults}
                    className="text-gray-400 hover:text-gray-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                {isSearching ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-500">
                    搜索中...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="px-3 py-4">
                    <p className="text-center text-sm text-gray-500 mb-2">未找到餐厅</p>
                    <button
                      onClick={handleAddText}
                      disabled={isFull}
                      className="w-full px-3 py-2 text-sm text-primary border border-primary rounded-lg hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      添加「{inputValue.trim()}」为自定义选项
                    </button>
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100">
                    {searchResults.map((restaurant) => (
                      <button
                        key={restaurant.id}
                        onClick={() => handleAddFromSearch(restaurant)}
                        disabled={isFull}
                        className="w-full px-3 py-2 text-left hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <div className="font-medium text-sm text-gray-900">{restaurant.name}</div>
                        <div className="text-xs text-gray-500">
                          {restaurant.cuisineType}
                          {restaurant.distance && ` · ${(restaurant.distance / 1000).toFixed(1)}km`}
                        </div>
                      </button>
                    ))}
                    <button
                      onClick={handleAddText}
                      disabled={isFull}
                      className="w-full px-3 py-2 text-center text-sm text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      或直接添加「{inputValue.trim()}」
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 已满提示 */}
            {isFull && (
              <p className="text-xs text-amber-600 text-center">
                转盘已满（最多8个选项），请先移除一些选项
              </p>
            )}
          </div>
        </Section>
      </div>
    </BottomSheet>
  );
};

// 分区组件
interface SectionProps {
  title: string;
  count?: number;
  maxCount?: number;
  icon?: React.ReactNode;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, count, maxCount, icon, children }) => (
  <div className="mb-6">
    <div className="flex items-center gap-2 mb-3">
      {icon && <span className="text-gray-400">{icon}</span>}
      <h3 className="text-sm font-medium text-gray-700">{title}</h3>
      {count !== undefined && (
        <span className="text-xs text-gray-400">
          ({count}{maxCount ? `/${maxCount}` : ''})
        </span>
      )}
    </div>
    {children}
  </div>
);

// 空状态组件
interface EmptyStateProps {
  text: string;
}

const EmptyState: React.FC<EmptyStateProps> = ({ text }) => (
  <div className="py-4 text-center text-sm text-gray-400">
    {text}
  </div>
);

// 选项条目组件
interface OptionItemProps {
  name: string;
  subtitle?: string;
  onAction: () => void;
  actionType: 'add' | 'remove' | 'delete' | 'restore';
  disabled?: boolean;
}

const OptionItem: React.FC<OptionItemProps> = ({
  name,
  subtitle,
  onAction,
  actionType,
  disabled = false,
}) => {
  const actionConfig = {
    add: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      ),
      className: 'text-green-600 hover:bg-green-50',
      label: '添加',
    },
    remove: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
        </svg>
      ),
      className: 'text-amber-600 hover:bg-amber-50',
      label: '移除',
    },
    delete: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      ),
      className: 'text-red-600 hover:bg-red-50',
      label: '删除',
    },
    restore: {
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
        </svg>
      ),
      className: 'text-blue-600 hover:bg-blue-50',
      label: '恢复',
    },
  };

  const config = actionConfig[actionType];

  return (
    <div className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm text-gray-900 truncate">{name}</div>
        {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
      </div>
      <button
        onClick={onAction}
        disabled={disabled}
        className={`ml-2 p-2 rounded-lg transition-colors ${config.className} ${
          disabled ? 'opacity-50 cursor-not-allowed' : ''
        }`}
        aria-label={config.label}
      >
        {config.icon}
      </button>
    </div>
  );
};
