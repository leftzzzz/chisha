# 部署指南

## 概述

本文档介绍"今天吃啥"项目的部署流程，包括环境准备、构建、部署和监控。

## 前置条件

### 系统要求
- Node.js >= 18.0.0
- npm >= 9.0.0
- Git

### 外部服务
- **高德地图 API**
  - Web 服务 API Key
  - LLM API Key
- **（可选）监控服务**
  - Sentry
  - Google Analytics

## 环境变量配置

### 创建环境变量文件

#### 开发环境 (`.env.local`)
```env
# 高德地图 API
AMAP_KEY=your_amap_web_service_key
AMAP_LLM_KEY=your_amap_llm_key

# OpenStreetMap（备用）
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org

# Node 环境
NODE_ENV=development

# 可选：监控服务
NEXT_PUBLIC_SENTRY_DSN=
NEXT_PUBLIC_GA_ID=
```

#### 生产环境 (`.env.production`)
```env
# 高德地图 API
AMAP_KEY=your_production_amap_key
AMAP_LLM_KEY=your_production_llm_key

# OpenStreetMap（备用）
NOMINATIM_BASE_URL=https://nominatim.openstreetmap.org

# Node 环境
NODE_ENV=production

# 监控服务
NEXT_PUBLIC_SENTRY_DSN=your_sentry_dsn
NEXT_PUBLIC_GA_ID=your_ga_id

# 可选：性能监控
MONITORING_ENDPOINT=https://your-api.com/monitoring
MONITORING_SAMPLE_RATE=0.1
```

### 环境变量说明

| 变量名 | 必需 | 说明 |
|--------|------|------|
| AMAP_KEY | ✅ | 高德地图 Web 服务 API Key |
| AMAP_LLM_KEY | ✅ | 高德 LLM API Key |
| NOMINATIM_BASE_URL | ⚠️ | OpenStreetMap 备用端点 |
| NODE_ENV | ✅ | 环境：development/production |
| NEXT_PUBLIC_SENTRY_DSN | ❌ | Sentry 错误追踪 |
| NEXT_PUBLIC_GA_ID | ❌ | Google Analytics ID |
| MONITORING_ENDPOINT | ❌ | 自定义监控端点 |

## 部署前检查清单

### 1. 代码质量检查

```bash
# TypeScript 类型检查
npm run type-check

# ESLint 代码检查
npm run lint

# 运行测试
npm test

# 生成测试覆盖率
npm run test:coverage
```

**要求**：
- ✅ 无 TypeScript 错误
- ✅ 无 ESLint 错误或警告
- ✅ 所有测试通过
- ⏳ 测试覆盖率 ≥ 70% （目标）

### 2. 功能测试

#### 核心功能
- [ ] 用户输入需求
- [ ] LLM 理解功能
- [ ] 餐厅搜索功能
- [ ] 转盘动画
- [ ] 选择结果展示
- [ ] 历史记录保存
- [ ] 历史记录查看
- [ ] 搜索和过滤
- [ ] 导入导出

#### 响应式测试
- [ ] Mobile (< 768px)
- [ ] Tablet (768px - 1024px)
- [ ] Desktop (> 1024px)
- [ ] 横竖屏切换

#### 浏览器兼容性
- [ ] Chrome (最新)
- [ ] Firefox (最新)
- [ ] Safari (最新)
- [ ] Edge (最新)
- [ ] Mobile Safari
- [ ] Mobile Chrome

### 3. 性能测试

```bash
# 构建生产版本
npm run build

# 分析 bundle 大小（可选）
npm install -D @next/bundle-analyzer
```

**要求**：
- ⏳ Lighthouse 分数 > 90
- ⏳ 首屏加载 < 2s
- ⏳ LCP < 2.5s
- ⏳ FID < 100ms
- ⏳ CLS < 0.1

### 4. 安全检查

- [ ] API Keys 不在前端代码中暴露
- [ ] 环境变量正确配置
- [ ] 输入验证完整
- [ ] XSS 防护
- [ ] CSRF 防护（如有表单提交）
- [ ] 依赖包安全审计

```bash
# 审计依赖包
npm audit

# 修复可修复的漏洞
npm audit fix
```

## 本地构建测试

### 1. 安装依赖

```bash
cd j:\project\chisha
npm install
```

### 2. 构建生产版本

```bash
npm run build
```

预期输出：
```
Route (app)                              Size     First Load JS
┌ ○ /                                    5.2 kB         95.1 kB
├ ○ /_not-found                          871 B          85.8 kB
└ ○ /history                             3.8 kB         93.7 kB
+ First Load JS shared by all            84.9 kB
  ├ chunks/framework-xxx.js              45.2 kB
  ├ chunks/main-app-xxx.js              32.1 kB
  └ other shared chunks (total)          7.6 kB
```

### 3. 本地运行生产版本

```bash
npm start
```

访问：http://localhost:3000

### 4. 测试功能

在生产模式下测试所有核心功能。

## 部署到 Vercel（推荐）

### 1. 准备工作

- 注册 [Vercel](https://vercel.com) 账号
- 安装 Vercel CLI（可选）

```bash
npm install -g vercel
```

### 2. 通过 GitHub 部署（推荐）

#### 步骤：

1. **推送代码到 GitHub**

```bash
git add .
git commit -m "Ready for deployment"
git push origin main
```

2. **连接 Vercel**
   - 登录 Vercel
   - 点击 "New Project"
   - 导入 GitHub 仓库
   - 选择项目

3. **配置环境变量**
   - 在 Vercel 项目设置中
   - 添加所有环境变量
   - 区分 Production 和 Preview 环境

4. **部署**
   - Vercel 自动检测 Next.js
   - 自动构建和部署
   - 每次推送自动部署

### 3. 通过 CLI 部署

```bash
# 登录
vercel login

# 首次部署
vercel

# 部署到生产环境
vercel --prod
```

### 4. 配置自定义域名

在 Vercel 项目设置中：
- Domains → Add Domain
- 按照提示配置 DNS
- 自动配置 HTTPS

## 部署到其他平台

### Netlify

1. **安装 Netlify CLI**
```bash
npm install -g netlify-cli
```

2. **构建**
```bash
npm run build
```

3. **部署**
```bash
netlify deploy --prod
```

### 自托管（VPS/服务器）

#### 1. 服务器准备

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装 Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# 安装 PM2
sudo npm install -g pm2
```

#### 2. 部署代码

```bash
# 克隆项目
git clone your-repo-url /var/www/chisha
cd /var/www/chisha

# 安装依赖
npm install

# 构建
npm run build
```

#### 3. 配置 PM2

创建 `ecosystem.config.js`：

```javascript
module.exports = {
  apps: [{
    name: 'chisha',
    script: 'npm',
    args: 'start',
    cwd: '/var/www/chisha',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
  }],
};
```

启动应用：

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```

#### 4. 配置 Nginx

创建 Nginx 配置：

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

启用配置：

```bash
sudo ln -s /etc/nginx/sites-available/chisha /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 5. 配置 HTTPS（Let's Encrypt）

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 部署后验证

### 1. 功能测试

访问生产环境，测试：
- [ ] 首页加载
- [ ] 搜索功能
- [ ] 转盘动画
- [ ] 历史记录
- [ ] 导入导出
- [ ] 移动端适配

### 2. 性能测试

使用 [Lighthouse](https://developers.google.com/web/tools/lighthouse)：

```bash
# Chrome DevTools
F12 → Lighthouse → Generate Report

# CLI
npm install -g lighthouse
lighthouse https://your-domain.com
```

目标分数：
- Performance: > 90
- Accessibility: > 90
- Best Practices: > 90
- SEO: > 90

### 3. 错误监控

检查监控面板：
- Sentry 错误报告
- Google Analytics 访问统计
- 自定义监控端点

## 持续部署（CI/CD）

### GitHub Actions 示例

创建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to Production

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run lint
      - run: npm run type-check
      - run: npm test

  deploy:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: vercel/vercel-action@v1
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
```

## 监控和维护

### 1. 错误监控

使用 Sentry：

```typescript
// lib/sentry.ts
import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
});
```

### 2. 性能监控

使用内置监控系统：

```typescript
import monitoring from '@/lib/monitoring';

// 配置端点
monitoring.configure({
  endpoint: process.env.MONITORING_ENDPOINT,
  sampleRate: parseFloat(process.env.MONITORING_SAMPLE_RATE || '0.1'),
});
```

### 3. 日志管理

建议使用：
- Vercel Logs（如使用 Vercel）
- CloudWatch（如使用 AWS）
- 自建 ELK Stack

### 4. 备份策略

- localStorage 数据：用户自行导出
- 环境变量：安全存储
- 代码：Git 版本控制

## 回滚策略

### Vercel 回滚

1. 登录 Vercel Dashboard
2. 选择项目
3. Deployments → 选择之前的版本
4. Promote to Production

### PM2 回滚

```bash
# 更新代码
git pull origin main

# 重新构建
npm run build

# 重启应用
pm2 restart chisha
```

## 性能优化建议

### 1. CDN 配置

- 使用 Vercel Edge Network（自动）
- 配置 Cloudflare（可选）

### 2. 图片优化

- 使用 Next.js Image 组件
- 配置图片 CDN
- WebP 格式

### 3. 缓存策略

```javascript
// next.config.js
module.exports = {
  async headers() {
    return [
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, s-maxage=60, stale-while-revalidate=300',
          },
        ],
      },
    ];
  },
};
```

### 4. 代码分割

- 使用 dynamic import
- 路由级分割（自动）
- 按需加载组件

## 故障排查

### 常见问题

#### 1. 构建失败

```bash
# 清除缓存
rm -rf .next node_modules
npm install
npm run build
```

#### 2. 环境变量未生效

- 检查变量名是否正确
- 前端变量必须以 `NEXT_PUBLIC_` 开头
- 重新部署

#### 3. 性能问题

- 检查 bundle 大小
- 使用 Lighthouse 诊断
- 启用性能监控

#### 4. API 超时

- 增加超时设置
- 检查 API Key 配额
- 添加重试机制

## 更新部署

### 日常更新

```bash
# 1. 更新代码
git pull origin main

# 2. 安装新依赖（如有）
npm install

# 3. 构建
npm run build

# 4. 重启（自托管）
pm2 restart chisha

# Vercel 会自动部署
```

### 大版本更新

1. 在 staging 环境测试
2. 备份数据和配置
3. 查看更新日志
4. 逐步部署
5. 监控错误率

## 安全最佳实践

1. **API Keys**
   - 使用环境变量
   - 定期轮换
   - 限制 IP 访问（如可能）

2. **HTTPS**
   - 强制使用 HTTPS
   - 配置 HSTS

3. **依赖更新**
   - 定期运行 `npm audit`
   - 及时更新依赖

4. **访问控制**
   - 配置 CORS
   - API 限流（见下方「Cloudflare 限流配置」）

## Cloudflare 限流配置

`lib/rateLimit.ts` 优先使用 Cloudflare Workers 原生 Rate Limiting binding，拿不到
binding 时退回进程内存计数。**内存计数在 Workers 上等于没有限流**：每个请求可能
落在不同的隔离实例里，内存不共享。

binding 在 `wrangler.jsonc` 的 `ratelimits` 段声明，四个命名空间对应四个限流域：

| binding | 保护的入口 | 额度 |
|---|---|---|
| `RL_AGENT_CHAT` | `/api/agent/chat` 按 IP | 6 次/分钟 |
| `RL_AGENT_CHAT_ALL` | `/api/agent/chat` 总量闸门 | 60 次/分钟 |
| `RL_AMAP_PROXY` | `/_AMapService` 代理按 IP | 300 次/分钟 |
| `RL_GEOCODE` | `/api/geocode/*` 按 IP | 3 次/分钟 |

额度必须与 `lib/rateLimit.ts` 的 `RATE_LIMITS` 表一致，两边漂移会被
`__tests__/lib/rateLimit.config.test.ts` 判红。Cloudflare 的 `period` 只接受 10 或
60 秒。

限流额度不需要在 Dashboard 里创建任何资源，`namespace_id` 只要在本 worker 内唯一
即可；也不额外收费，只算 Workers 请求与 CPU。

部署后确认 binding 真的生效——配漏了不会报错，只会在日志里留一条：

```
Rate limit binding missing on a serverless runtime; falling back to in-process memory
```

### 部署到 Vercel 或自托管 Node

这套 binding 只在 Cloudflare Workers 上存在，其他平台会退回内存计数。要挂公开
站点需要自己接一个跨实例的方案（Redis/Upstash 等），入口是 `checkRateLimit`。

## Cloudflare D1 会话存储与迁移

Agent 多轮会话需要持久化到 D1，避免 Cloudflare Workers 多实例、冷启动或重新部署后丢失追问状态。

### 首次创建 D1 数据库

每个 Cloudflare 账号/环境只需要创建一次数据库：

```bash
npx wrangler d1 create chisha
```

命令会输出 `database_id`。将它加入 `wrangler.jsonc`：

```jsonc
{
  "d1_databases": [
    {
      "binding": "CHISHA_DB",
      "database_name": "chisha",
      "database_id": "<cloudflare-created-id>"
    }
  ]
}
```

不要手动建表。表结构由 `migrations/` 下的 SQL 迁移管理。

### 本地和远程迁移

本地开发数据库：

```bash
npm run db:migrate:local
```

远程生产数据库：

```bash
npm run db:migrate:remote
```

当前迁移会创建 `agent_sessions` 表，并建立 `expires_at`、`updated_at` 索引。迁移文件使用 `IF NOT EXISTS`，搬环境后重复执行是安全的。

### 自动部署迁移

`npm run deploy` 已配置为先执行远程 D1 迁移，再部署 Worker：

```bash
npm run deploy
```

迁移由 `wrangler.jsonc` 里的 `build.command = "npm run wrangler:build"` 触发。因此部署平台即使直接执行 `npx wrangler deploy` 或 `npx wrangler versions upload`，Wrangler 也会在上传前先运行远程 D1 迁移。`wrangler dev` 不会触发远程迁移。若部署平台已经先执行了 `npm run build:cloudflare`，脚本会复用已有的 `.open-next/worker.js`，避免重复构建；否则会自动执行 OpenNext 构建。

Wrangler 在 CI/CD 或其它非交互命令行中会跳过迁移确认提示；本地终端可能会要求确认。需要紧急跳过迁移时使用：

```bash
npm run deploy:skip-migrations
```

如果使用 Cloudflare Versions 流程，推荐命令是：

```bash
npm run versions:upload
```

直接使用平台的 Version command `npx wrangler versions upload` 也可以，因为会走上面的 Wrangler build hook。

### 搬环境检查清单

- 创建目标环境 D1 数据库：`npx wrangler d1 create chisha`
- 将新的 `database_id` 写入 `wrangler.jsonc`
- 配置环境变量：`OPENAI_API_KEY`、`AMAP_API_KEY`
- 执行：`npm run deploy`
- 确认迁移已应用：`npx wrangler d1 migrations list chisha --remote`

### 确认线上正在使用 D1 会话存储

部署后触发一次会产生 Agent 追问的搜索，再查询远程表：

```bash
npx wrangler d1 execute chisha --remote --command "SELECT COUNT(*) AS count FROM agent_sessions;"
```

如果 `count` 增加，说明线上请求已经通过 `CHISHA_DB` binding 写入 D1。也可以查看最近写入时间：

```bash
npx wrangler d1 execute chisha --remote --command "SELECT id, updated_at, expires_at FROM agent_sessions ORDER BY updated_at DESC LIMIT 5;"
```

生产代码从 Cloudflare/OpenNext runtime 读取 `CHISHA_DB` binding；如果 binding 缺失，会回退到内存 session store，适合本地 Next.js/Jest，但不适合生产。

## 成本估算

### Vercel（推荐）
- Hobby（免费）：适合个人项目
- Pro（$20/月）：适合小型商业项目

### 自托管
- VPS（$5-20/月）：Linode, DigitalOcean
- 域名（$10-15/年）
- CDN（可选，$5-50/月）

### 外部服务
- 高德地图 API：按使用量计费
- Sentry：有免费额度
- Google Analytics：免费

## 联系支持

遇到问题？
- 查看项目文档：`docs/` 目录
- GitHub Issues
- 项目维护者邮箱

## 总结

部署检查清单：
- [x] 环境变量配置
- [x] 代码质量检查
- [ ] 功能测试通过
- [ ] 性能测试达标
- [ ] 安全检查完成
- [ ] 监控配置完成
- [ ] 备份策略确定
- [ ] 文档更新

**祝部署顺利！** 🚀
