/**
 * RestaurantList 组件
 *
 * 餐厅列表展示
 */

import React from 'react';
import { Restaurant } from '@/types';

export interface RestaurantListProps {
  restaurants: Restaurant[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onDelete?: (index: number) => void;
}

export const RestaurantList: React.FC<RestaurantListProps> = ({
  restaurants,
  selectedIndex,
  onSelect,
  onDelete,
}) => {
  // 格式化距离
  const formatDistance = (distance?: number) => {
    if (!distance) return '';
    if (distance < 1000) return `${Math.round(distance)}m`;
    return `${(distance / 1000).toFixed(1)}km`;
  };

  if (restaurants.length === 0) {
    return (
      <div className="p-8 text-center">
        <svg className="w-16 h-16 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
        <p className="text-gray-500">暂无餐厅数据</p>
      </div>
    );
  }

  return (
    <div className="w-full">
      <h3 className="text-lg font-semibold text-gray-900 mb-3 px-2">
        候选餐厅 ({restaurants.length})
      </h3>
      <div className="space-y-2 max-h-[500px] overflow-y-auto">
        {restaurants.map((restaurant, index) => (
          <div
            key={restaurant.id}
            onClick={() => onSelect(index)}
            className={`
              p-4 rounded-lg border-2 cursor-pointer transition-all duration-200
              ${
                selectedIndex === index
                  ? 'border-primary bg-primary/5 shadow-md'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
            role="button"
            tabIndex={0}
            aria-label={`选择餐厅: ${restaurant.name}`}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(index);
              }
            }}
          >
            <div className="flex items-start justify-between gap-3">
              {/* 序号和信息 */}
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div
                  className={`
                    flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                    ${selectedIndex === index ? 'bg-primary text-white' : 'bg-gray-200 text-gray-600'}
                  `}
                >
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 truncate">
                    {restaurant.name}
                  </h4>
                  <div className="flex items-center gap-2 mt-1 text-sm text-gray-600">
                    <span className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                      {restaurant.cuisineType}
                    </span>
                    {restaurant.distance && (
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        </svg>
                        {formatDistance(restaurant.distance)}
                      </span>
                    )}
                    {restaurant.rating && (
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4 text-yellow-400 fill-current" viewBox="0 0 20 20">
                          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                        </svg>
                        {restaurant.rating.toFixed(1)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 删除按钮 */}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(index);
                  }}
                  className="flex-shrink-0 p-1 text-gray-400 hover:text-red-500 transition-colors rounded focus:outline-none focus:ring-2 focus:ring-red-500"
                  aria-label={`删除 ${restaurant.name}`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
