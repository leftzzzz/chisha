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
  const searchLabel = isLoading ? '正在寻找' : location ? '开始选择' : '先设置位置';

  // 处理灵感选择
  const handleSuggestionSelect = (suggestion: string) => {
    onQueryChange(suggestion);
  };

  return (
    <section className="mx-auto grid w-full max-w-7xl gap-5 py-2 sm:gap-8 sm:py-6 lg:min-h-[calc(100dvh-7rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:items-center lg:gap-12 lg:py-10">
      <div className="hidden space-y-4 md:block sm:space-y-7">
        <div className="max-w-3xl">
          <p className="mb-3 inline-flex rounded-full border border-black/10 bg-white/60 px-3 py-1 text-xs font-semibold text-[#6f6257] shadow-sm sm:mb-4 sm:text-sm">
            先说口味，再让转盘替你拍板
          </p>
          <h2 className="text-[2.45rem] font-black leading-[0.98] text-dark text-balance sm:text-[clamp(2.75rem,8vw,5.8rem)] sm:leading-[0.95]">
            今天吃啥，别再卡住。
          </h2>
          <p className="mt-4 max-w-xl text-base font-medium leading-7 text-[#66594f] sm:mt-5 sm:text-lg">
            输入想吃的方向，定位附近餐厅，最后交给转盘做决定。
          </p>
        </div>

        <div className="decision-rail hidden sm:grid">
          <div className="rounded-2xl border border-black/10 bg-white/58 p-4 shadow-sm">
            <div className="text-2xl font-black text-primary">1</div>
            <div className="mt-2 text-sm font-bold text-dark">说需求</div>
            <p className="mt-1 text-xs leading-5 text-[#76695e]">清淡、重口、快餐或聚餐都可以</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/58 p-4 shadow-sm">
            <div className="text-2xl font-black text-primary">2</div>
            <div className="mt-2 text-sm font-bold text-dark">定范围</div>
            <p className="mt-1 text-xs leading-5 text-[#76695e]">用当前位置或手动输入地址</p>
          </div>
          <div className="rounded-2xl border border-black/10 bg-white/58 p-4 shadow-sm">
            <div className="text-2xl font-black text-primary">3</div>
            <div className="mt-2 text-sm font-bold text-dark">转起来</div>
            <p className="mt-1 text-xs leading-5 text-[#76695e]">少纠结，直接得到一个去处</p>
          </div>
        </div>
      </div>

      <div className="relative">
        <div className="surface-panel relative space-y-4 rounded-[1.5rem] p-4 sm:space-y-5 sm:rounded-[2rem] sm:p-6">
          <div className="md:hidden">
            <h2 className="text-2xl font-black leading-tight text-dark">今天想吃什么？</h2>
            <p className="mt-1.5 text-sm font-medium leading-6 text-[#76695e]">
              说口味、距离、预算或场景，我来帮你选。
            </p>
          </div>

          <div className="hidden md:block">
            <h3 className="text-xl font-black text-dark sm:text-2xl">把选择交给转盘</h3>
            <p className="mt-1.5 text-sm font-medium leading-6 text-[#76695e] sm:mt-2">
              写得越像真实想法，推荐越贴近当下。
            </p>
          </div>

          <SearchInput
            value={query}
            onChange={onQueryChange}
            onSubmit={onSearch}
            disabled={isLoading}
            error={error}
          />

          <LocationPicker
            location={location}
            onLocationChange={onLocationChange}
            isLoading={isLocating}
            error={locationError}
            onAutoLocate={onAutoLocate}
            onManualAddressSubmit={onManualAddressSubmit}
          />

          {!location && (
            <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-3">
              <div className="flex items-start gap-3">
                <svg
                  className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-sm font-medium leading-6 text-[#7b3b2f]">
                  先设置位置，才能推荐附近可以直接去的餐厅。
                </p>
              </div>
            </div>
          )}

          <Button
            variant="primary"
            size="lg"
            onClick={onSearch}
            disabled={!canSearch}
            loading={isLoading}
            className="w-full"
            ariaLabel={searchLabel}
          >
            {searchLabel}
          </Button>

          <InspirationChips
            onSelect={handleSuggestionSelect}
            disabled={isLoading}
          />
        </div>
      </div>
    </section>
  );
};
