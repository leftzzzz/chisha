/**
 * 核心类型定义
 */

// 地理位置信息
export interface Location {
  lat: number; // 纬度
  lng: number; // 经度
  address?: string; // 地址描述（可选）
}

// 餐厅信息
export interface Restaurant {
  id: string; // 餐厅唯一标识
  name: string; // 餐厅名称
  cuisineType: string; // 菜系类型（如：川菜、粤菜等）
  rating?: number; // 评分（0-5）
  distance?: number; // 距离（米）
  address: string; // 详细地址
  phone?: string; // 联系电话
  openingHours?: string; // 营业时间
  averagePrice?: number; // 人均消费（元）
  location: Location; // 地理位置
  source: 'amap' | 'osm'; // 数据来源
}

// LLM 解析后的需求
export interface ParsedRequirement {
  keywords: string[]; // 搜索关键词（如：火锅、川菜）
  cuisineTypes: string[]; // 菜系类型
  priceRange?: {
    min?: number; // 最低价格
    max?: number; // 最高价格
  };
  searchRadius: number; // 搜索半径（米），默认 2000
}

// ============ API 请求/响应类型 ============

// 理解用户需求 API
export interface UnderstandRequest {
  query: string; // 用户输入的需求描述
  location?: Location; // 用户当前位置（可选）
}

export interface UnderstandResponse {
  parsed: ParsedRequirement; // 解析结果
}

// 搜索餐厅 API
export interface SearchRequest {
  keywords: string[]; // 搜索关键词
  location: Location; // 搜索中心点
  distance?: number; // 搜索半径（米），默认 2000
  cuisineTypes?: string[]; // 菜系过滤
  priceRange?: {
    min?: number;
    max?: number;
  };
  count?: number; // 返回数量，默认 8
}

export interface SearchResponse {
  restaurants: Restaurant[]; // 餐厅列表
  source: 'amap' | 'osm' | 'mixed'; // 数据来源
}

// 地理编码 API (地址 -> 坐标)
export interface GeocodeRequest {
  address: string; // 地址
  city?: string; // 城市（可选）
}

export interface GeocodeResponse {
  location: Location; // 地理位置
}

// 逆向地理编码 API (坐标 -> 地址)
export interface ReverseGeocodeRequest {
  location: Location; // 地理位置
}

export interface ReverseGeocodeResponse {
  address: string; // 地址描述
  formattedAddress?: string; // 格式化地址
  province?: string; // 省份
  city?: string; // 城市
  district?: string; // 区县
}

// ============ 应用状态类型 ============

// 应用步骤
export type AppStep =
  | 'INPUT'        // 输入需求
  | 'UNDERSTANDING' // 理解需求中
  | 'SEARCHING'    // 搜索中
  | 'READY'        // 转盘就绪
  | 'SPINNING'     // 转盘选择中
  | 'RESULT'       // 显示结果
  | 'ERROR';       // 错误状态

// 应用状态
export interface AppState {
  step: AppStep;
  userQuery: string; // 用户输入的需求
  userLocation: Location | null; // 用户位置
  parsedRequirement: ParsedRequirement | null; // 解析后的需求
  restaurants: Restaurant[]; // 搜索到的餐厅
  selectedIndex: number; // 选中的餐厅索引 (-1 表示未选中)
  error: string | null; // 错误信息
}

// Reducer Actions
export type AppAction =
  | { type: 'SET_QUERY'; payload: string }
  | { type: 'SET_LOCATION'; payload: Location | null }
  | { type: 'SET_STEP'; payload: AppStep }
  | { type: 'SET_PARSED_REQUIREMENT'; payload: ParsedRequirement }
  | { type: 'SET_RESTAURANTS'; payload: Restaurant[] }
  | { type: 'SET_SELECTED_INDEX'; payload: number }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'DELETE_RESTAURANT'; payload: number }
  | { type: 'RESET_STATE' };

// 转盘记录（用于后续功能）
export interface TurntableRecord {
  id: string;
  timestamp: number; // 时间戳
  query: string; // 用户需求
  location: Location; // 位置
  restaurants: Restaurant[]; // 参与的餐厅
  selected: Restaurant; // 选中的餐厅
  userFeedback?: 'like' | 'dislike'; // 用户反馈
}

// ============ 错误类型 ============

export class TimeoutError extends Error {
  constructor(message: string = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
