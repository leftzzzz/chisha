/**
 * Map 组件
 *
 * 地图组件（使用高德地图 JS API），仅在桌面端显示
 *
 * 注意：此组件使用高德地图 JS API 而非 Leaflet，
 * 因为项目已经集成了高德地图服务
 */

'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Restaurant, Location } from '@/types';

export interface MapProps {
  restaurants: Restaurant[];
  selectedRestaurant: Restaurant | null;
  center?: Location;
  zoom?: number;
  onMarkerClick?: (restaurant: Restaurant) => void;
  className?: string;
}

// 高德地图类型声明（简化版）
declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: {
      securityJsCode: string;
    };
  }
}

export const Map: React.FC<MapProps> = ({
  restaurants,
  selectedRestaurant,
  center,
  zoom = 14,
  onMarkerClick,
  className = '',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 加载高德地图 API
  useEffect(() => {
    const loadAMapScript = () => {
      return new Promise((resolve, reject) => {
        if (window.AMap) {
          resolve(window.AMap);
          return;
        }

        // 这里需要替换为您的高德地图 API Key
        const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY || 'YOUR_AMAP_KEY';
        const script = document.createElement('script');
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
        script.async = true;
        script.onload = () => resolve(window.AMap);
        script.onerror = reject;
        document.head.appendChild(script);
      });
    };

    loadAMapScript()
      .then(() => {
        setIsLoading(false);
      })
      .catch(() => {
        setError('地图加载失败');
        setIsLoading(false);
      });
  }, []);

  // 初始化地图
  useEffect(() => {
    if (!window.AMap || !mapContainerRef.current || mapRef.current) {
      return;
    }

    try {
      const mapCenter = center || restaurants[0]?.location || { lng: 116.397428, lat: 39.90923 };

      mapRef.current = new window.AMap.Map(mapContainerRef.current, {
        zoom,
        center: [mapCenter.lng, mapCenter.lat],
        viewMode: '2D',
        resizeEnable: true,
      });
    } catch (err) {
      console.error('地图初始化失败:', err);
      setError('地图初始化失败');
    }
  }, [isLoading, center, zoom]);

  // 更新标记
  useEffect(() => {
    if (!mapRef.current || !window.AMap) return;

    // 清除旧标记
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    // 添加新标记
    restaurants.forEach((restaurant) => {
      const isSelected = selectedRestaurant?.id === restaurant.id;

      const marker = new window.AMap.Marker({
        position: [restaurant.location.lng, restaurant.location.lat],
        title: restaurant.name,
        icon: new window.AMap.Icon({
          size: new window.AMap.Size(isSelected ? 32 : 24, isSelected ? 32 : 24),
          image: isSelected
            ? 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzIiIGhlaWdodD0iMzIiIHZpZXdCb3g9IjAgMCAzMiAzMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxNiIgZmlsbD0iI0ZGNkI2QiIvPjxjaXJjbGUgY3g9IjE2IiBjeT0iMTYiIHI9IjgiIGZpbGw9IndoaXRlIi8+PC9zdmc+'
            : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMiIgZmlsbD0iIzRFQ0RDNCIvPjxjaXJjbGUgY3g9IjEyIiBjeT0iMTIiIHI9IjYiIGZpbGw9IndoaXRlIi8+PC9zdmc+',
          imageSize: new window.AMap.Size(isSelected ? 32 : 24, isSelected ? 32 : 24),
        }),
        zIndex: isSelected ? 100 : 10,
      });

      marker.on('click', () => {
        if (onMarkerClick) {
          onMarkerClick(restaurant);
        }
      });

      marker.setMap(mapRef.current);
      markersRef.current.push(marker);
    });

    // 自动调整地图视野
    if (restaurants.length > 0 && mapRef.current) {
      const bounds = new window.AMap.Bounds(
        ...restaurants.map(r => [r.location.lng, r.location.lat])
      );
      mapRef.current.setBounds(bounds, true, [50, 50, 50, 50]);
    }
  }, [restaurants, selectedRestaurant, onMarkerClick]);

  // 加载中
  if (isLoading) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto mb-2" />
          <p className="text-sm text-gray-600">加载地图中...</p>
        </div>
      </div>
    );
  }

  // 错误
  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="text-center">
          <svg className="w-12 h-12 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mapContainerRef}
      className={`w-full h-full ${className}`}
      role="application"
      aria-label="餐厅地图"
    />
  );
};
