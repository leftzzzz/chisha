/**
 * Storage - localStorage 操作封装
 *
 * 提供历史记录的持久化存储,包括:
 * - 保存转盘记录
 * - 读取历史记录
 * - 删除记录
 * - 清空历史
 *
 * 特性:
 * - 最多保存 100 条记录
 * - 自动删除最早的记录
 * - 异常处理(存储满、格式错误等)
 * - 支持 SSR (检查 window 存在)
 */

import { TurntableRecord, Location, Restaurant } from '@/types';

/**
 * 存储配置
 */
const STORAGE_CONFIG = {
  key: 'chisha_history', // localStorage key
  maxRecords: 100, // 最多保存记录数
};

/**
 * 检查是否在浏览器环境
 */
function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

/**
 * 安全的 localStorage 操作
 *
 * 处理 localStorage 不可用的情况(SSR、隐私模式等)
 */
class SafeStorage {
  private isAvailable: boolean;

  constructor() {
    this.isAvailable = this.checkAvailability();
  }

  /**
   * 检查 localStorage 是否可用
   */
  private checkAvailability(): boolean {
    if (!isBrowser()) {
      return false;
    }

    try {
      const testKey = '__storage_test__';
      window.localStorage.setItem(testKey, 'test');
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 获取数据
   */
  getItem(key: string): string | null {
    if (!this.isAvailable) {
      return null;
    }

    try {
      return window.localStorage.getItem(key);
    } catch (error) {
      console.error('Failed to get item from localStorage:', error);
      return null;
    }
  }

  /**
   * 设置数据
   */
  setItem(key: string, value: string): void {
    if (!this.isAvailable) {
      console.warn('localStorage is not available');
      return;
    }

    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.error('Failed to set item to localStorage:', error);
      // 如果存储满了,尝试清除一些旧数据
      if (error instanceof Error && error.name === 'QuotaExceededError') {
        console.warn('localStorage quota exceeded, clearing old records...');
        this.clearOldRecords();
        // 重试一次
        try {
          window.localStorage.setItem(key, value);
        } catch {
          console.error('Failed to set item even after clearing old records');
        }
      }
    }
  }

  /**
   * 删除数据
   */
  removeItem(key: string): void {
    if (!this.isAvailable) {
      return;
    }

    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      console.error('Failed to remove item from localStorage:', error);
    }
  }

  /**
   * 清除旧记录(保留最近的 50 条)
   */
  private clearOldRecords(): void {
    try {
      const data = this.getItem(STORAGE_CONFIG.key);
      if (!data) return;

      const records = JSON.parse(data) as TurntableRecord[];
      const recentRecords = records.slice(0, 50);
      const newData = JSON.stringify(recentRecords);
      window.localStorage.setItem(STORAGE_CONFIG.key, newData);
    } catch (error) {
      console.error('Failed to clear old records:', error);
    }
  }
}

// 创建单例
const storage = new SafeStorage();

/**
 * 获取历史记录（同步版本）
 *
 * @returns 历史记录数组(按时间倒序)
 *
 * @example
 * ```ts
 * const history = getRecords();
 * console.log(history.length); // 记录数量
 * ```
 */
export function getRecords(): TurntableRecord[] {
  try {
    const data = storage.getItem(STORAGE_CONFIG.key);

    if (!data) {
      return [];
    }

    const records = JSON.parse(data) as TurntableRecord[];

    // 验证数据格式
    if (!Array.isArray(records)) {
      console.warn('Invalid history data format, resetting...');
      storage.removeItem(STORAGE_CONFIG.key);
      return [];
    }

    // 按时间倒序排序
    return records.sort((a, b) => b.timestamp - a.timestamp);
  } catch (error) {
    console.error('Failed to get history:', error);
    // 数据损坏,清除并返回空数组
    storage.removeItem(STORAGE_CONFIG.key);
    return [];
  }
}

/**
 * 获取历史记录（异步版本，保持向后兼容）
 */
export async function getHistory(): Promise<TurntableRecord[]> {
  return getRecords();
}

/**
 * 保存记录（同步版本）
 */
export function saveRecord(
  record: Omit<TurntableRecord, 'id' | 'timestamp'> | TurntableRecord
): void {
  try {
    const history = getRecords();

    // 创建完整记录
    const fullRecord: TurntableRecord = 'id' in record && 'timestamp' in record
      ? record
      : {
          id: generateId(),
          timestamp: Date.now(),
          ...record,
        };

    // 添加到列表开头
    history.unshift(fullRecord);

    // 限制最大记录数
    const limitedHistory = history.slice(0, STORAGE_CONFIG.maxRecords);

    // 保存到 localStorage
    const data = JSON.stringify(limitedHistory);
    storage.setItem(STORAGE_CONFIG.key, data);
  } catch (error) {
    console.error('Failed to save record:', error);
    throw new Error('保存记录失败');
  }
}

/**
 * 保存记录（异步版本，保持向后兼容）
 */
export async function saveRecordAsync(
  record: Omit<TurntableRecord, 'id' | 'timestamp'>
): Promise<void> {
  saveRecord(record);
}

/**
 * 删除记录（同步版本）
 */
export function deleteRecord(id: string): void {
  try {
    const history = getRecords();
    const filtered = history.filter((record) => record.id !== id);

    const data = JSON.stringify(filtered);
    storage.setItem(STORAGE_CONFIG.key, data);
  } catch (error) {
    console.error('Failed to delete record:', error);
    throw new Error('删除记录失败');
  }
}

/**
 * 删除记录（异步版本，保持向后兼容）
 */
export async function deleteRecordAsync(id: string): Promise<void> {
  deleteRecord(id);
}

/**
 * 清空所有历史记录（同步版本）
 */
export function clearRecords(): void {
  try {
    storage.removeItem(STORAGE_CONFIG.key);
  } catch (error) {
    console.error('Failed to clear history:', error);
    throw new Error('清空历史失败');
  }
}

/**
 * 清空所有历史记录（异步版本，保持向后兼容）
 */
export async function clearHistory(): Promise<void> {
  clearRecords();
}

/**
 * 创建记录(便利方法)
 *
 * 从原始数据创建 TurntableRecord
 *
 * @param query - 用户查询
 * @param location - 位置
 * @param selectedRestaurant - 选中的餐厅
 * @param allRestaurants - 所有餐厅
 * @returns 待保存的记录
 *
 * @example
 * ```ts
 * const record = createRecord(
 *   '我想吃火锅',
 *   { lat: 39.9, lng: 116.4 },
 *   selectedRestaurant,
 *   allRestaurants
 * );
 * await saveRecord(record);
 * ```
 */
export function createRecord(
  query: string,
  location: Location,
  selectedRestaurant: Restaurant,
  allRestaurants: Restaurant[]
): Omit<TurntableRecord, 'id' | 'timestamp'> {
  return {
    query,
    location,
    selected: selectedRestaurant,
    restaurants: allRestaurants,
  };
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 搜索历史记录
 *
 * 根据关键词搜索历史记录(餐厅名称、菜系、查询内容)
 *
 * @param keyword - 搜索关键词
 * @returns 匹配的记录数组
 */
export function searchHistory(keyword: string): TurntableRecord[] {
  if (!keyword.trim()) {
    return getRecords();
  }

  const records = getRecords();
  const lowerKeyword = keyword.toLowerCase();

  return records.filter((record) => {
    // 搜索查询内容
    if (record.query.toLowerCase().includes(lowerKeyword)) {
      return true;
    }

    // 搜索选中的餐厅
    if (record.selected.name.toLowerCase().includes(lowerKeyword)) {
      return true;
    }
    if (record.selected.cuisineType.toLowerCase().includes(lowerKeyword)) {
      return true;
    }

    // 搜索所有餐厅
    return record.restaurants.some(
      (r) =>
        r.name.toLowerCase().includes(lowerKeyword) ||
        r.cuisineType.toLowerCase().includes(lowerKeyword)
    );
  });
}

/**
 * 统计信息
 */
export interface HistoryStats {
  totalRecords: number; // 总记录数
  totalRestaurants: number; // 总餐厅数(去重)
  mostVisited: Array<{ name: string; count: number }>; // 最常去的餐厅
  favoriteCuisines: Array<{ cuisine: string; count: number }>; // 最喜欢的菜系
  recentDays: number; // 记录跨越的天数
  averageRestaurantsPerRecord: number; // 平均每次参与的餐厅数
}

/**
 * 获取历史统计信息
 *
 * @returns 统计信息
 */
export function getStats(): HistoryStats {
  const records = getRecords();

  if (records.length === 0) {
    return {
      totalRecords: 0,
      totalRestaurants: 0,
      mostVisited: [],
      favoriteCuisines: [],
      recentDays: 0,
      averageRestaurantsPerRecord: 0,
    };
  }

  // 统计餐厅访问次数
  const restaurantVisits = new Map<string, number>();
  const cuisineVisits = new Map<string, number>();
  const restaurantNames = new Map<string, string>(); // id -> name
  let totalRestaurantsCount = 0;

  records.forEach((record) => {
    const selectedId = record.selected.id;
    const selectedName = record.selected.name;
    const selectedCuisine = record.selected.cuisineType;

    // 统计餐厅
    restaurantVisits.set(selectedId, (restaurantVisits.get(selectedId) || 0) + 1);
    restaurantNames.set(selectedId, selectedName);

    // 统计菜系
    cuisineVisits.set(selectedCuisine, (cuisineVisits.get(selectedCuisine) || 0) + 1);

    // 统计所有参与的餐厅数
    totalRestaurantsCount += record.restaurants.length;
  });

  // 排序并获取前 10
  const mostVisited = Array.from(restaurantVisits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({
      name: restaurantNames.get(id) || '未知',
      count,
    }));

  const favoriteCuisines = Array.from(cuisineVisits.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cuisine, count]) => ({
      cuisine,
      count,
    }));

  // 计算时间跨度
  const timestamps = records.map((r) => r.timestamp);
  const oldest = Math.min(...timestamps);
  const newest = Math.max(...timestamps);
  const recentDays = Math.ceil((newest - oldest) / (1000 * 60 * 60 * 24));

  // 计算平均每次参与的餐厅数
  const averageRestaurantsPerRecord = totalRestaurantsCount / records.length;

  return {
    totalRecords: records.length,
    totalRestaurants: restaurantNames.size,
    mostVisited,
    favoriteCuisines,
    recentDays,
    averageRestaurantsPerRecord: Math.round(averageRestaurantsPerRecord * 10) / 10,
  };
}

/**
 * 导出历史记录
 *
 * 生成 JSON 格式的历史数据,用于备份或迁移
 *
 * @returns JSON 字符串
 */
export function exportHistory(): string {
  const records = getRecords();
  const data = {
    version: '1.0',
    exportTime: Date.now(),
    records,
  };
  return JSON.stringify(data, null, 2);
}

/**
 * 导入历史记录
 *
 * 从 JSON 数据导入历史记录,会合并现有记录(去重)
 *
 * @param jsonData - JSON 字符串
 * @throws 如果数据格式无效
 */
export function importHistory(jsonData: string): void {
  try {
    const data = JSON.parse(jsonData);

    // 验证格式
    if (!data.records || !Array.isArray(data.records)) {
      throw new Error('Invalid data format: missing records array');
    }

    // 获取现有记录
    const existingRecords = getRecords();
    const existingIds = new Set(existingRecords.map((r) => r.id));

    // 合并记录(去重)
    const newRecords = data.records.filter(
      (record: TurntableRecord) => !existingIds.has(record.id)
    );

    if (newRecords.length === 0) {
      console.log('No new records to import');
      return;
    }

    // 合并并排序
    const allRecords = [...existingRecords, ...newRecords].sort(
      (a, b) => b.timestamp - a.timestamp
    );

    // 限制总数
    const limitedRecords = allRecords.slice(0, STORAGE_CONFIG.maxRecords);

    // 保存
    const jsonString = JSON.stringify(limitedRecords);
    storage.setItem(STORAGE_CONFIG.key, jsonString);

    console.log(`Imported ${newRecords.length} new records`);
  } catch (error) {
    console.error('Failed to import history:', error);
    throw new Error('导入失败: 数据格式无效');
  }
}

/**
 * 按日期分组历史记录
 *
 * @returns 分组后的记录
 */
export interface GroupedRecords {
  date: string; // 日期标签(如: "今天", "昨天", "2024-01-15")
  timestamp: number; // 用于排序的时间戳
  records: TurntableRecord[];
}

export function getRecordsByDate(): GroupedRecords[] {
  const records = getRecords();
  const groups = new Map<string, TurntableRecord[]>();
  const now = new Date();

  records.forEach((record) => {
    const date = new Date(record.timestamp);
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    let label: string;
    if (diffDays === 0) {
      label = '今天';
    } else if (diffDays === 1) {
      label = '昨天';
    } else if (diffDays < 7) {
      label = `${diffDays}天前`;
    } else {
      label = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label)!.push(record);
  });

  // 转换为数组并排序
  return Array.from(groups.entries())
    .map(([date, records]) => ({
      date,
      timestamp: records[0].timestamp,
      records,
    }))
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * 导出配置(用于测试)
 */
export { STORAGE_CONFIG };
