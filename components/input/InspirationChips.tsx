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
      <label className="block text-sm font-medium text-gray-700 mb-3">
        或者试试这些
      </label>
      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion, index) => (
          <button
            key={index}
            onClick={() => !disabled && onSelect(suggestion)}
            disabled={disabled}
            className={`
              px-4 py-2 rounded-full text-sm font-medium
              transition-all duration-200
              ${
                disabled
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-700 hover:bg-primary hover:text-white hover:scale-105 active:scale-95'
              }
              focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2
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
