/**
 * InspirationChips 组件
 *
 * 灵感建议胶囊组件
 */

import React from 'react';

export interface InspirationChipsProps {
  onSelect: (suggestion: string) => void;
  disabled?: boolean;
}

// 预设建议列表
const SUGGESTIONS = [
  '我想吃点清淡的',
  '附近有什么好吃的',
  '想吃火锅，人多的地方',
  '轻食，不要太贵',
  '来点辣的川菜',
  '日料或者韩餐',
  '适合聚餐的餐厅',
  '快餐，方便快捷',
];

export const InspirationChips: React.FC<InspirationChipsProps> = ({
  onSelect,
  disabled = false,
}) => {
  return (
    <div className="w-full">
      <label className="mb-3 block text-sm font-bold text-dark">
        或者试试这些
      </label>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => !disabled && onSelect(suggestion)}
            disabled={disabled}
            className={`
              rounded-full px-4 py-2 text-sm font-semibold
              transition-[background-color,color,border-color,transform,box-shadow] duration-200
              ${
                disabled
                  ? 'bg-black/5 text-[#9a8d81] cursor-not-allowed'
                  : 'border border-black/10 bg-white/64 text-[#3d342e] hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary hover:text-white hover:shadow-[0_12px_28px_rgba(232,74,50,0.18)] active:translate-y-0 active:scale-[0.98]'
              }
              focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-[#fffaf1]
            `}
            aria-label={`选择建议: ${suggestion}`}
          >
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
};
