/**
 * Map 组件
 *
 * 地图组件（使用高德地图 JS API）
 * 苹果风格设计 - 作为全屏背景显示
 */

'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Restaurant, Location } from '@/types';

export interface MapProps {
  restaurants: Restaurant[];
  selectedRestaurant: Restaurant | null;
  focusedRestaurant?: Restaurant | null; // 点击扇区时聚焦的餐厅
  center?: Location;
  userLocation?: Location;
  zoom?: number;
  onMarkerClick?: (restaurant: Restaurant) => void;
  className?: string;
}

export const Map: React.FC<MapProps> = ({
  restaurants,
  selectedRestaurant,
  focusedRestaurant,
  center,
  userLocation,
  zoom = 14,
  onMarkerClick,
  className = '',
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<AMap.Map | null>(null);
  const markersRef = useRef<AMap.Marker[]>([]);
  const userMarkerRef = useRef<AMap.Marker | null>(null);
  const infoWindowRef = useRef<AMap.InfoWindow | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 加载高德地图 API
  useEffect(() => {
    const loadAMapScript = (): Promise<typeof AMap> => {
      return new Promise((resolve, reject) => {
        if (window.AMap) {
          resolve(window.AMap);
          return;
        }

        // 配置安全代理（安全密钥通过服务端代理，不暴露在前端）
        // 参考: https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
        (window as unknown as { _AMapSecurityConfig: { serviceHost: string } })._AMapSecurityConfig = {
          serviceHost: `${window.location.origin}/_AMapService`,
        };

        const apiKey = process.env.NEXT_PUBLIC_AMAP_KEY || '';
        if (!apiKey) {
          reject(new Error('NEXT_PUBLIC_AMAP_KEY is not configured'));
          return;
        }

        const script = document.createElement('script');
        script.src = `https://webapi.amap.com/maps?v=2.0&key=${apiKey}`;
        script.async = true;
        script.onload = () => {
          if (window.AMap) {
            resolve(window.AMap);
          } else {
            reject(new Error('AMap not loaded'));
          }
        };
        script.onerror = () => reject(new Error('Script load failed'));
        document.head.appendChild(script);
      });
    };

    const initMap = async () => {
      try {
        await loadAMapScript();

        if (!mapContainerRef.current) return;

        const mapCenter = center || userLocation || restaurants[0]?.location || { lng: 114.05, lat: 22.55 };

        mapRef.current = new window.AMap.Map(mapContainerRef.current, {
          zoom,
          center: [mapCenter.lng, mapCenter.lat],
          viewMode: '2D',
          resizeEnable: true,
          mapStyle: 'amap://styles/whitesmoke',
        });

        // 等待地图完全加载
        mapRef.current.on('complete', () => {
          setIsReady(true);
        });
      } catch (err) {
        console.error('地图加载失败:', err);
        const errorMessage = err instanceof Error ? err.message : '地图加载失败';
        if (errorMessage.includes('NEXT_PUBLIC_AMAP_KEY')) {
          setError('地图 API Key 未配置');
        } else {
          setError('地图加载失败');
        }
      }
    };

    initMap();

    return () => {
      if (mapRef.current) {
        mapRef.current.destroy();
        mapRef.current = null;
      }
    };
  }, []);

  // 创建信息窗口内容 - 与移动端卡片风格对齐
  const createInfoWindowContent = useCallback((restaurant: Restaurant) => {
    // 格式化距离
    const formatDistance = (distance?: number) => {
      if (!distance) return '';
      if (distance < 1000) return `${Math.round(distance)}米`;
      return `${(distance / 1000).toFixed(1)}公里`;
    };

    // 格式化价格
    const formatPrice = (price?: number) => {
      if (!price) return '';
      return `¥${price}/人`;
    };

    const distanceText = formatDistance(restaurant.distance);
    const priceText = formatPrice(restaurant.averagePrice);

    return `
      <div style="
        padding: 16px;
        min-width: 260px;
        max-width: 320px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <!-- 餐厅名称 -->
        <h3 style="
          margin: 0 0 8px 0;
          font-size: 18px;
          font-weight: 700;
          color: #1f2937;
        ">${restaurant.name}</h3>

        <!-- 标签和评分 -->
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 12px;">
          <span style="
            display: inline-flex;
            padding: 2px 10px;
            border-radius: 9999px;
            background: rgba(255, 107, 107, 0.1);
            color: #FF6B6B;
            font-size: 12px;
            font-weight: 500;
          ">${restaurant.cuisineType || '美食'}</span>
          ${restaurant.rating ? `
            <span style="display: flex; align-items: center; gap: 2px; font-size: 13px; color: #6b7280;">
              <svg width="14" height="14" viewBox="0 0 20 20" fill="#FBBF24">
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z"/>
              </svg>
              ${restaurant.rating.toFixed(1)}
            </span>
          ` : ''}
        </div>

        <!-- 详细信息 -->
        <div style="display: flex; flex-direction: column; gap: 8px; margin-bottom: 16px;">
          <!-- 地址 -->
          <div style="display: flex; align-items: flex-start; gap: 8px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2" style="flex-shrink: 0; margin-top: 2px;">
              <path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
              <path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
            </svg>
            <div>
              <p style="margin: 0; font-size: 13px; color: #4b5563; line-height: 1.4;">${restaurant.address || ''}</p>
              ${distanceText ? `<p style="margin: 4px 0 0 0; font-size: 12px; color: #9ca3af;">${distanceText}</p>` : ''}
            </div>
          </div>

          <!-- 电话 -->
          ${restaurant.phone ? `
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>
              </svg>
              <a href="tel:${restaurant.phone}" style="font-size: 13px; color: #FF6B6B; text-decoration: none;">${restaurant.phone}</a>
            </div>
          ` : ''}

          <!-- 价格 -->
          ${priceText ? `
            <div style="display: flex; align-items: center; gap: 8px;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9CA3AF" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              <span style="font-size: 13px; color: #4b5563;">${priceText}</span>
            </div>
          ` : ''}
        </div>

        <!-- 导航按钮 -->
        <a
          href="https://uri.amap.com/marker?position=${restaurant.location.lng},${restaurant.location.lat}&name=${encodeURIComponent(restaurant.name)}"
          target="_blank"
          style="
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 6px;
            width: 100%;
            padding: 10px 16px;
            background: linear-gradient(135deg, #FF6B6B 0%, #f38181 100%);
            color: white;
            font-size: 14px;
            font-weight: 500;
            border-radius: 8px;
            text-decoration: none;
            box-shadow: 0 2px 8px rgba(255, 107, 107, 0.3);
          "
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
          </svg>
          导航到这里
        </a>
      </div>
    `;
  }, []);

  // 显示信息窗口
  const showInfoWindow = useCallback((restaurant: Restaurant) => {
    if (!mapRef.current || !window.AMap) return;

    // 关闭已有的信息窗口
    if (infoWindowRef.current) {
      infoWindowRef.current.close();
    }

    // 创建新的信息窗口
    infoWindowRef.current = new window.AMap.InfoWindow({
      content: createInfoWindowContent(restaurant),
      offset: new window.AMap.Pixel(0, -40),
      closeWhenClickMap: true,
    });

    infoWindowRef.current.open(mapRef.current, [restaurant.location.lng, restaurant.location.lat]);
  }, [createInfoWindowContent]);

  // 创建餐厅标记
  const createRestaurantMarker = useCallback((restaurant: Restaurant, isSelected: boolean) => {
    if (!window.AMap) return null;

    const size = isSelected ? 44 : 32;
    const color = isSelected ? '#FF6B6B' : '#4ECDC4';

    const content = document.createElement('div');
    content.innerHTML = `
      <div style="
        width: ${size}px;
        height: ${size}px;
        background: ${color};
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all 0.3s ease;
        ${isSelected ? 'animation: bounce 0.5s ease;' : ''}
      ">
        <svg width="${size * 0.45}" height="${size * 0.45}" viewBox="0 0 24 24" fill="white">
          <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
        </svg>
      </div>
    `;

    const marker = new window.AMap.Marker({
      position: [restaurant.location.lng, restaurant.location.lat],
      content: content,
      offset: new window.AMap.Pixel(-size / 2, -size / 2),
      zIndex: isSelected ? 100 : 10,
    });

    return marker;
  }, []);

  // 创建用户位置标记
  const createUserMarker = useCallback((location: Location) => {
    if (!window.AMap) return null;

    const content = document.createElement('div');
    content.innerHTML = `
      <div style="
        width: 16px;
        height: 16px;
        background: #007AFF;
        border-radius: 50%;
        border: 3px solid white;
        box-shadow: 0 2px 8px rgba(0,122,255,0.5);
      "></div>
    `;

    const marker = new window.AMap.Marker({
      position: [location.lng, location.lat],
      content: content,
      offset: new window.AMap.Pixel(-8, -8),
      zIndex: 50,
    });

    return marker;
  }, []);

  // 更新标记
  useEffect(() => {
    if (!mapRef.current || !isReady || !window.AMap) return;

    // 清除旧的餐厅标记
    markersRef.current.forEach(marker => marker.setMap(null));
    markersRef.current = [];

    // 添加餐厅标记
    restaurants.forEach((restaurant) => {
      const isSelected = selectedRestaurant?.id === restaurant.id;
      const isFocused = focusedRestaurant?.id === restaurant.id;
      const isHighlighted = isSelected || isFocused;
      const marker = createRestaurantMarker(restaurant, isHighlighted);

      if (marker) {
        marker.on('click', () => {
          // 显示信息窗口
          showInfoWindow(restaurant);
          // 回调
          if (onMarkerClick) {
            onMarkerClick(restaurant);
          }
        });

        marker.setMap(mapRef.current);
        markersRef.current.push(marker);
      }
    });

    // 更新用户位置标记
    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
      userMarkerRef.current = null;
    }

    const userLoc = userLocation || center;
    if (userLoc) {
      const userMarker = createUserMarker(userLoc);
      if (userMarker) {
        userMarker.setMap(mapRef.current);
        userMarkerRef.current = userMarker;
      }
    }
  }, [restaurants, selectedRestaurant, focusedRestaurant, isReady, createRestaurantMarker, createUserMarker, userLocation, center, onMarkerClick, showInfoWindow]);

  // 初始加载时调整地图视野（仅在餐厅列表变化时）
  const prevRestaurantsLengthRef = useRef(0);
  useEffect(() => {
    if (!mapRef.current || !isReady || !window.AMap) return;

    // 只有当餐厅数量变化时才调整视野
    if (restaurants.length === prevRestaurantsLengthRef.current) return;
    prevRestaurantsLengthRef.current = restaurants.length;

    if (restaurants.length > 0) {
      const userLoc = userLocation || center;
      const allPoints = restaurants.map(r => [r.location.lng, r.location.lat]);
      if (userLoc) {
        allPoints.push([userLoc.lng, userLoc.lat]);
      }

      if (allPoints.length === 1) {
        mapRef.current.setCenter(allPoints[0] as [number, number]);
        mapRef.current.setZoom(15);
      } else {
        const lngs = allPoints.map(p => p[0]);
        const lats = allPoints.map(p => p[1]);
        const bounds = new window.AMap.Bounds(
          new window.AMap.LngLat(Math.min(...lngs), Math.min(...lats)),
          new window.AMap.LngLat(Math.max(...lngs), Math.max(...lats))
        );
        mapRef.current.setBounds(bounds, true, [80, 80, 80, 520]);
      }
    }
  }, [restaurants, isReady, userLocation, center]);

  // 当选中餐厅变化时，飞到该位置并显示信息窗口
  useEffect(() => {
    if (!mapRef.current || !isReady || !selectedRestaurant) return;

    // 飞到选中的餐厅位置（缩放级别 17，近距离查看）
    mapRef.current.setZoomAndCenter(17, [selectedRestaurant.location.lng, selectedRestaurant.location.lat], true);

    // 延迟显示信息窗口，等待地图动画完成
    setTimeout(() => {
      showInfoWindow(selectedRestaurant);
    }, 500);
  }, [selectedRestaurant, isReady, showInfoWindow]);

  // 当聚焦餐厅变化时（点击扇区），飞到该位置并显示信息窗口
  useEffect(() => {
    if (!mapRef.current || !isReady || !focusedRestaurant) return;

    // 飞到聚焦的餐厅位置（缩放级别 17，近距离查看）
    mapRef.current.setZoomAndCenter(17, [focusedRestaurant.location.lng, focusedRestaurant.location.lat], true);

    // 延迟显示信息窗口，等待地图动画完成
    setTimeout(() => {
      showInfoWindow(focusedRestaurant);
    }, 300);
  }, [focusedRestaurant, isReady, showInfoWindow]);

  // 错误状态
  if (error) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-gray-100 to-gray-200 ${className}`}>
        <div className="text-center p-8 bg-white/80 backdrop-blur rounded-2xl shadow-lg">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
          </svg>
          <p className="text-gray-500 font-medium">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative ${className}`} style={{ width: '100%', height: '100%', minHeight: '400px' }}>
      {/* 地图容器 */}
      <div
        ref={mapContainerRef}
        style={{ width: '100%', height: '100%', minHeight: '400px' }}
        role="application"
        aria-label="餐厅地图"
      />

      {/* 加载遮罩 */}
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
          <div className="text-center">
            <div className="relative w-16 h-16 mx-auto mb-4">
              <div className="absolute inset-0 border-4 border-blue-200 rounded-full" />
              <div className="absolute inset-0 border-4 border-blue-500 rounded-full border-t-transparent animate-spin" />
            </div>
            <p className="text-gray-600 font-medium">加载地图中...</p>
          </div>
        </div>
      )}
    </div>
  );
};
