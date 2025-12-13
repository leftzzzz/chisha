# 今天吃啥 (What to Eat Today)

> 一个帮助解决"今天吃什么"难题的智能 Web 应用，通过有趣的转盘抽选方式为您推荐附近的餐厅。

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-14.2-black.svg)](https://nextjs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 特性一览

- **智能理解** - 使用 AI 理解您的自然语言需求（如"想吃便宜的川菜"）
- **精准搜索** - 整合高德地图和 OpenStreetMap 的餐厅数据
- **趣味转盘** - 通过转盘抽选的方式增加选择的乐趣
- **历史记录** - 自动保存您的选择历史，方便回顾
- **响应式设计** - 完美支持手机、平板和桌面设备
- **智能降级** - API 失败时自动降级，保证基本功能可用

## 快速开始

### 前置要求

- Node.js 18.0 或更高版本
- npm 或 yarn 包管理器
- OpenAI API 密钥
- 高德地图 API 密钥

### 安装步骤

1. **克隆项目**

```bash
git clone <repository-url>
cd chisha
```

2. **安装依赖**

```bash
npm install
```

3. **配置环境变量**

复制 `.env.example` 到 `.env.local` 并填写必需的 API keys：

```bash
cp .env.example .env.local
```

编辑 `.env.local`：

```env
# OpenAI API Configuration
OPENAI_API_KEY=sk-your-openai-key-here
OPENAI_BASE_URL=https://api.openai.com/v1

# Amap (高德地图) API Configuration
AMAP_API_KEY=your-amap-key-here
AMAP_SECURITY_CODE=your-security-code-here  # 可选

# Application Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
LOG_LEVEL=info
```

4. **启动开发服务器**

```bash
npm run dev
```

访问 http://localhost:3000 开始使用！

### 获取 API 密钥

#### OpenAI API Key

1. 访问 [OpenAI Platform](https://platform.openai.com/)
2. 注册/登录账号
3. 进入 API Keys 页面创建新密钥

#### 高德地图 API Key

1. 访问 [高德开放平台](https://lbs.amap.com/)
2. 注册/登录账号
3. 创建应用并获取 Web 服务 API Key

## 技术栈

### 核心框架

- **[Next.js 14](https://nextjs.org/)** - React 全栈框架（App Router）
- **[React 18](https://react.dev/)** - UI 库
- **[TypeScript 5.6](https://www.typescriptlang.org/)** - 类型安全

### UI 与样式

- **[Tailwind CSS 3.4](https://tailwindcss.com/)** - 原子化 CSS 框架
- CSS Animations - 转盘动画和过渡效果

### 数据与验证

- **[Zod](https://zod.dev/)** - 运行时类型验证

### 外部服务

- **[OpenAI GPT-4](https://openai.com/)** - 自然语言理解
- **[高德地图 API](https://lbs.amap.com/)** - 中国地区 POI 搜索
- **[OpenStreetMap](https://www.openstreetmap.org/)** - 全球地图数据（降级方案）

### 开发工具

- **[ESLint](https://eslint.org/)** - 代码检查
- **[Jest](https://jestjs.io/)** - 单元测试
- **[Testing Library](https://testing-library.com/)** - React 组件测试

## 项目结构

```
chisha/
├── app/                      # Next.js App Router
│   ├── api/                 # API 路由
│   │   ├── understand/      # LLM 需求理解
│   │   ├── search/          # 餐厅搜索
│   │   └── geocode/         # 地理编码
│   ├── history/             # 历史记录页面
│   ├── layout.tsx           # 根布局
│   └── page.tsx             # 首页
│
├── components/              # React 组件
│   ├── ui/                  # 基础 UI 组件
│   │   ├── Button.tsx
│   │   ├── Input.tsx
│   │   ├── Modal.tsx
│   │   └── ...
│   ├── input/               # 输入相关组件
│   │   ├── SearchInput.tsx
│   │   ├── LocationPicker.tsx
│   │   └── SearchPanel.tsx
│   ├── turntable/           # 转盘组件
│   │   ├── Turntable.tsx
│   │   ├── TurntableSegment.tsx
│   │   └── TurntableControls.tsx
│   ├── restaurant/          # 餐厅相关组件
│   │   ├── RestaurantCard.tsx
│   │   └── ResultPanel.tsx
│   ├── map/                 # 地图组件
│   │   └── Map.tsx
│   └── layout/              # 布局组件
│       ├── Header.tsx
│       ├── MobileLayout.tsx
│       └── DesktopLayout.tsx
│
├── context/                 # React Context
│   ├── AppContext.tsx       # 应用状态 Context
│   ├── AppReducer.ts        # 状态管理 Reducer
│   └── index.ts
│
├── hooks/                   # 自定义 Hooks
│   ├── useAppState.ts       # 应用状态管理
│   ├── useLocation.ts       # 位置服务
│   ├── useRestaurantSearch.ts  # 餐厅搜索
│   ├── useTurntable.ts      # 转盘逻辑
│   ├── useMediaQuery.ts     # 响应式检测
│   └── index.ts
│
├── lib/                     # 工具库
│   ├── api.ts               # API 调用封装
│   ├── llm.ts               # OpenAI 封装
│   ├── amap.ts              # 高德地图封装
│   ├── osm.ts               # OpenStreetMap 封装
│   ├── distance.ts          # 距离计算
│   ├── dataTransform.ts     # 数据转换
│   ├── storage.ts           # LocalStorage 封装
│   ├── validation.ts        # Zod 验证 schemas
│   ├── apiResponse.ts       # 统一响应格式
│   ├── logger.ts            # 日志工具
│   ├── monitoring.ts        # 性能监控
│   └── withTimeout.ts       # 超时中间件
│
├── types/                   # TypeScript 类型定义
│   └── index.ts
│
├── styles/                  # 全局样式
│   └── globals.css
│
├── __tests__/               # 测试文件
│   ├── lib/
│   ├── hooks/
│   └── components/
│
├── scripts/                 # 工具脚本
│   ├── setup.sh             # 一键安装脚本
│   ├── check-setup.js       # 环境检查
│   └── test-api.js          # API 测试
│
├── docs/                    # 文档
│   ├── DEPLOYMENT.md        # 部署指南
│   ├── API.md               # API 文档
│   ├── DEVELOPER-GUIDE.md   # 开发者指南
│   ├── FAQ.md               # 常见问题
│   └── ...
│
├── .env.example             # 环境变量示例
├── .gitignore               # Git 忽略文件
├── package.json             # 项目配置
├── tsconfig.json            # TypeScript 配置
├── tailwind.config.ts       # Tailwind 配置
├── next.config.js           # Next.js 配置
└── README.md                # 项目说明（本文件）
```

## 核心功能

### 1. 智能需求理解

使用 OpenAI GPT-4 理解用户的自然语言输入，自动提取：
- 关键词（菜系、类型等）
- 价格范围
- 距离限制
- 其他偏好

**降级策略**：如果 AI 调用失败，自动使用简单的关键词提取。

### 2. 餐厅搜索

- **高德地图 POI 搜索**：优先使用，覆盖中国地区
- **OpenStreetMap 搜索**：降级方案，覆盖全球
- **智能排序**：根据距离、评分等综合排序
- **自动去重**：合并来自不同数据源的重复餐厅

### 3. 转盘抽选

- 根据搜索结果动态生成转盘
- 平滑的旋转动画（3-5 秒）
- 公平的随机选择算法
- 支持重新抽选

### 4. 历史记录

- 自动保存每次选择
- 支持查看、删除、清空
- 最多保存 100 条记录
- 使用 LocalStorage 存储

### 5. 响应式设计

- **移动端**（< 768px）：单列布局，触摸优化
- **平板**（768-1024px）：优化布局
- **桌面**（> 1024px）：多列布局，更多信息展示

## API 端点

### POST /api/understand

理解用户自然语言需求

**请求体**：
```json
{
  "query": "附近便宜的川菜",
  "location": {
    "lat": 39.9,
    "lng": 116.4,
    "address": "北京市朝阳区"
  }
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "keywords": ["川菜", "便宜"],
    "cuisine": "川菜",
    "priceRange": "low",
    "radius": 2000
  }
}
```

### POST /api/search

搜索餐厅

**请求体**：
```json
{
  "keywords": ["川菜"],
  "location": {
    "lat": 39.9,
    "lng": 116.4
  },
  "radius": 2000,
  "limit": 20
}
```

**响应**：
```json
{
  "success": true,
  "data": {
    "restaurants": [
      {
        "id": "...",
        "name": "川菜馆",
        "address": "...",
        "location": { "lat": 39.9, "lng": 116.4 },
        "distance": 500,
        "rating": 4.5,
        "source": "amap"
      }
    ],
    "total": 15,
    "source": "amap"
  }
}
```

### POST /api/geocode

地址转坐标

**请求体**：
```json
{
  "address": "北京市朝阳区",
  "city": "北京"
}
```

### POST /api/geocode/reverse

坐标转地址

**请求体**：
```json
{
  "lat": 39.9,
  "lng": 116.4
}
```

详细的 API 文档请查看 [docs/API.md](./docs/API.md)

## 开发指南

### 本地开发

```bash
# 启动开发服务器
npm run dev

# 类型检查
npm run type-check

# 代码检查
npm run lint

# 运行测试
npm test

# 测试覆盖率
npm run test:coverage

# 构建生产版本
npm run build

# 启动生产服务器
npm start
```

### 代码规范

- 使用 TypeScript strict mode
- 禁止使用 `any` 类型
- 所有函数都有清晰的注释
- 完整的错误处理
- 遵循 ESLint 规则

### 测试

```bash
# 运行所有测试
npm test

# 监听模式
npm run test:watch

# 覆盖率报告
npm run test:coverage

# API 测试
npm run test:api
```

### 日志级别

通过 `LOG_LEVEL` 环境变量控制：

- `debug`: 详细调试信息
- `info`: 一般信息（默认）
- `warn`: 警告
- `error`: 错误

## 部署

### Vercel 部署（推荐）

1. 在 [Vercel](https://vercel.com/) 创建账号
2. 连接 GitHub 仓库
3. 配置环境变量：
   - `OPENAI_API_KEY`
   - `AMAP_API_KEY`
   - `AMAP_SECURITY_CODE`（可选）
   - `LOG_LEVEL=info`
4. 点击部署

详细部署指南请查看 [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)

### 其他平台

项目是标准的 Next.js 应用，可以部署到任何支持 Node.js 的平台：

- Netlify
- Railway
- Render
- 自托管服务器

## 环境变量

| 变量 | 必需 | 说明 | 默认值 |
|------|------|------|--------|
| `OPENAI_API_KEY` | 是 | OpenAI API 密钥 | - |
| `OPENAI_BASE_URL` | 否 | OpenAI API 基础 URL | https://api.openai.com/v1 |
| `AMAP_API_KEY` | 是 | 高德地图 API 密钥 | - |
| `AMAP_SECURITY_CODE` | 否 | 高德地图安全码 | - |
| `NEXT_PUBLIC_APP_URL` | 否 | 应用 URL | http://localhost:3000 |
| `LOG_LEVEL` | 否 | 日志级别 | info |

## 性能指标

- **首屏加载时间**: < 2s
- **Lighthouse 性能分数**: ≥ 90
- **LLM API 响应**: < 15s
- **地图搜索**: < 10s
- **转盘动画**: 60fps 无卡顿

## 浏览器兼容性

- Chrome (最新版本)
- Firefox (最新版本)
- Safari 15+
- Edge (最新版本)
- 移动 Safari (iOS 14+)
- Chrome Mobile (Android)

## 常见问题

### Q: OpenAI API 调用失败怎么办？

A: 系统会自动降级到简单关键词提取，不会影响基本功能。

### Q: 高德地图搜索无结果？

A: 系统会自动降级到 OpenStreetMap，覆盖全球范围。

### Q: 如何查看详细日志？

A: 设置 `LOG_LEVEL=debug` 环境变量。

### Q: 历史记录存储在哪里？

A: 使用浏览器 LocalStorage 本地存储，不会上传到服务器。

### Q: 如何修改搜索半径？

A: 在输入中明确指定（如"2公里内的餐厅"），或修改 `lib/llm.ts` 中的默认值。

更多问题请查看 [docs/FAQ.md](./docs/FAQ.md)

## 贡献

欢迎贡献代码！请查看 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解详细信息。

### 报告问题

在 [GitHub Issues](https://github.com/your-repo/chisha/issues) 提交问题时，请包含：

- 问题描述
- 复现步骤
- 预期行为
- 实际行为
- 环境信息（浏览器、操作系统等）

### 提交 Pull Request

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add some amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 开启 Pull Request

## 更新日志

查看 [CHANGELOG.md](./CHANGELOG.md) 了解版本历史。

## 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](./LICENSE) 文件。

## 致谢

- [Next.js](https://nextjs.org/) - 现代 React 框架
- [OpenAI](https://openai.com/) - 强大的 LLM 服务
- [高德地图](https://lbs.amap.com/) - 地图和 POI 服务
- [OpenStreetMap](https://www.openstreetmap.org/) - 开放地图数据
- [Tailwind CSS](https://tailwindcss.com/) - 优秀的 CSS 框架

## 联系方式

如有问题或建议，请：

- 提交 [GitHub Issue](https://github.com/your-repo/chisha/issues)
- 发送邮件到 your-email@example.com

## 路线图

- [ ] 支持更多地图服务（百度地图、腾讯地图）
- [ ] 添加餐厅收藏功能
- [ ] 支持分享选择结果
- [ ] 添加用户偏好设置
- [ ] 支持多语言界面
- [ ] 移动端 APP 版本

---

**Made with ❤️ by the ChiSha Team**
