# API 接口设计文档

## 项目信息

| 项目名称 | 今天吃啥 - 智能餐饮推荐转盘 |
|---------|---------------------------|
| 版本 | v1.0 |
| 更新日期 | 2025-12-13 |
| 基础路径 | /api |

---

## 第三方服务依赖

本项目 API 层作为代理，调用以下第三方服务：

| 服务 | 用途 | 说明 |
|-----|------|------|
| **OpenAI GPT-5.2** | LLM 需求理解 | 第三方 AI 服务，将用户自然语言转为结构化搜索参数 |
| **高德地图 API** | POI 搜索、地理编码 | 第三方地图服务，提供餐厅搜索和地址解析 |
| **OpenStreetMap** | POI 搜索（备选） | 第三方开源地图服务，作为高德的降级方案 |

---

## 一、接口概览

| 接口 | 方法 | 描述 | 超时 |
|-----|------|------|------|
| /api/understand | POST | LLM 理解用户需求 | 8s |
| /api/search | POST | 搜索餐厅 | 10s |
| /api/geocode | POST | 地址转坐标 | 5s |
| /api/geocode/reverse | POST | 坐标转地址 | 5s |

---

## 二、通用规范

### 2.1 请求格式

```typescript
// Content-Type: application/json
interface ApiRequest {
  // 业务参数（各接口不同）
  [key: string]: any;
}
```

### 2.2 响应格式

```typescript
interface ApiResponse<T = any> {
  success: boolean;        // 是否成功
  data?: T;                // 成功时返回的数据
  error?: {
    code: string;          // 错误码
    message: string;       // 错误信息
  };
}
```

### 2.3 错误码定义

| 错误码 | 描述 | HTTP 状态码 |
|-------|------|------------|
| VALIDATION_ERROR | 请求参数验证失败 | 400 |
| LLM_TIMEOUT | LLM 服务超时 | 504 |
| LLM_ERROR | LLM 服务错误 | 502 |
| MAP_NO_RESULT | 地图搜索无结果 | 200 |
| MAP_TIMEOUT | 地图服务超时 | 504 |
| MAP_ERROR | 地图服务错误 | 502 |
| GEOCODE_FAILED | 地理编码失败 | 200 |
| INTERNAL_ERROR | 服务器内部错误 | 500 |

---

## 三、接口详细设计

### 3.1 LLM 需求理解接口

**POST /api/understand**

将用户的自然语言需求转化为结构化搜索参数。

#### 请求参数

```typescript
interface UnderstandRequest {
  query: string;          // 用户输入的需求，1-500 字符
  location: {
    lat: number;          // 纬度
    lng: number;          // 经度
    address?: string;     // 地址文本（可选）
  };
}
```

#### 请求示例

```json
{
  "query": "想吃点清淡的素食，不要太贵",
  "location": {
    "lat": 39.9042,
    "lng": 116.4074,
    "address": "北京市朝阳区"
  }
}
```

#### 响应参数

```typescript
interface UnderstandResponse {
  success: boolean;
  data?: {
    keywords: string[];           // 搜索关键词
    cuisineTypes: string[];       // 菜系类型
    priceRange?: {
      min?: number;               // 最低人均（元）
      max?: number;               // 最高人均（元）
    };
    distance: number;             // 搜索半径（米），默认 3000
    requirements: string[];       // 其他需求标签
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### 响应示例

**成功**
```json
{
  "success": true,
  "data": {
    "keywords": ["素食", "清淡", "蔬菜"],
    "cuisineTypes": ["素菜馆", "轻食"],
    "priceRange": {
      "max": 50
    },
    "distance": 3000,
    "requirements": ["环境安静"]
  }
}
```

**失败（超时降级）**
```json
{
  "success": true,
  "data": {
    "keywords": ["清淡", "素食"],
    "cuisineTypes": [],
    "distance": 3000,
    "requirements": []
  },
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "AI 理解超时，使用原始输入搜索"
  }
}
```

#### LLM Prompt 设计

```
系统提示词：
你是一个餐饮需求分析助手。用户会用自然语言描述他们想吃什么，你需要提取结构化信息。

输出 JSON 格式：
{
  "keywords": ["关键词1", "关键词2"],
  "cuisineTypes": ["菜系1", "菜系2"],
  "priceRange": { "min": 数字或null, "max": 数字或null },
  "distance": 数字（米，默认3000）,
  "requirements": ["其他需求"]
}

规则：
1. keywords: 提取用于搜索的关键词，如"火锅"、"烧烤"、"清淡"
2. cuisineTypes: 识别菜系，如"川菜"、"日料"、"西餐"
3. priceRange: 解析价格相关描述
   - "便宜"、"实惠" → max: 30
   - "不要太贵" → max: 50
   - "高档"、"贵一点" → min: 100
4. distance: 解析距离描述
   - "附近" → 1000
   - "近一点" → 2000
   - 默认 → 3000
5. requirements: 其他需求，如"有包间"、"适合约会"

用户输入：
{query}

位置：{address}
```

---

### 3.2 餐厅搜索接口

**POST /api/search**

根据结构化参数搜索餐厅，返回最多 8 家餐厅。

#### 请求参数

```typescript
interface SearchRequest {
  keywords: string[];             // 搜索关键词
  location: {
    lat: number;                  // 纬度
    lng: number;                  // 经度
  };
  distance?: number;              // 搜索半径（米），默认 3000
  cuisineTypes?: string[];        // 菜系过滤
  priceRange?: {
    min?: number;
    max?: number;
  };
}
```

#### 请求示例

```json
{
  "keywords": ["素食", "清淡"],
  "location": {
    "lat": 39.9042,
    "lng": 116.4074
  },
  "distance": 3000,
  "cuisineTypes": ["素菜馆"],
  "priceRange": {
    "max": 50
  }
}
```

#### 响应参数

```typescript
interface Restaurant {
  id: string;                     // 唯一标识
  name: string;                   // 餐厅名称
  cuisineType: string;            // 菜系
  rating?: number;                // 评分（1-5）
  distance: number;               // 距离（米）
  address: string;                // 详细地址
  phone?: string;                 // 联系电话
  openingHours?: string;          // 营业时间
  averagePrice?: number;          // 人均价格（元）
  location: {
    lat: number;
    lng: number;
  };
  photos?: string[];              // 图片 URL 列表
  source: 'amap' | 'osm';         // 数据来源
}

interface SearchResponse {
  success: boolean;
  data?: {
    restaurants: Restaurant[];    // 餐厅列表，最多 8 家
    total: number;                // 总结果数
    searchParams: {               // 实际使用的搜索参数
      keywords: string[];
      distance: number;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### 响应示例

**成功**
```json
{
  "success": true,
  "data": {
    "restaurants": [
      {
        "id": "amap_B0FFFAB6J2",
        "name": "素心斋·茶空间",
        "cuisineType": "素菜馆",
        "rating": 4.8,
        "distance": 1200,
        "address": "北京市朝阳区三里屯太古里北区N4-32",
        "phone": "010-64178899",
        "openingHours": "10:00-22:00",
        "averagePrice": 88,
        "location": {
          "lat": 39.9312,
          "lng": 116.4551
        },
        "photos": [
          "https://example.com/photo1.jpg"
        ],
        "source": "amap"
      }
    ],
    "total": 15,
    "searchParams": {
      "keywords": ["素食", "清淡"],
      "distance": 3000
    }
  }
}
```

**无结果**
```json
{
  "success": true,
  "data": {
    "restaurants": [],
    "total": 0,
    "searchParams": {
      "keywords": ["素食", "清淡"],
      "distance": 3000
    }
  },
  "error": {
    "code": "MAP_NO_RESULT",
    "message": "未找到符合条件的餐厅"
  }
}
```

#### 高德地图 API 调用

```typescript
// 高德 POI 搜索
const amapSearch = async (params: SearchRequest): Promise<Restaurant[]> => {
  const url = 'https://restapi.amap.com/v3/place/around';
  const query = new URLSearchParams({
    key: process.env.AMAP_API_KEY!,
    location: `${params.location.lng},${params.location.lat}`,
    keywords: params.keywords.join('|'),
    types: '050000', // 餐饮服务
    radius: String(params.distance || 3000),
    offset: '20',
    extensions: 'all',
  });

  const response = await fetch(`${url}?${query}`);
  const data = await response.json();

  // 转换为统一格式
  return data.pois.map(transformAmapPoi);
};
```

---

### 3.3 地理编码接口

**POST /api/geocode**

将地址文本转换为经纬度坐标。

#### 请求参数

```typescript
interface GeocodeRequest {
  address: string;        // 地址文本
  city?: string;          // 城市（提高准确度）
}
```

#### 请求示例

```json
{
  "address": "北京市朝阳区三里屯",
  "city": "北京"
}
```

#### 响应参数

```typescript
interface GeocodeResponse {
  success: boolean;
  data?: {
    location: {
      lat: number;
      lng: number;
    };
    formattedAddress: string;     // 格式化地址
    city: string;                 // 城市
    district: string;             // 区县
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### 响应示例

```json
{
  "success": true,
  "data": {
    "location": {
      "lat": 39.9312,
      "lng": 116.4551
    },
    "formattedAddress": "北京市朝阳区三里屯街道",
    "city": "北京市",
    "district": "朝阳区"
  }
}
```

---

### 3.4 逆地理编码接口

**POST /api/geocode/reverse**

将经纬度坐标转换为地址文本。

#### 请求参数

```typescript
interface ReverseGeocodeRequest {
  location: {
    lat: number;
    lng: number;
  };
}
```

#### 请求示例

```json
{
  "location": {
    "lat": 39.9312,
    "lng": 116.4551
  }
}
```

#### 响应参数

```typescript
interface ReverseGeocodeResponse {
  success: boolean;
  data?: {
    formattedAddress: string;     // 完整地址
    city: string;                 // 城市
    district: string;             // 区县
    street: string;               // 街道
  };
  error?: {
    code: string;
    message: string;
  };
}
```

#### 响应示例

```json
{
  "success": true,
  "data": {
    "formattedAddress": "北京市朝阳区三里屯街道太古里",
    "city": "北京市",
    "district": "朝阳区",
    "street": "三里屯路"
  }
}
```

---

## 四、数据模型定义

### 4.1 核心类型定义

```typescript
// types/index.ts

// 位置信息
export interface Location {
  lat: number;
  lng: number;
  address?: string;
}

// 餐厅信息
export interface Restaurant {
  id: string;
  name: string;
  cuisineType: string;
  rating?: number;
  distance: number;
  address: string;
  phone?: string;
  openingHours?: string;
  averagePrice?: number;
  location: Location;
  photos?: string[];
  source: 'amap' | 'osm';
}

// LLM 解析结果
export interface ParsedRequirement {
  keywords: string[];
  cuisineTypes: string[];
  priceRange?: {
    min?: number;
    max?: number;
  };
  distance: number;
  requirements: string[];
}

// 转盘记录（历史）
export interface TurntableRecord {
  id: string;
  timestamp: number;
  originalRequest: string;
  location: Location;
  selectedRestaurant: Restaurant;
  allRestaurants: Restaurant[];
}

// 应用状态
export type AppStep =
  | 'INPUT'
  | 'UNDERSTANDING'
  | 'SEARCHING'
  | 'READY'
  | 'SPINNING'
  | 'RESULT'
  | 'ERROR';

export interface AppState {
  step: AppStep;
  query: string;
  location: Location | null;
  parsedRequirement: ParsedRequirement | null;
  restaurants: Restaurant[];
  selectedIndex: number | null;
  selectedRestaurant: Restaurant | null;
  error: string | null;
  isLoading: boolean;
}
```

### 4.2 localStorage 存储结构

```typescript
// Key: 'chisha_history'
// Value: TurntableRecord[] (JSON 序列化)

// 存储限制
const MAX_HISTORY_COUNT = 100;

// 存储示例
{
  "chisha_history": [
    {
      "id": "1702468200000_abc123",
      "timestamp": 1702468200000,
      "originalRequest": "想吃清淡的素食",
      "location": {
        "lat": 39.9042,
        "lng": 116.4074,
        "address": "北京市朝阳区"
      },
      "selectedRestaurant": { ... },
      "allRestaurants": [ ... ]
    }
  ]
}
```

---

## 五、错误处理流程

### 5.1 LLM 接口错误处理

```typescript
async function handleUnderstand(req: UnderstandRequest) {
  try {
    const result = await callLLM(req.query, req.location);
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof TimeoutError) {
      // 降级：使用原始输入
      return {
        success: true,
        data: fallbackParse(req.query),
        error: {
          code: 'LLM_TIMEOUT',
          message: 'AI 理解超时，使用原始输入搜索'
        }
      };
    }
    throw error;
  }
}

// 降级解析
function fallbackParse(query: string): ParsedRequirement {
  // 简单分词作为关键词
  const keywords = query
    .replace(/[，。！？、]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1);

  return {
    keywords,
    cuisineTypes: [],
    distance: 3000,
    requirements: []
  };
}
```

### 5.2 地图接口错误处理

```typescript
async function handleSearch(req: SearchRequest) {
  try {
    // 优先使用高德
    const result = await amapSearch(req);
    if (result.length > 0) {
      return { success: true, data: { restaurants: result.slice(0, 8) } };
    }

    // 高德无结果，尝试 OSM（备选）
    const osmResult = await osmSearch(req);
    if (osmResult.length > 0) {
      return { success: true, data: { restaurants: osmResult.slice(0, 8) } };
    }

    // 都无结果
    return {
      success: true,
      data: { restaurants: [], total: 0 },
      error: {
        code: 'MAP_NO_RESULT',
        message: '未找到符合条件的餐厅'
      }
    };
  } catch (error) {
    if (error instanceof TimeoutError) {
      return {
        success: false,
        error: {
          code: 'MAP_TIMEOUT',
          message: '搜索超时，请重试'
        }
      };
    }
    throw error;
  }
}
```

---

## 六、接口调用时序

### 6.1 完整流程时序图

```
用户          前端            /api/understand     /api/search      高德API
 │             │                   │                  │               │
 │ 提交需求    │                   │                  │               │
 ├────────────▶│                   │                  │               │
 │             │ POST /understand  │                  │               │
 │             ├──────────────────▶│                  │               │
 │             │                   │ 调用 GPT-5.2     │               │
 │             │                   ├─────────────────▶│               │
 │             │                   │◀─────────────────┤               │
 │             │◀──────────────────┤                  │               │
 │             │                   │                  │               │
 │             │ POST /search      │                  │               │
 │             ├──────────────────────────────────────▶               │
 │             │                   │                  │ POI 搜索      │
 │             │                   │                  ├──────────────▶│
 │             │                   │                  │◀──────────────┤
 │             │◀──────────────────────────────────────               │
 │             │                   │                  │               │
 │ 显示转盘    │                   │                  │               │
 │◀────────────┤                   │                  │               │
```

### 6.2 并行优化时序图（可选）

```
用户          前端            /api/understand     /api/search
 │             │                   │                  │
 │ 提交需求    │                   │                  │
 ├────────────▶│                   │                  │
 │             │ POST /understand  │                  │
 │             ├──────────────────▶│                  │
 │             │                   │                  │
 │             │ POST /search (投机，用原始query)      │
 │             ├──────────────────────────────────────▶
 │             │                   │                  │
 │             │◀──────────────────┤ LLM 结果         │
 │             │                   │                  │
 │             │◀──────────────────────────────────────┤ 搜索结果
 │             │                   │                  │
 │             │ 合并/选择最优结果  │                  │
 │◀────────────┤                   │                  │
```
