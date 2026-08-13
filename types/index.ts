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
  businessStatus?: 'open' | 'closed' | 'unknown'; // 营业状态（数据源可提供时）
  averagePrice?: number; // 人均消费（元）
  poiTypeCode?: string; // 数据源返回的 POI 类型码（如高德 typecode）
  recommendationReason?: string; // 推荐理由
  recommendationWarnings?: string[]; // 不可验证或放宽匹配说明
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
  poiType?: string; // 高德 POI 类型代码（可选，由 LLM 决定是否使用）
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
  poiType?: string; // 高德 POI 类型代码
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
  | 'AGENT_QUESTION' // Agent 等待用户补充
  | 'READY'        // 转盘就绪
  | 'SPINNING'     // 转盘选择中
  | 'RESULT'       // 显示结果
  | 'ERROR';       // 错误状态

// 自定义选项（纯文字，非餐厅）
export interface CustomOption {
  id: string;
  name: string;
  isCustom: true; // 标记为自定义选项
}

// 转盘选项（可以是餐厅或自定义选项）
export type TurntableOption = Restaurant | CustomOption;

// 判断是否为自定义选项
export function isCustomOption(option: TurntableOption): option is CustomOption {
  return 'isCustom' in option && option.isCustom === true;
}

/** 追问选项：id 是协议，label 只用于展示。 */
export interface AgentQuestionOptionState {
  id: string;
  label: string;
}

export interface AgentQuestionState {
  sessionId: string;
  question: string;
  options?: AgentQuestionOptionState[];
  allowFreeText: boolean;
}

export interface AgentTraceRef {
  traceId?: string;
  type: string;
  message?: string;
  createdAt: number;
}

// 应用状态
export interface AppState {
  step: AppStep;
  userQuery: string; // 用户输入的需求
  userLocation: Location | null; // 用户位置
  parsedRequirement: ParsedRequirement | null; // 解析后的需求
  restaurants: Restaurant[]; // 转盘上的餐厅
  candidateRestaurants: Restaurant[]; // 候补池餐厅
  agentExplanation?: string; // Agent 整体推荐说明
  agentUnmetConstraints: string[]; // 未完全满足或无法验证的约束
  agentSessionId: string | null; // 当前 Agent 会话 ID
  agentQuestion: AgentQuestionState | null; // Agent 当前追问
  agentTrace: AgentTraceRef[]; // Agent 可回放事件索引
  removedRestaurants: Restaurant[]; // 已移除的餐厅（可恢复）
  customOptions: CustomOption[]; // 转盘上的自定义选项
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
  | {
      type: 'SET_RESTAURANTS_WITH_CANDIDATES';
      payload: {
        turntable: Restaurant[];
        candidates: Restaurant[];
        explanation?: string;
        unmetConstraints?: string[];
      };
    }
  | { type: 'SET_SELECTED_INDEX'; payload: number }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_AGENT_SESSION_ID'; payload: string | null }
  | { type: 'SET_AGENT_QUESTION'; payload: AgentQuestionState | null }
  | { type: 'APPEND_AGENT_TRACE'; payload: AgentTraceRef }
  | { type: 'SET_AGENT_TRACE'; payload: AgentTraceRef[] }
  | { type: 'CLEAR_AGENT_TRACE' }
  | { type: 'DELETE_RESTAURANT'; payload: number }
  | { type: 'RESTORE_RESTAURANT'; payload: number } // 从已移除恢复到转盘
  | { type: 'ADD_FROM_CANDIDATES'; payload: number } // 从候补池添加到转盘
  | { type: 'REMOVE_TO_CANDIDATES'; payload: number } // 从转盘移到候补池
  | { type: 'ADD_RESTAURANT'; payload: Restaurant } // 直接添加餐厅到转盘
  | { type: 'ADD_CUSTOM_OPTION'; payload: CustomOption } // 添加自定义选项
  | { type: 'REMOVE_CUSTOM_OPTION'; payload: string } // 删除自定义选项
  | { type: 'RESTORE_FROM_HISTORY'; payload: { query: string; location: Location; restaurants: Restaurant[]; customOptions?: CustomOption[] } } // 从历史记录恢复
  | { type: 'RESET_STATE' };

// 转盘记录（用于后续功能）
export interface TurntableRecord {
  id: string;
  timestamp: number; // 时间戳
  query: string; // 用户需求
  location: Location; // 位置
  restaurants: Restaurant[]; // 参与的餐厅
  rejectedRestaurants?: Restaurant[]; // 用户手动删除的餐厅
  customOptions?: CustomOption[]; // 参与的自定义选项
  selected: Restaurant | CustomOption; // 选中的餐厅或自定义选项
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

// 错误信息配置
export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface ErrorInfo {
  message: string; // 用户友好的错误信息
  severity: ErrorSeverity; // 错误级别：error 致命错误，warning 可重试，info 信息
  code: string; // 错误代码
  description?: string; // 详细描述
  retryable: boolean; // 是否可以重试
  actionLabel?: string; // 操作按钮文本（"返回"/"重试"）
}
