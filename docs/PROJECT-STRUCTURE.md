# 项目结构

```
chisha/
├── 📁 app/                          # Next.js App Router
│   └── 📁 api/                      # API 路由
│       ├── 📁 understand/           # LLM 理解 API
│       │   └── 📄 route.ts          # POST /api/understand
│       ├── 📁 search/               # 餐厅搜索 API
│       │   └── 📄 route.ts          # POST /api/search
│       └── 📁 geocode/              # 地理编码 API
│           ├── 📄 route.ts          # POST /api/geocode
│           └── 📁 reverse/          # 逆向地理编码
│               └── 📄 route.ts      # POST /api/geocode/reverse
│
├── 📁 lib/                          # 工具库
│   ├── 📄 validation.ts            # Zod 验证 Schemas
│   ├── 📄 apiResponse.ts           # 统一 API 响应格式
│   ├── 📄 logger.ts                # 日志工具
│   ├── 📄 withTimeout.ts           # 超时中间件
│   ├── 📄 llm.ts                   # OpenAI API 封装
│   ├── 📄 amap.ts                  # 高德地图 API 封装
│   ├── 📄 osm.ts                   # OpenStreetMap API 封装
│   ├── 📄 distance.ts              # 距离计算工具
│   └── 📄 dataTransform.ts         # 数据转换和合并
│
├── 📁 types/                        # TypeScript 类型定义
│   └── 📄 index.ts                 # 核心类型和接口
│
├── 📁 scripts/                      # 工具脚本
│   ├── 📄 test-api.js              # API 测试脚本
│   └── 📄 check-setup.js           # 完整性检查脚本
│
├── 📁 docs/                         # 文档
│   ├── 📄 Phase2-API-Documentation.md        # API 详细文档
│   ├── 📄 Phase2-Technical-Summary.md        # 技术实现总结
│   ├── 📄 Phase2-Files-Checklist.md          # 文件清单
│   ├── 📄 Phase2-Completion-Report.md        # 完成报告
│   ├── 📄 QUICKSTART.md                      # 快速启动指南
│   ├── 📄 实现方案.md                         # 实现方案
│   ├── 📄 执行计划.md                         # 执行计划
│   └── 📁 立项文档/                           # 初始规划文档
│       ├── 📄 PRD.md                         # 产品需求文档
│       ├── 📄 技术架构设计.md                 # 架构设计
│       ├── 📄 API接口设计.md                 # API 设计
│       ├── 📄 前端工程架构.md                 # 前端架构
│       ├── 📄 后端实现指南.md                 # 后端指南
│       ├── 📄 PCDesign.md                    # PC 设计
│       └── 📄 MobileDesign.md                # 移动端设计
│
├── 📄 package.json                 # NPM 配置和依赖
├── 📄 tsconfig.json                # TypeScript 配置
├── 📄 next.config.js               # Next.js 配置
├── 📄 tailwind.config.ts           # Tailwind CSS 配置
├── 📄 postcss.config.js            # PostCSS 配置
├── 📄 .eslintrc.json               # ESLint 配置
├── 📄 .env.example                 # 环境变量模板
├── 📄 .gitignore                   # Git 忽略配置
└── 📄 README.md                    # 项目主文档
```

## 文件说明

### API 路由 (4 个)

| 文件 | 端点 | 功能 |
|------|------|------|
| `app/api/understand/route.ts` | POST /api/understand | 使用 LLM 理解用户需求 |
| `app/api/search/route.ts` | POST /api/search | 搜索周边餐厅 |
| `app/api/geocode/route.ts` | POST /api/geocode | 地址转坐标 |
| `app/api/geocode/reverse/route.ts` | POST /api/geocode/reverse | 坐标转地址 |

### 工具库 (9 个)

| 文件 | 功能 | 主要导出 |
|------|------|---------|
| `lib/validation.ts` | 参数验证 | Zod Schemas |
| `lib/apiResponse.ts` | 响应格式 | success(), error() |
| `lib/logger.ts` | 日志 | logger.info() 等 |
| `lib/withTimeout.ts` | 超时控制 | withTimeout(), fetchWithTimeout() |
| `lib/llm.ts` | LLM 调用 | callOpenAI(), fallbackParse() |
| `lib/amap.ts` | 高德地图 | amapPoiSearch(), amapGeocode() |
| `lib/osm.ts` | OSM | osmSearch() |
| `lib/distance.ts` | 距离计算 | haversineDistance() |
| `lib/dataTransform.ts` | 数据处理 | combineAndFilterRestaurants() |

### 类型定义 (1 个)

| 文件 | 内容 |
|------|------|
| `types/index.ts` | Location, Restaurant, ParsedRequirement, API 请求/响应类型, AppState 等 |

### 配置文件 (6 个)

| 文件 | 说明 |
|------|------|
| `package.json` | NPM 配置、依赖、脚本 |
| `tsconfig.json` | TypeScript 编译配置 |
| `next.config.js` | Next.js 框架配置 |
| `tailwind.config.ts` | Tailwind CSS 配置 |
| `.eslintrc.json` | ESLint 代码检查配置 |
| `.env.example` | 环境变量模板 |

### 文档 (12 个)

| 文件 | 内容 |
|------|------|
| `README.md` | 项目概述、快速开始 |
| `docs/Phase2-API-Documentation.md` | API 详细文档 |
| `docs/Phase2-Technical-Summary.md` | 技术实现总结 |
| `docs/Phase2-Files-Checklist.md` | 文件清单 |
| `docs/Phase2-Completion-Report.md` | 完成报告 |
| `docs/QUICKSTART.md` | 快速启动指南 |
| `docs/实现方案.md` | 实现方案 |
| `docs/执行计划.md` | 执行计划 |
| `docs/立项文档/PRD.md` | 产品需求文档 |
| `docs/立项文档/技术架构设计.md` | 架构设计 |
| `docs/立项文档/API接口设计.md` | API 设计 |
| 等... | 其他立项文档 |

### 工具脚本 (2 个)

| 文件 | 命令 | 功能 |
|------|------|------|
| `scripts/test-api.js` | npm run test:api | 测试所有 API 端点 |
| `scripts/check-setup.js` | npm run check | 检查项目完整性 |

## 依赖关系

### API 路由依赖

```
app/api/**/route.ts
  ├─ lib/validation.ts (参数验证)
  ├─ lib/apiResponse.ts (响应格式)
  ├─ lib/logger.ts (日志)
  └─ 业务逻辑库
      ├─ lib/llm.ts
      ├─ lib/amap.ts
      ├─ lib/osm.ts
      └─ lib/dataTransform.ts
```

### 工具库依赖

```
lib/llm.ts
  ├─ lib/withTimeout.ts
  ├─ lib/logger.ts
  └─ lib/apiResponse.ts

lib/amap.ts
  ├─ lib/withTimeout.ts
  ├─ lib/logger.ts
  └─ lib/apiResponse.ts

lib/osm.ts
  ├─ lib/withTimeout.ts
  ├─ lib/logger.ts
  ├─ lib/distance.ts
  └─ lib/apiResponse.ts

lib/dataTransform.ts
  └─ lib/logger.ts
```

### 类型依赖

```
types/index.ts
  └─ 被所有 .ts 文件导入
```

## 代码流转

### 搜索流程

```
用户请求
  ↓
app/api/search/route.ts
  ↓ (验证)
lib/validation.ts
  ↓ (搜索)
lib/amap.ts → lib/osm.ts (降级)
  ↓ (处理)
lib/dataTransform.ts
  ↓ (响应)
lib/apiResponse.ts
  ↓
返回给用户
```

### LLM 理解流程

```
用户请求
  ↓
app/api/understand/route.ts
  ↓ (验证)
lib/validation.ts
  ↓ (理解)
lib/llm.ts
  ├─ callOpenAI() → OpenAI API
  └─ fallbackParse() (降级)
  ↓ (响应)
lib/apiResponse.ts
  ↓
返回给用户
```

## NPM 脚本

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产版本
npm run start        # 启动生产服务器
npm run lint         # 代码检查
npm run type-check   # TypeScript 类型检查
npm run test:api     # 测试 API
npm run check        # 项目完整性检查
```

## 环境变量

必需：
- `OPENAI_API_KEY` - OpenAI API 密钥
- `AMAP_API_KEY` - 高德地图 API 密钥

可选：
- `OPENAI_BASE_URL` - OpenAI API 基础 URL
- `AMAP_SECURITY_CODE` - 高德地图安全码
- `NEXT_PUBLIC_APP_URL` - 应用 URL
- `LOG_LEVEL` - 日志级别 (debug/info/warn/error)

## 文件统计

| 类型 | 数量 |
|------|------|
| TypeScript 文件 | 14 |
| 配置文件 | 6 |
| 文档文件 | 12+ |
| 脚本文件 | 2 |
| **总计** | **34+** |

## 代码行数

| 模块 | 行数 (估算) |
|------|------------|
| API 路由 | ~400 |
| 工具库 | ~1200 |
| 类型定义 | ~150 |
| 配置文件 | ~100 |
| 脚本 | ~400 |
| **总计** | **~2250** |
