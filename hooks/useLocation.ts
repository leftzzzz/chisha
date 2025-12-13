/**
 * useLocation - 位置获取 Hook
 *
 * 提供自动定位和手动地址输入功能
 *
 * 特性:
 * - 自动定位(使用浏览器 Geolocation API)
 * - 手动输入地址后自动 geocode
 * - 位置缓存(sessionStorage)
 * - 错误处理和重试
 * - SSR 支持
 *
 * 使用方式:
 * ```tsx
 * const {
 *   location,
 *   isLocating,
 *   error,
 *   getAutoLocation,
 *   geocodeAddress,
 * } = useLocation();
 * ```
 */

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Location } from '@/types';
import { geocode, reverseGeocode, APIError } from '@/lib/api';

/**
 * 位置缓存配置
 */
const CACHE_CONFIG = {
  key: 'chisha_last_location',
  expiryMs: 30 * 60 * 1000, // 30分钟过期
};

/**
 * 缓存的位置数据
 */
interface CachedLocation {
  location: Location;
  timestamp: number;
}

/**
 * useLocation Hook 返回值
 */
export interface UseLocationReturn {
  location: Location | null;
  isLocating: boolean;
  error: string | null;
  getAutoLocation: () => Promise<void>;
  geocodeAddress: (address: string, city?: string) => Promise<void>;
  clearLocation: () => void;
}

/**
 * useLocation Hook
 *
 * 获取用户位置的 Hook
 *
 * @returns 位置信息和操作方法
 *
 * @example
 * ```tsx
 * function LocationInput() {
 *   const { location, isLocating, error, getAutoLocation } = useLocation();
 *
 *   return (
 *     <div>
 *       {location && <p>当前位置: {location.address}</p>}
 *       {error && <p>错误: {error}</p>}
 *       <button onClick={getAutoLocation} disabled={isLocating}>
 *         {isLocating ? '定位中...' : '自动定位'}
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useLocation(): UseLocationReturn {
  const [location, setLocation] = useState<Location | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 从缓存加载位置
   */
  useEffect(() => {
    loadCachedLocation();
  }, []);

  /**
   * 加载缓存的位置
   */
  const loadCachedLocation = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const cached = sessionStorage.getItem(CACHE_CONFIG.key);
      if (!cached) {
        return;
      }

      const data: CachedLocation = JSON.parse(cached);

      // 检查是否过期
      const isExpired = Date.now() - data.timestamp > CACHE_CONFIG.expiryMs;
      if (isExpired) {
        sessionStorage.removeItem(CACHE_CONFIG.key);
        return;
      }

      setLocation(data.location);
    } catch (error) {
      console.error('Failed to load cached location:', error);
      sessionStorage.removeItem(CACHE_CONFIG.key);
    }
  }, []);

  /**
   * 缓存位置
   */
  const cacheLocation = useCallback((loc: Location) => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const data: CachedLocation = {
        location: loc,
        timestamp: Date.now(),
      };
      sessionStorage.setItem(CACHE_CONFIG.key, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to cache location:', error);
    }
  }, []);

  /**
   * 自动定位
   *
   * 使用浏览器 Geolocation API 获取当前位置
   */
  const getAutoLocation = useCallback(async () => {
    // 检查浏览器支持
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setError('您的浏览器不支持定位功能');
      return;
    }

    setIsLocating(true);
    setError(null);

    try {
      // 获取地理位置
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000, // 5分钟缓存
        });
      });

      const coords: Location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // 逆地理编码获取地址
      try {
        const address = await reverseGeocode(coords);
        coords.address = address;
      } catch (e) {
        console.warn('Reverse geocode failed:', e);
        coords.address = '当前位置';
      }

      setLocation(coords);
      cacheLocation(coords);
    } catch (error) {
      if (error instanceof GeolocationPositionError) {
        switch (error.code) {
          case error.PERMISSION_DENIED:
            setError('定位权限被拒绝,请在浏览器设置中允许定位');
            break;
          case error.POSITION_UNAVAILABLE:
            setError('无法获取位置信息,请检查设备定位服务是否开启');
            break;
          case error.TIMEOUT:
            setError('定位超时,请重试');
            break;
          default:
            setError('定位失败,请重试');
        }
      } else {
        setError('定位失败,请重试或手动输入地址');
      }
      console.error('Geolocation error:', error);
    } finally {
      setIsLocating(false);
    }
  }, [cacheLocation]);

  /**
   * 地址编码
   *
   * 将地址转换为经纬度坐标
   *
   * @param address - 地址描述
   * @param city - 城市名称(可选)
   */
  const geocodeAddress = useCallback(
    async (address: string, city?: string) => {
      if (!address.trim()) {
        setError('请输入地址');
        return;
      }

      setIsLocating(true);
      setError(null);

      try {
        const loc = await geocode(address, city);
        loc.address = address; // 保存原始地址

        setLocation(loc);
        cacheLocation(loc);
      } catch (error) {
        if (error instanceof APIError) {
          setError(error.message);
        } else {
          setError('地址解析失败,请重新输入');
        }
        console.error('Geocode error:', error);
      } finally {
        setIsLocating(false);
      }
    },
    [cacheLocation]
  );

  /**
   * 清除位置
   */
  const clearLocation = useCallback(() => {
    setLocation(null);
    setError(null);

    if (typeof window !== 'undefined') {
      sessionStorage.removeItem(CACHE_CONFIG.key);
    }
  }, []);

  return {
    location,
    isLocating,
    error,
    getAutoLocation,
    geocodeAddress,
    clearLocation,
  };
}
