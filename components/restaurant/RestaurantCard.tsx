/**
 * RestaurantCard 组件
 *
 * 餐厅详情卡片
 */

import React from 'react';
import { Restaurant } from '@/types';
import { Button, Card } from '@/components/ui';

export interface RestaurantCardProps {
  restaurant: Restaurant;
  onNavigate?: () => void;
  onRemove?: () => void;
  onSave?: () => void;
  onClose?: () => void;
}

export const RestaurantCard: React.FC<RestaurantCardProps> = ({
  restaurant,
  onNavigate,
  onRemove,
  onSave,
  onClose,
}) => {
  // 生成导航链接（高德地图或百度地图）
  const handleNavigate = () => {
    if (onNavigate) {
      onNavigate();
    } else {
      // 默认使用高德地图
      const url = `https://uri.amap.com/marker?position=${restaurant.location.lng},${restaurant.location.lat}&name=${encodeURIComponent(restaurant.name)}`;
      window.open(url, '_blank');
    }
  };

  // 格式化距离
  const formatDistance = (distance?: number) => {
    if (!distance) return '距离未知';
    if (distance < 1000) return `${Math.round(distance)}米`;
    return `${(distance / 1000).toFixed(1)}公里`;
  };

  // 格式化价格
  const formatPrice = (price?: number) => {
    if (!price) return '价格未知';
    return `¥${price}/人`;
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      {/* 餐厅名称 */}
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-gray-900 mb-2">
          {restaurant.name}
        </h2>
        <div className="flex items-center gap-3 text-sm text-gray-600">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
            {restaurant.cuisineType}
          </span>
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

      {/* 详细信息 */}
      <div className="space-y-3 mb-6">
        {/* 地址 */}
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <div className="flex-1">
            <p className="text-sm text-gray-600">{restaurant.address}</p>
            <p className="text-xs text-gray-500 mt-1">{formatDistance(restaurant.distance)}</p>
          </div>
        </div>

        {/* 电话 */}
        {restaurant.phone && (
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
            </svg>
            <a href={`tel:${restaurant.phone}`} className="text-sm text-primary hover:underline">
              {restaurant.phone}
            </a>
          </div>
        )}

        {/* 营业时间 */}
        {restaurant.openingHours && (
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-600">{restaurant.openingHours}</p>
          </div>
        )}

        {/* 人均价格 */}
        {restaurant.averagePrice && (
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-600">{formatPrice(restaurant.averagePrice)}</p>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="grid grid-cols-2 gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={handleNavigate}
          ariaLabel="导航到餐厅"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          导航
        </Button>

        {onSave && (
          <Button
            variant="success"
            size="md"
            onClick={onSave}
            ariaLabel="保存到历史"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            保存
          </Button>
        )}

        {onRemove && (
          <Button
            variant="danger"
            size="md"
            onClick={onRemove}
            ariaLabel="不想去"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            不想去
          </Button>
        )}

        {onClose && (
          <Button
            variant="secondary"
            size="md"
            onClick={onClose}
            className="col-span-2"
            ariaLabel="关闭"
          >
            关闭
          </Button>
        )}
      </div>
    </Card>
  );
};
