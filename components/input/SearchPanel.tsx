/**
 * SearchPanel 组件
 *
 * 集成搜索面板，包含搜索输入、位置选择和灵感建议
 */

import React from 'react';
import { Location } from '@/types';
import { SearchInput } from './SearchInput';
import { LocationPicker } from './LocationPicker';
import { InspirationChips } from './InspirationChips';
import { Button } from '@/components/ui';

export interface SearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  location: Location | null;
  onLocationChange: (location: Location | null) => void;
  onSearch: () => void;
  isLoading?: boolean;
  error?: string;
  locationError?: string;
  onAutoLocate: () => void;
  isLocating?: boolean;
  onManualAddressSubmit?: (address: string) => void;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  query,
  onQueryChange,
  location,
  onLocationChange,
  onSearch,
  isLoading = false,
  error,
  locationError,
  onAutoLocate,
  isLocating = false,
  onManualAddressSubmit,
}) => {
  // 验证是否可以搜索
  const canSearch = query.trim().length > 0 && query.trim().length <= 500 && location !== null && !isLoading;

  // 处理灵感选择
  const handleSuggestionSelect = (suggestion: string) => {
    onQueryChange(suggestion);
  };

  return (
    <div className="w-full space-y-6 p-6 bg-white rounded-lg shadow-lg">
      {/* 标题 */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">今天吃啥？</h2>
        <p className="mt-2 text-sm text-gray-600">
          告诉我你的想法，让我帮你选择
        </p>
      </div>

      {/* 搜索输入 */}
      <div>
        <SearchInput
          value={query}
          onChange={onQueryChange}
          onSubmit={onSearch}
          disabled={isLoading}
          error={error}
        />
      </div>

      {/* 搜索按钮 */}
      <div>
        <Button
          variant="primary"
          size="lg"
          onClick={onSearch}
          disabled={!canSearch}
          loading={isLoading}
          className="w-full"
          ariaLabel="开始搜索"
        >
          {isLoading ? '搜索中...' : '开始搜索'}
        </Button>
      </div>

      {/* 提示信息 */}
      {!location && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-start gap-2">
            <svg
              className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clipRule="evenodd"
              />
            </svg>
            <p className="text-sm text-blue-700">
              请先设置您的位置，以便为您推荐附近的餐厅
            </p>
          </div>
        </div>
      )}

      {/* 位置选择 */}
      <div>
        <LocationPicker
          location={location}
          onLocationChange={onLocationChange}
          isLoading={isLocating}
          error={locationError}
          onAutoLocate={onAutoLocate}
          onManualAddressSubmit={onManualAddressSubmit}
        />
      </div>

      {/* 灵感建议 */}
      <div>
        <InspirationChips
          onSelect={handleSuggestionSelect}
          disabled={isLoading}
        />
      </div>
    </div>
  );
};
