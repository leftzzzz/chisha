/**
 * HistoryDetail 组件
 *
 * 显示历史记录详细信息
 */

'use client';

import React from 'react';
import { TurntableRecord } from '@/types';
import { Card, Button } from '../ui';

interface HistoryDetailProps {
  record: TurntableRecord;
  onClose: () => void;
  onReuse?: (record: TurntableRecord) => void;
}

export const HistoryDetail: React.FC<HistoryDetailProps> = ({
  record,
  onClose,
  onReuse,
}) => {
  const formatDistance = (distance?: number) => {
    if (!distance) return '';
    if (distance < 1000) return `${Math.round(distance)}m`;
    return `${(distance / 1000).toFixed(1)}km`;
  };

  const handleReuse = () => {
    if (onReuse) {
      onReuse(record);
    }
  };

  return (
    <div className="space-y-6">
      {/* 时间 */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">记录时间</p>
          <p className="text-base text-gray-900 mt-1">
            {new Date(record.timestamp).toLocaleString('zh-CN', {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
        {onReuse && (
          <Button variant="primary" size="sm" onClick={handleReuse}>
            重新使用
          </Button>
        )}
      </div>

      {/* 需求 */}
      <Card className="bg-blue-50 border-blue-200">
        <h3 className="text-sm font-medium text-gray-700 mb-2">您的需求</h3>
        <p className="text-base text-gray-900">{record.query}</p>
      </Card>

      {/* 位置信息 */}
      <Card className="bg-gray-50">
        <h3 className="text-sm font-medium text-gray-700 mb-2">搜索位置</h3>
        <div className="text-sm text-gray-600 space-y-1">
          {record.location.address && (
            <p>{record.location.address}</p>
          )}
          <p className="text-xs text-gray-500">
            经度: {record.location.lng.toFixed(6)}, 纬度: {record.location.lat.toFixed(6)}
          </p>
        </div>
      </Card>

      {/* 选中的餐厅 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">最终选择</h3>
        <Card className="bg-green-50 border-green-200">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <h4 className="font-semibold text-lg text-gray-900 mb-1">
                {record.selected.name}
              </h4>
              <div className="flex flex-wrap gap-2 mb-2">
                <span className="px-2 py-1 bg-white rounded text-xs text-gray-700 border border-green-200">
                  {record.selected.cuisineType}
                </span>
                {record.selected.distance && (
                  <span className="px-2 py-1 bg-white rounded text-xs text-gray-700 border border-green-200">
                    {formatDistance(record.selected.distance)}
                  </span>
                )}
                {record.selected.rating && (
                  <span className="px-2 py-1 bg-white rounded text-xs text-gray-700 border border-green-200">
                    ⭐ {record.selected.rating}
                  </span>
                )}
                {record.selected.averagePrice && (
                  <span className="px-2 py-1 bg-white rounded text-xs text-gray-700 border border-green-200">
                    人均 ¥{record.selected.averagePrice}
                  </span>
                )}
              </div>
            </div>
            <svg className="w-8 h-8 text-green-500 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="space-y-1 text-sm text-gray-700 border-t border-green-200 pt-3">
            <p className="flex items-start gap-2">
              <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              {record.selected.address}
            </p>
            {record.selected.phone && (
              <p className="flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {record.selected.phone}
              </p>
            )}
            {record.selected.openingHours && (
              <p className="flex items-center gap-2">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {record.selected.openingHours}
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* 所有参与的餐厅 */}
      <div>
        <h3 className="text-sm font-medium text-gray-700 mb-3">
          参与转盘的餐厅 ({record.restaurants.length})
        </h3>
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {record.restaurants.map((restaurant) => (
            <Card
              key={restaurant.id}
              className={`${
                restaurant.id === record.selected.id
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gray-50 border-gray-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <p className="font-medium text-sm text-gray-900">
                    {restaurant.name}
                  </p>
                  <div className="flex flex-wrap gap-2 mt-1">
                    <span className="text-xs text-gray-600">
                      {restaurant.cuisineType}
                    </span>
                    {restaurant.distance && (
                      <span className="text-xs text-gray-500">
                        {formatDistance(restaurant.distance)}
                      </span>
                    )}
                    {restaurant.rating && (
                      <span className="text-xs text-gray-600">
                        ⭐ {restaurant.rating}
                      </span>
                    )}
                  </div>
                </div>
                {restaurant.id === record.selected.id && (
                  <svg className="w-5 h-5 text-green-500 flex-shrink-0 ml-2" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
};
