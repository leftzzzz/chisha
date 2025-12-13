# 今天吃啥 - Phase 2 后端 API 文档

## 概述

Phase 2 实现了完整的后端 API，包括：

1. LLM 理解用户需求
2. 餐厅搜索（高德地图 + OpenStreetMap 降级）
3. 地理编码服务

## 环境配置

### 必需的环境变量

创建 `.env.local` 文件（参考 `.env.example`）：

```bash
# OpenAI API Configuration
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1

# Amap (高德地图) API Configuration
AMAP_API_KEY=...
AMAP_SECURITY_CODE=...

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOG_LEVEL=info
```

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

服务将运行在 `http://localhost:3000`

## API 端点

### 1. 理解用户需求

**端点**: `POST /api/understand`

**功能**: 使用 LLM 解析用户的自然语言需求，提取搜索参数。

**请求体**:
```json
{
  "query": "我想吃附近便宜的火锅",
  "location": {
    "lat": 39.9087,
    "lng": 116.3975,
    "address": "北京市朝阳区"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "parsed": {
      "keywords": ["火锅"],
      "cuisineTypes": ["火锅"],
      "priceRange": { "max": 50 },
      "searchRadius": 1000
    }
  }
}
```

**降级策略**:
- OpenAI API 失败时自动使用简单关键词提取
- 超时时间: 15 秒

---

### 2. 搜索餐厅

**端点**: `POST /api/search`

**功能**: 根据关键词和位置搜索周边餐厅。

**请求体**:
```json
{
  "keywords": ["火锅", "川菜"],
  "location": {
    "lat": 39.9087,
    "lng": 116.3975
  },
  "distance": 2000,
  "cuisineTypes": ["川菜", "火锅"],
  "priceRange": {
    "min": 30,
    "max": 80
  },
  "count": 8
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "restaurants": [
      {
        "id": "amap_B001D2W6GV",
        "name": "海底捞火锅",
        "cuisineType": "火锅",
        "rating": 4.5,
        "distance": 856,
        "address": "朝阳区三里屯路11号",
        "phone": "010-12345678",
        "openingHours": "10:00-22:00",
        "averagePrice": 120,
        "location": {
          "lat": 39.9087,
          "lng": 116.3975
        },
        "source": "amap"
      }
    ],
    "source": "amap"
  }
}
```

**特性**:
- 优先使用高德地图 API
- 失败时自动降级到 OpenStreetMap
- 自动去重、过滤、排序
- 按距离由近到远返回

**参数说明**:
- `keywords`: 搜索关键词数组（必需）
- `location`: 搜索中心点（必需）
- `distance`: 搜索半径（米），默认 2000
- `cuisineTypes`: 菜系过滤（可选）
- `priceRange`: 价格区间（可选）
- `count`: 返回数量，默认 8，最多 50

---

### 3. 地理编码（地址 -> 坐标）

**端点**: `POST /api/geocode`

**功能**: 将地址转换为经纬度坐标。

**请求体**:
```json
{
  "address": "北京市朝阳区三里屯路11号",
  "city": "北京"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "location": {
      "lat": 39.9087,
      "lng": 116.3975,
      "address": "北京市朝阳区三里屯路11号"
    }
  }
}
```

---

### 4. 逆向地理编码（坐标 -> 地址）

**端点**: `POST /api/geocode/reverse`

**功能**: 将经纬度坐标转换为地址。

**请求体**:
```json
{
  "location": {
    "lat": 39.9087,
    "lng": 116.3975
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "address": "北京市朝阳区三里屯路11号",
    "formattedAddress": "北京市朝阳区三里屯路11号",
    "province": "北京市",
    "city": "北京市",
    "district": "朝阳区"
  }
}
```

## 错误处理

所有 API 返回统一的错误格式：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "错误描述",
    "details": {}
  }
}
```

### 错误码

| 错误码 | 说明 | HTTP 状态码 |
|--------|------|-------------|
| `VALIDATION_ERROR` | 参数验证失败 | 400 |
| `MISSING_API_KEY` | API Key 未配置 | 503 |
| `TIMEOUT` | 请求超时 | 504 |
| `LLM_API_ERROR` | LLM API 调用失败 | 500 |
| `LLM_PARSE_ERROR` | LLM 解析失败 | 500 |
| `SEARCH_NO_RESULTS` | 搜索无结果 | 200 (返回空数组) |
| `SEARCH_API_ERROR` | 搜索 API 失败 | 500 |
| `GEOCODE_ERROR` | 地理编码失败 | 500 |
| `GEOCODE_NO_RESULTS` | 地理编码无结果 | 404 |
| `INTERNAL_ERROR` | 内部错误 | 500 |

## 项目结构

```
chisha/
├── app/
│   └── api/
│       ├── understand/
│       │   └── route.ts          # LLM 理解 API
│       ├── search/
│       │   └── route.ts          # 餐厅搜索 API
│       └── geocode/
│           ├── route.ts          # 地理编码 API
│           └── reverse/
│               └── route.ts      # 逆向地理编码 API
├── lib/
│   ├── apiResponse.ts           # 统一响应格式
│   ├── validation.ts            # Zod 验证 Schemas
│   ├── logger.ts                # 日志工具
│   ├── withTimeout.ts           # 超时中间件
│   ├── llm.ts                   # OpenAI API 封装
│   ├── amap.ts                  # 高德地图 API 封装
│   ├── osm.ts                   # OpenStreetMap API 封装
│   ├── distance.ts              # 距离计算工具
│   └── dataTransform.ts         # 数据转换和合并
├── types/
│   └── index.ts                 # TypeScript 类型定义
├── .env.example                 # 环境变量模板
├── .gitignore
├── package.json
├── tsconfig.json
└── next.config.js
```

## 技术亮点

### 1. 完整的 TypeScript 类型系统
- 无 `any` 类型
- 所有接口都有完整的类型定义
- 使用 Zod 进行运行时验证

### 2. 多层降级策略
- LLM 失败 → 简单关键词提取
- 高德地图失败 → OpenStreetMap
- 所有 API 调用都有超时保护

### 3. 统一的错误处理
- 统一的响应格式
- 详细的错误码和状态码
- JSON 格式的结构化日志

### 4. 数据质量保证
- 自动去重（基于名称和位置）
- 智能合并多源数据
- 按距离排序

### 5. 可配置的日志系统
- 支持 `LOG_LEVEL` 环境变量
- JSON 格式便于日志收集
- 分级输出（debug/info/warn/error）

## 测试示例

### 使用 curl 测试

```bash
# 1. 理解用户需求
curl -X POST http://localhost:3000/api/understand \
  -H "Content-Type: application/json" \
  -d '{
    "query": "我想吃附近便宜的火锅",
    "location": {
      "lat": 39.9087,
      "lng": 116.3975
    }
  }'

# 2. 搜索餐厅
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{
    "keywords": ["火锅"],
    "location": {
      "lat": 39.9087,
      "lng": 116.3975
    },
    "distance": 2000
  }'

# 3. 地理编码
curl -X POST http://localhost:3000/api/geocode \
  -H "Content-Type: application/json" \
  -d '{
    "address": "北京市朝阳区三里屯路11号",
    "city": "北京"
  }'

# 4. 逆向地理编码
curl -X POST http://localhost:3000/api/geocode/reverse \
  -H "Content-Type: application/json" \
  -d '{
    "location": {
      "lat": 39.9087,
      "lng": 116.3975
    }
  }'
```

## 下一步：Phase 3

Phase 3 将实现前端界面：

1. 用户输入界面
2. 餐厅转盘动画
3. 结果展示
4. 交互逻辑

## 许可证

MIT
