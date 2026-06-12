/**
 * DataTransform 测试
 *
 * 测试数据转换和过滤函数
 */

import { combineAndFilterRestaurants, filterRestaurants } from '@/lib/dataTransform';
import type { Restaurant, Location } from '@/types';

describe('DataTransform', () => {
  const mockLocation: Location = {
    lat: 39.9,
    lng: 116.4,
    address: '北京市',
  };

  const createMockRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
    id: 'r1',
    name: '测试餐厅',
    cuisineType: '川菜',
    address: '测试地址',
    location: mockLocation,
    source: 'amap',
    rating: 4.5,
    distance: 500,
    ...overrides,
  });

  describe('combineAndFilterRestaurants', () => {
    it('should return empty array for empty input', () => {
      const result = combineAndFilterRestaurants([]);
      expect(result).toEqual([]);
    });

    it('should return single restaurant as-is', () => {
      const restaurant = createMockRestaurant();
      const result = combineAndFilterRestaurants([restaurant]);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(restaurant);
    });

    it('should remove duplicates based on name and location', () => {
      const r1 = createMockRestaurant({
        id: 'r1',
        name: '海底捞',
        location: { lat: 39.9001, lng: 116.4001 },
      });
      const r2 = createMockRestaurant({
        id: 'r2',
        name: '海底捞',
        location: { lat: 39.9002, lng: 116.4002 }, // Same after toFixed(3): 39.900, 116.400
      });

      const result = combineAndFilterRestaurants([r1, r2]);

      expect(result).toHaveLength(1);
    });

    it('should dedup same-brand restaurants at different locations', () => {
      const r1 = createMockRestaurant({
        id: 'r1',
        name: '海底捞',
        location: { lat: 39.900, lng: 116.400 },
      });
      const r2 = createMockRestaurant({
        id: 'r2',
        name: '海底捞',
        location: { lat: 40.000, lng: 117.000 }, // Different location
      });

      const result = combineAndFilterRestaurants([r1, r2]);

      expect(result).toHaveLength(1);
    });

    it('should prefer restaurant with more complete information', () => {
      const r1 = createMockRestaurant({
        id: 'r1',
        name: '海底捞',
        location: { lat: 39.9001, lng: 116.4001 },
        phone: undefined,
        openingHours: undefined,
      });
      const r2 = createMockRestaurant({
        id: 'r2',
        name: '海底捞',
        location: { lat: 39.9002, lng: 116.4002 }, // Same after toFixed(3)
        phone: '123456',
        openingHours: '9:00-22:00',
      });

      const result = combineAndFilterRestaurants([r1, r2]);

      expect(result).toHaveLength(1);
      expect(result[0].phone).toBe('123456');
      expect(result[0].openingHours).toBe('9:00-22:00');
    });

    it('should prefer amap source over osm', () => {
      // When both have equal info, amap should be preferred
      const r1 = createMockRestaurant({
        id: 'r1',
        name: '海底捞',
        location: { lat: 39.9001, lng: 116.4001 },
        source: 'osm',
      });
      const r2 = createMockRestaurant({
        id: 'r2',
        name: '海底捞',
        location: { lat: 39.9002, lng: 116.4002 }, // Same after toFixed(3)
        source: 'amap',
      });

      const result = combineAndFilterRestaurants([r1, r2]);

      expect(result).toHaveLength(1);
      expect(result[0].source).toBe('amap');
    });

    it('should sort by distance ascending', () => {
      const r1 = createMockRestaurant({ id: 'r1', distance: 1000 });
      const r2 = createMockRestaurant({ id: 'r2', distance: 500, name: 'R2' });
      const r3 = createMockRestaurant({ id: 'r3', distance: 2000, name: 'R3' });

      const result = combineAndFilterRestaurants([r1, r2, r3]);

      expect(result).toHaveLength(3);
      expect(result[0].distance).toBe(500);
      expect(result[1].distance).toBe(1000);
      expect(result[2].distance).toBe(2000);
    });

    it('should handle restaurants without distance', () => {
      const r1 = createMockRestaurant({ id: 'r1', distance: 500 });
      const r2 = createMockRestaurant({ id: 'r2', distance: undefined, name: 'R2' });

      const result = combineAndFilterRestaurants([r1, r2]);

      expect(result).toHaveLength(2);
      expect(result[0].distance).toBe(500);
      expect(result[1].distance).toBeUndefined();
    });

    it('should limit results to specified count', () => {
      const restaurants = Array(20)
        .fill(null)
        .map((_, i) =>
          createMockRestaurant({
            id: `r${i}`,
            name: `Restaurant ${i}`,
            distance: i * 100,
          })
        );

      const result = combineAndFilterRestaurants(restaurants, 5);

      expect(result).toHaveLength(5);
    });

    it('should default to 8 restaurants', () => {
      const restaurants = Array(20)
        .fill(null)
        .map((_, i) =>
          createMockRestaurant({
            id: `r${i}`,
            name: `Restaurant ${i}`,
            distance: i * 100,
          })
        );

      const result = combineAndFilterRestaurants(restaurants);

      expect(result).toHaveLength(8);
    });

    it('should not limit if fewer restaurants than count', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1' }),
        createMockRestaurant({ id: 'r2', name: 'R2' }),
      ];

      const result = combineAndFilterRestaurants(restaurants, 5);

      expect(result).toHaveLength(2);
    });
  });

  describe('filterRestaurants', () => {
    it('should return all restaurants when no price range', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 50 }),
        createMockRestaurant({ id: 'r2', averagePrice: 100, name: 'R2' }),
      ];

      const result = filterRestaurants(restaurants);

      expect(result).toHaveLength(2);
    });

    it('should filter by min price', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 30 }),
        createMockRestaurant({ id: 'r2', averagePrice: 80, name: 'R2' }),
        createMockRestaurant({ id: 'r3', averagePrice: 100, name: 'R3' }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { min: 50 },
      });

      expect(result).toHaveLength(2);
      expect(result[0].averagePrice).toBe(80);
      expect(result[1].averagePrice).toBe(100);
    });

    it('should filter by max price', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 30 }),
        createMockRestaurant({ id: 'r2', averagePrice: 80, name: 'R2' }),
        createMockRestaurant({ id: 'r3', averagePrice: 100, name: 'R3' }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { max: 60 },
      });

      expect(result).toHaveLength(1);
      expect(result[0].averagePrice).toBe(30);
    });

    it('should filter by both min and max price', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 30 }),
        createMockRestaurant({ id: 'r2', averagePrice: 50, name: 'R2' }),
        createMockRestaurant({ id: 'r3', averagePrice: 80, name: 'R3' }),
        createMockRestaurant({ id: 'r4', averagePrice: 100, name: 'R4' }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { min: 40, max: 90 },
      });

      expect(result).toHaveLength(2);
      expect(result[0].averagePrice).toBe(50);
      expect(result[1].averagePrice).toBe(80);
    });

    it('should include restaurants without averagePrice', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: undefined }),
        createMockRestaurant({ id: 'r2', averagePrice: 100, name: 'R2' }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { max: 50 },
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('r1');
    });

    it('should handle edge case: price exactly at min', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 50 }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { min: 50 },
      });

      expect(result).toHaveLength(1);
    });

    it('should handle edge case: price exactly at max', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 50 }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { max: 50 },
      });

      expect(result).toHaveLength(1);
    });

    it('should return empty array when all filtered out', () => {
      const restaurants = [
        createMockRestaurant({ id: 'r1', averagePrice: 100 }),
        createMockRestaurant({ id: 'r2', averagePrice: 150, name: 'R2' }),
      ];

      const result = filterRestaurants(restaurants, {
        priceRange: { max: 50 },
      });

      expect(result).toEqual([]);
    });

    it('should handle empty input', () => {
      const result = filterRestaurants([], {
        priceRange: { min: 50, max: 100 },
      });

      expect(result).toEqual([]);
    });
  });
});
