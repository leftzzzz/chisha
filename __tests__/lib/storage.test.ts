/**
 * Storage 测试
 *
 * 测试 localStorage 存储函数
 */

import {
  getRecords,
  saveRecord,
  deleteRecord,
  clearRecords,
  createRecord,
  searchHistory,
  getStats,
  exportHistory,
  importHistory,
  getRecordsByDate,
  setReuseRecord,
  getReuseRecord,
  saveRecordAndReplaceSameSession,
  buildUserPreferenceSummary,
  STORAGE_CONFIG,
} from '@/lib/storage';
import type { TurntableRecord, Restaurant, Location } from '@/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

describe('Storage', () => {
  const mockLocation: Location = {
    lat: 39.9,
    lng: 116.4,
    address: '北京市',
  };

  const mockRestaurant: Restaurant = {
    id: 'r1',
    name: '测试餐厅',
    cuisineType: '川菜',
    address: '测试地址',
    location: mockLocation,
    source: 'amap',
    rating: 4.5,
    distance: 500,
  };

  const mockRecord: Omit<TurntableRecord, 'id' | 'timestamp'> = {
    query: '我想吃火锅',
    location: mockLocation,
    restaurants: [mockRestaurant],
    selected: mockRestaurant,
  };

  beforeEach(() => {
    localStorageMock.clear();
  });

  describe('getRecords', () => {
    it('should return empty array when no records', () => {
      const records = getRecords();
      expect(records).toEqual([]);
    });

    it('should return records sorted by timestamp desc', () => {
      const record1: TurntableRecord = {
        ...mockRecord,
        id: 'rec1',
        timestamp: 1000,
      };
      const record2: TurntableRecord = {
        ...mockRecord,
        id: 'rec2',
        timestamp: 2000,
      };

      localStorageMock.setItem(
        STORAGE_CONFIG.key,
        JSON.stringify([record1, record2])
      );

      const records = getRecords();
      expect(records).toHaveLength(2);
      expect(records[0].timestamp).toBe(2000);
      expect(records[1].timestamp).toBe(1000);
    });

    it('should handle corrupted data and return empty array', () => {
      localStorageMock.setItem(STORAGE_CONFIG.key, 'invalid json');

      const records = getRecords();
      expect(records).toEqual([]);
    });

    it('should reset invalid data format', () => {
      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify({ not: 'array' }));

      const records = getRecords();
      expect(records).toEqual([]);
      expect(localStorageMock.getItem(STORAGE_CONFIG.key)).toBeNull();
    });
  });

  describe('saveRecord', () => {
    it('should save record with generated id and timestamp', () => {
      saveRecord(mockRecord);

      const records = getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].query).toBe(mockRecord.query);
      expect(records[0].id).toBeDefined();
      expect(records[0].timestamp).toBeDefined();
    });

    it('should save record at the beginning of list', () => {
      const record1: TurntableRecord = {
        ...mockRecord,
        id: 'rec1',
        timestamp: 1000,
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([record1]));

      saveRecord(mockRecord);

      const records = getRecords();
      expect(records).toHaveLength(2);
      expect(records[0].timestamp).toBeGreaterThan(1000);
    });

    it('should limit records to maxRecords', () => {
      const existingRecords: TurntableRecord[] = Array(100)
        .fill(null)
        .map((_, i) => ({
          ...mockRecord,
          id: `rec${i}`,
          timestamp: i,
        }));

      localStorageMock.setItem(
        STORAGE_CONFIG.key,
        JSON.stringify(existingRecords)
      );

      saveRecord(mockRecord);

      const records = getRecords();
      expect(records.length).toBe(STORAGE_CONFIG.maxRecords);
    });

    it('should preserve existing record with id and timestamp', () => {
      const fullRecord: TurntableRecord = {
        ...mockRecord,
        id: 'custom-id',
        timestamp: 12345,
      };

      saveRecord(fullRecord);

      const records = getRecords();
      expect(records[0].id).toBe('custom-id');
      expect(records[0].timestamp).toBe(12345);
    });
  });

  describe('saveRecordAndReplaceSameSession', () => {
    it('should replace same session record', () => {
      const oldRecord: TurntableRecord = {
        ...mockRecord,
        id: 'old',
        timestamp: Date.now() - 1000,
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([oldRecord]));

      saveRecordAndReplaceSameSession(mockRecord);

      const records = getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].id).not.toBe('old');
    });

    it('should not replace different session record', () => {
      const differentRecord: TurntableRecord = {
        ...mockRecord,
        query: '不同的查询',
        id: 'different',
        timestamp: Date.now() - 1000,
      };

      localStorageMock.setItem(
        STORAGE_CONFIG.key,
        JSON.stringify([differentRecord])
      );

      saveRecordAndReplaceSameSession(mockRecord);

      const records = getRecords();
      expect(records).toHaveLength(2);
    });

    it('should not replace old session (>30 minutes)', () => {
      const oldRecord: TurntableRecord = {
        ...mockRecord,
        id: 'old',
        timestamp: Date.now() - 31 * 60 * 1000, // 31 minutes ago
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([oldRecord]));

      saveRecordAndReplaceSameSession(mockRecord);

      const records = getRecords();
      expect(records).toHaveLength(2);
    });
  });

  describe('deleteRecord', () => {
    it('should delete record by id', () => {
      const record: TurntableRecord = {
        ...mockRecord,
        id: 'to-delete',
        timestamp: 1000,
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([record]));

      deleteRecord('to-delete');

      const records = getRecords();
      expect(records).toHaveLength(0);
    });

    it('should not affect other records', () => {
      const record1: TurntableRecord = {
        ...mockRecord,
        id: 'rec1',
        timestamp: 1000,
      };
      const record2: TurntableRecord = {
        ...mockRecord,
        id: 'rec2',
        timestamp: 2000,
      };

      localStorageMock.setItem(
        STORAGE_CONFIG.key,
        JSON.stringify([record1, record2])
      );

      deleteRecord('rec1');

      const records = getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('rec2');
    });
  });

  describe('clearRecords', () => {
    it('should clear all records', () => {
      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([mockRecord]));

      clearRecords();

      const records = getRecords();
      expect(records).toEqual([]);
    });
  });

  describe('createRecord', () => {
    it('should create record from parameters', () => {
      const allRestaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const record = createRecord(
        '火锅',
        mockLocation,
        mockRestaurant,
        allRestaurants
      );

      expect(record.query).toBe('火锅');
      expect(record.location).toEqual(mockLocation);
      expect(record.selected).toEqual(mockRestaurant);
      expect(record.restaurants).toEqual(allRestaurants);
    });
  });

  describe('searchHistory', () => {
    beforeEach(() => {
      const records: TurntableRecord[] = [
        {
          ...mockRecord,
          id: 'rec1',
          timestamp: 1000,
          query: '火锅',
          selected: { ...mockRestaurant, name: '海底捞', cuisineType: '火锅' },
        },
        {
          ...mockRecord,
          id: 'rec2',
          timestamp: 2000,
          query: '日料',
          selected: { ...mockRestaurant, name: '寿司店', cuisineType: '日料' },
        },
      ];

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify(records));
    });

    it('should return all records when keyword is empty', () => {
      const results = searchHistory('');
      expect(results).toHaveLength(2);
    });

    it('should search by query', () => {
      const results = searchHistory('火锅');
      expect(results).toHaveLength(1);
      expect(results[0].query).toBe('火锅');
    });

    it('should search by restaurant name', () => {
      const results = searchHistory('海底捞');
      expect(results).toHaveLength(1);
      expect(results[0].selected.name).toBe('海底捞');
    });

    it('should search by cuisine type', () => {
      const results = searchHistory('日料');
      expect(results).toHaveLength(1);
    });

    it('should be case insensitive', () => {
      const results = searchHistory('火锅');
      expect(results).toHaveLength(1);
    });

    it('should return empty array when no matches', () => {
      const results = searchHistory('xyz');
      expect(results).toEqual([]);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no records', () => {
      const stats = getStats();

      expect(stats.totalRecords).toBe(0);
      expect(stats.totalRestaurants).toBe(0);
      expect(stats.mostVisited).toEqual([]);
      expect(stats.favoriteCuisines).toEqual([]);
    });

    it('should calculate stats correctly', () => {
      const records: TurntableRecord[] = [
        {
          ...mockRecord,
          id: 'rec1',
          timestamp: Date.now(),
          selected: mockRestaurant,
          restaurants: [mockRestaurant],
        },
        {
          ...mockRecord,
          id: 'rec2',
          timestamp: Date.now(),
          selected: { ...mockRestaurant, id: 'r2', name: '另一个餐厅' },
          restaurants: [mockRestaurant, { ...mockRestaurant, id: 'r2', name: '另一个餐厅' }],
        },
      ];

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify(records));

      const stats = getStats();

      expect(stats.totalRecords).toBe(2);
      expect(stats.totalRestaurants).toBe(2);
      expect(stats.mostVisited).toHaveLength(2);
      expect(stats.favoriteCuisines[0].cuisine).toBe('川菜');
    });
  });

  describe('buildUserPreferenceSummary', () => {
    it('should convert selected and rejected restaurants into preference weights', () => {
      const cantoneseRestaurant: Restaurant = {
        ...mockRestaurant,
        id: 'r2',
        name: '粤菜餐厅',
        cuisineType: '粤菜',
        distance: 800,
        averagePrice: 100,
      };
      const hotpotRestaurant: Restaurant = {
        ...mockRestaurant,
        id: 'r3',
        name: '火锅餐厅',
        cuisineType: '火锅',
        distance: 1200,
      };
      const record: TurntableRecord = {
        id: 'rec1',
        timestamp: 2000,
        query: '随便吃点',
        location: mockLocation,
        restaurants: [cantoneseRestaurant, hotpotRestaurant],
        rejectedRestaurants: [hotpotRestaurant],
        selected: cantoneseRestaurant,
      };

      const summary = buildUserPreferenceSummary([record]);

      expect(summary.favoriteCuisines?.[0]).toEqual(
        expect.objectContaining({ name: '粤菜' })
      );
      expect(summary.avoidedCuisines?.[0]).toEqual(
        expect.objectContaining({ name: '火锅' })
      );
      expect(summary.preferredDistanceMeters).toBe(800);
      expect(summary.preferredPriceRange).toEqual({ min: 70, max: 130 });
      expect(summary.recentSelectedRestaurants).toContain('粤菜餐厅');
      expect(summary.recentRejectedRestaurants).toContain('火锅餐厅');
    });

    it('should learn unverified or backup selections only as weak cuisine signals', () => {
      const verifiedRestaurant: Restaurant = {
        ...mockRestaurant,
        id: 'r2',
        name: '粤菜餐厅',
        cuisineType: '粤菜',
      };
      const unverifiedRestaurant: Restaurant = {
        ...mockRestaurant,
        id: 'r3',
        name: '候补西餐',
        cuisineType: '西餐',
        recommendationWarnings: ['未验证到明确菜品，作为候补保留。'],
      };
      const records: TurntableRecord[] = [
        {
          id: 'rec1',
          timestamp: 3000,
          query: '想吃粤菜',
          location: mockLocation,
          restaurants: [verifiedRestaurant],
          selected: verifiedRestaurant,
        },
        {
          id: 'rec2',
          timestamp: 2000,
          query: '想吃牛排',
          location: mockLocation,
          restaurants: [unverifiedRestaurant],
          selected: unverifiedRestaurant,
        },
      ];

      const summary = buildUserPreferenceSummary(records);
      const westernWeight = summary.favoriteCuisines?.find((item) => item.name === '西餐')?.weight;
      const cantoneseWeight = summary.favoriteCuisines?.find((item) => item.name === '粤菜')?.weight;

      expect(westernWeight).toBeLessThan(1);
      expect(cantoneseWeight).toBeGreaterThan(westernWeight ?? 0);
    });
  });

  describe('exportHistory and importHistory', () => {
    it('should export history as JSON', () => {
      const record: TurntableRecord = {
        ...mockRecord,
        id: 'rec1',
        timestamp: 1000,
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([record]));

      const exported = exportHistory();
      const data = JSON.parse(exported);

      expect(data.version).toBe('1.0');
      expect(data.records).toHaveLength(1);
      expect(data.exportTime).toBeDefined();
    });

    it('should import history from JSON', () => {
      const record: TurntableRecord = {
        ...mockRecord,
        id: 'rec1',
        timestamp: 1000,
      };

      const data = {
        version: '1.0',
        exportTime: Date.now(),
        records: [record],
      };

      importHistory(JSON.stringify(data));

      const records = getRecords();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe('rec1');
    });

    it('should merge imported records with existing ones', () => {
      const existing: TurntableRecord = {
        ...mockRecord,
        id: 'existing',
        timestamp: 1000,
      };

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify([existing]));

      const imported: TurntableRecord = {
        ...mockRecord,
        id: 'imported',
        timestamp: 2000,
      };

      const data = {
        version: '1.0',
        exportTime: Date.now(),
        records: [imported],
      };

      importHistory(JSON.stringify(data));

      const records = getRecords();
      expect(records).toHaveLength(2);
    });

    it('should throw error on invalid import data', () => {
      expect(() => importHistory('invalid json')).toThrow('导入失败');
      expect(() => importHistory('{}')).toThrow('导入失败');
    });
  });

  describe('getRecordsByDate', () => {
    it('should group records by date', () => {
      const now = Date.now();
      const yesterday = now - 24 * 60 * 60 * 1000;
      const lastWeek = now - 8 * 24 * 60 * 60 * 1000;

      const records: TurntableRecord[] = [
        { ...mockRecord, id: 'rec1', timestamp: now },
        { ...mockRecord, id: 'rec2', timestamp: yesterday },
        { ...mockRecord, id: 'rec3', timestamp: lastWeek },
      ];

      localStorageMock.setItem(STORAGE_CONFIG.key, JSON.stringify(records));

      const grouped = getRecordsByDate();

      expect(grouped).toHaveLength(3);
      expect(grouped[0].date).toBe('今天');
      expect(grouped[1].date).toBe('昨天');
    });

    it('should return empty array when no records', () => {
      const grouped = getRecordsByDate();
      expect(grouped).toEqual([]);
    });
  });

  describe('setReuseRecord and getReuseRecord', () => {
    it('should save and retrieve reuse record', () => {
      const record: TurntableRecord = {
        ...mockRecord,
        id: 'reuse',
        timestamp: 1000,
      };

      setReuseRecord(record);
      const retrieved = getReuseRecord();

      expect(retrieved).not.toBeNull();
      expect(retrieved?.id).toBe('reuse');
    });

    it('should return null when no reuse record', () => {
      const retrieved = getReuseRecord();
      expect(retrieved).toBeNull();
    });

    it('should clear reuse record after retrieval', () => {
      const record: TurntableRecord = {
        ...mockRecord,
        id: 'reuse',
        timestamp: 1000,
      };

      setReuseRecord(record);
      getReuseRecord();
      const secondRetrieval = getReuseRecord();

      expect(secondRetrieval).toBeNull();
    });
  });
});
