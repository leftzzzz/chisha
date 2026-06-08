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
  getAutoLocation: () => Promise<Location | null>;
  geocodeAddress: (address: string, city?: string) => Promise<Location | null>;
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
   * 从缓存加载位置
   */
  useEffect(() => {
    loadCachedLocation();
  }, [loadCachedLocation]);

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
   * @returns 定位成功返回位置信息，失败返回 null
   */
  const getAutoLocation = useCallback(async (): Promise<Location | null> => {
    // 检查浏览器支持
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setError('您的浏览器不支持定位功能');
      return null;
    }

    setIsLocating(true);
    setError(null);

    try {
      // 获取地理位置
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000, // 15秒超时
          maximumAge: 300000, // 5分钟缓存
        });
      });

      const coords: Location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
      };

      // 逆地理编码获取地址（带超时保护）
      try {
        const reverseGeocodePromise = reverseGeocode(coords);
        // 设置逆地理编码的5秒超时
        const timeoutPromise = new Promise<string>((_, reject) => {
          setTimeout(() => reject(new Error('Reverse geocode timeout')), 30000);
        });

        const address = await Promise.race([reverseGeocodePromise, timeoutPromise]);
        coords.address = address;
      } catch (e) {
        console.warn('Reverse geocode failed:', e);
        // 使用坐标作为备选地址
        coords.address = `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`;
      }

      setLocation(coords);
      cacheLocation(coords);
      return coords;
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
      return null;
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
   * @returns 编码成功返回位置信息，失败返回 null
   */
  const geocodeAddress = useCallback(
    async (address: string, city?: string): Promise<Location | null> => {
      if (!address.trim()) {
        setError('请输入地址');
        return null;
      }

      setIsLocating(true);
      setError(null);

      try {
        const loc = await geocode(address, city);
        // 使用 API 返回的格式化地址，如果没有则使用用户输入的原始地址
        if (!loc.address) {
          loc.address = address;
        }

        setLocation(loc);
        cacheLocation(loc);
        return loc;
      } catch (error) {
        if (error instanceof APIError) {
          setError(error.message);
        } else {
          setError('地址解析失败,请重新输入');
        }
        console.error('Geocode error:', error);
        return null;
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
