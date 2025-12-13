/**
 * Storage 功能测试
 *
 * 测试 localStorage 操作和历史记录管理
 */

import {
  getRecords,
  saveRecord,
  deleteRecord,
  clearRecords,
  searchHistory,
  getStats,
  exportHistory,
  importHistory,
  getRecordsByDate,
  STORAGE_CONFIG,
} from '@/lib/storage';
import { TurntableRecord, Restaurant, Location } from '@/types';

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

// 测试数据
const mockLocation: Location = {
  lat: 39.9,
  lng: 116.4,
  address: '北京市朝阳区',
};

const mockRestaurant: Restaurant = {
  id: 'test-1',
  name: '测试餐厅',
  cuisineType: '川菜',
  address: '测试地址',
  location: mockLocation,
  source: 'amap',
};

const createMockRecord = (id: string, timestamp: number): TurntableRecord => ({
  id,
  timestamp,
  query: '我想吃火锅',
  location: mockLocation,
  selected: mockRestaurant,
  restaurants: [mockRestaurant],
});

describe('Storage - 基础功能', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('getRecords - 空历史记录', () => {
    const records = getRecords();
    expect(records).toEqual([]);
  });

  test('saveRecord - 保存新记录', () => {
    saveRecord({
      query: '我想吃火锅',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    const records = getRecords();
    expect(records.length).toBe(1);
    expect(records[0].query).toBe('我想吃火锅');
    expect(records[0]).toHaveProperty('id');
    expect(records[0]).toHaveProperty('timestamp');
  });

  test('deleteRecord - 删除记录', () => {
    saveRecord({
      query: '测试1',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    const records = getRecords();
    const id = records[0].id;

    deleteRecord(id);

    const updatedRecords = getRecords();
    expect(updatedRecords.length).toBe(0);
  });

  test('clearRecords - 清空所有记录', () => {
    saveRecord({
      query: '测试1',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    saveRecord({
      query: '测试2',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    clearRecords();

    const records = getRecords();
    expect(records.length).toBe(0);
  });
});

describe('Storage - 搜索功能', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('searchHistory - 搜索餐厅名称', () => {
    const restaurant1: Restaurant = { ...mockRestaurant, id: '1', name: '火锅店' };
    const restaurant2: Restaurant = { ...mockRestaurant, id: '2', name: '烧烤店' };

    saveRecord({
      query: '想吃火锅',
      location: mockLocation,
      selected: restaurant1,
      restaurants: [restaurant1],
    });

    saveRecord({
      query: '想吃烧烤',
      location: mockLocation,
      selected: restaurant2,
      restaurants: [restaurant2],
    });

    const results = searchHistory('火锅');
    expect(results.length).toBe(1);
    expect(results[0].selected.name).toBe('火锅店');
  });

  test('searchHistory - 空关键词返回所有记录', () => {
    saveRecord({
      query: '测试',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    const results = searchHistory('');
    expect(results.length).toBe(1);
  });
});

describe('Storage - 统计功能', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('getStats - 空记录返回零值', () => {
    const stats = getStats();
    expect(stats.totalRecords).toBe(0);
    expect(stats.totalRestaurants).toBe(0);
    expect(stats.mostVisited).toEqual([]);
    expect(stats.favoriteCuisines).toEqual([]);
  });

  test('getStats - 统计最常去的餐厅', () => {
    const restaurant1: Restaurant = { ...mockRestaurant, id: '1', name: '餐厅A' };
    const restaurant2: Restaurant = { ...mockRestaurant, id: '2', name: '餐厅B' };

    // 餐厅A去了2次
    saveRecord({
      query: '测试1',
      location: mockLocation,
      selected: restaurant1,
      restaurants: [restaurant1, restaurant2],
    });

    saveRecord({
      query: '测试2',
      location: mockLocation,
      selected: restaurant1,
      restaurants: [restaurant1, restaurant2],
    });

    // 餐厅B去了1次
    saveRecord({
      query: '测试3',
      location: mockLocation,
      selected: restaurant2,
      restaurants: [restaurant1, restaurant2],
    });

    const stats = getStats();
    expect(stats.totalRecords).toBe(3);
    expect(stats.totalRestaurants).toBe(2);
    expect(stats.mostVisited[0].name).toBe('餐厅A');
    expect(stats.mostVisited[0].count).toBe(2);
  });
});

describe('Storage - 导入导出', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('exportHistory - 导出为JSON', () => {
    saveRecord({
      query: '测试',
      location: mockLocation,
      selected: mockRestaurant,
      restaurants: [mockRestaurant],
    });

    const exported = exportHistory();
    const data = JSON.parse(exported);

    expect(data).toHaveProperty('version');
    expect(data).toHaveProperty('exportTime');
    expect(data).toHaveProperty('records');
    expect(data.records.length).toBe(1);
  });

  test('importHistory - 导入JSON数据', () => {
    const mockData = {
      version: '1.0',
      exportTime: Date.now(),
      records: [createMockRecord('test-1', Date.now())],
    };

    importHistory(JSON.stringify(mockData));

    const records = getRecords();
    expect(records.length).toBe(1);
    expect(records[0].id).toBe('test-1');
  });

  test('importHistory - 去重合并', () => {
    const record = createMockRecord('test-1', Date.now());
    saveRecord(record);

    const mockData = {
      version: '1.0',
      exportTime: Date.now(),
      records: [record, createMockRecord('test-2', Date.now())],
    };

    importHistory(JSON.stringify(mockData));

    const records = getRecords();
    // 应该只有2条(去除重复的test-1)
    expect(records.length).toBe(2);
  });
});

describe('Storage - 按日期分组', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('getRecordsByDate - 按日期分组', () => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;

    saveRecord(createMockRecord('today-1', now));
    saveRecord(createMockRecord('yesterday-1', yesterday));

    const grouped = getRecordsByDate();
    expect(grouped.length).toBeGreaterThan(0);
    // 应该有今天和昨天两个分组
  });
});

describe('Storage - 边界情况', () => {
  beforeEach(() => {
    localStorageMock.clear();
  });

  test('保存记录数量限制', () => {
    // 保存超过最大数量的记录
    for (let i = 0; i < STORAGE_CONFIG.maxRecords + 10; i++) {
      saveRecord({
        query: `测试${i}`,
        location: mockLocation,
        selected: mockRestaurant,
        restaurants: [mockRestaurant],
      });
    }

    const records = getRecords();
    // 应该只保留最大数量
    expect(records.length).toBe(STORAGE_CONFIG.maxRecords);
  });

  test('删除不存在的记录', () => {
    expect(() => deleteRecord('non-existent-id')).not.toThrow();
  });

  test('导入无效JSON', () => {
    expect(() => importHistory('invalid json')).toThrow();
  });
});
