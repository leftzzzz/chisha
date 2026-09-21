# Cloudflare 部署指南

ChiSha 当前的公开生产拓扑是 OpenNext + Cloudflare Workers + D1 + Durable Objects。本文只
描述这条受支持路径；应用结构见 [ChiSha 应用架构](./technical/application-architecture.md)，
生产保护边界见 [Public Runtime Protection Spec](./specs/public-runtime-protection.md)。

## 前置条件

- Node.js 22 与 npm；仓库根目录 `.node-version` 是本地、CI 和 Cloudflare Builds 的版本真源
- Cloudflare 账号及 Wrangler 登录
- OpenAI-compatible API Key、base URL 和模型名称
- 高德 Web 服务 API Key
- 高德 Web 端 JS API Key 与安全密钥

```bash
npm install
npx wrangler login
```

完整变量名和默认关系以 [`.env.example`](../.env.example) 为唯一公开真源。

## 1. 本地验证

Next.js 开发模式：

```bash
cp .env.example .env.local
npm run dev
```

在 `.env.local` 中填入自己的 Key，不要提交该文件。需要验证 Cloudflare 本地 D1 和 Worker
时执行：

```bash
npm run db:migrate:local
npm run build:cloudflare
npm run preview
```

## 2. 创建 D1

每个 Cloudflare 账号或隔离环境都要创建自己的数据库：

```bash
npx wrangler d1 create chisha
```

把命令返回的 `database_id` 写入 [`wrangler.jsonc`](../wrangler.jsonc) 的 `CHISHA_DB`
binding。仓库中的 id 属于原维护者账号，fork 无法复用。

表结构只由 `migrations/` 管理：

```bash
npm run db:migrate:remote
npx wrangler d1 migrations list chisha --remote
```

正常首次部署不需要提前单独运行远程 migration，因为 `npm run deploy` 会先迁移再上传。

## 3. 配置 secrets 与变量

至少配置以下 Worker secrets：

```bash
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put OPENAI_BASE_URL
npx wrangler secret put OPENAI_MODEL
npx wrangler secret put AMAP_API_KEY
npx wrangler secret put AMAP_JS_API_KEY
npx wrangler secret put AMAP_SECURITY_CODE
npx wrangler secret put SESSION_OWNER_SECRET
```

`SESSION_OWNER_SECRET` 生产值必须至少 32 个随机字符，例如可在本地生成后直接输入
Wrangler，不要写进 shell history 或仓库文件：

```bash
openssl rand -base64 48
```

高德 Key 分工：

- `AMAP_API_KEY` 是服务端 Web 服务 Key，不能暴露给浏览器。
- `AMAP_JS_API_KEY` 是生产 Worker 向 `/api/map/config` 提供的 Web 端 JS Key；它会出现在
  浏览器中，必须在高德控制台配置域名白名单。
- `AMAP_SECURITY_CODE` 只由服务端受限地图代理使用。

Provider 上限、缓存 TTL、模型角色覆盖等非敏感变量按 `.env.example` 配置到 Cloudflare
Workers Variables。`wrangler.jsonc` 使用 `keep_vars: true`，部署不会删除 Dashboard 已有
变量；仍应在发布记录中保存采用的非敏感值。

上线前必须从供应商控制台核验并记录：

- 当前高德账号/服务/Key 的最小 QPS，再据此设置 `AMAP_SAFE_QPS`；
- 当前实际模型的 RPM/TPM；未知时保持对应速率为 0，并使用严格在途上限；
- 月调用量、QPS、RPM/TPM 是不同维度，不能互相推断。

## 4. 校验构建

提交或发布前运行：

```bash
npm run docs:check
npm run test:docs
npm run type-check
npm run lint
npm run test:ci
npm run eval
npm run build:cloudflare
npm run deploy -- --dry-run
```

`npm run deploy -- --dry-run` 会验证 OpenNext bundle、assets、D1、Durable Object 和 Rate
Limiting bindings，但不会执行远程 D1 migration，也不会上传生产 Worker。

## 5. 部署

```bash
npm run deploy
```

部署 wrapper 的顺序是：

1. `wrangler d1 migrations apply chisha --remote`
2. `wrangler deploy`

不要把直接运行 `npx wrangler deploy` 当成等价命令，它不会执行项目的 D1 migration。
只有已经显式处理 migration 时才使用：

```bash
npm run deploy:skip-migrations
```

### Durable Object 首次迁移

首次在目标账号引入 `ProviderSchedulerDurableObject` 或未来新增 DO migration 时，必须至少
执行一次非版本化 `npm run deploy`。`wrangler versions upload` 不能应用新的 DO
migration。

已有 DO migration 完成后可以上传新版本：

```bash
npm run versions:upload
```

## GitHub CI 与 Cloudflare Builds

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 PR 和 `main` push 上执行：

1. 文档检查、type-check、lint、覆盖率单测和 deterministic Agent eval；
2. 独立的 OpenNext build 与 Wrangler dry-run。

CI 不持有生产 API Key，不迁移远程 D1，也不上传 Worker。

生产发布目前仍由 Cloudflare Workers Builds 的 Git 集成负责。Dashboard 中应：

- 把 production branch 设置为 `main`；
- 关闭 non-production branch builds；
- 配置与手工部署相同的 D1、DO、Rate Limiting、secrets 和 variables。

Cloudflare connected build 不会自动等待 GitHub Actions。不要把当前系统描述为“CI 全绿后
才发布”。将来若把发布迁入 GitHub Actions，先创建最小权限 token 和受保护 environment，
再关闭 Cloudflare Git 集成，避免两条生产链路并存。

## 线上验收

至少验证：

- 公网 `http://` 使用 308 跳到同 path/query 的 HTTPS；
- 首页、地图配置和静态资源正常；
- 新 Agent SSE 能完成搜索，心跳期间连接不断开；
- 追问后使用同一浏览器可以续跑；不同 Cookie 读取同一 session id 返回 404；
- 同一 session 并发时最多一个运行进入 Runtime；
- `/api/search`、geocode 和 session 入口限流返回合理的 429/`Retry-After`；
- 高德、模型或调度故障分类为可区分的 429/503 或类型化 SSE error；
- 日志中没有 API Key、owner Cookie、完整 prompt、完整 query 或真实用户位置；
- D1 migration 列表、DO binding 和五个 Rate Limiting bindings 与 `wrangler.jsonc` 一致。

不要通过主动耗尽真实供应商额度做验收。

## 其他平台

普通 Vercel、Netlify 或自托管 Node 可以用于私有实验，但默认缺少当前生产依赖的 D1、
Durable Object、原生 Rate Limiting binding 和 Worker HTTPS 外层。直接部署不会满足公开
运行保护契约。

若要支持其他公开平台，必须先提供等价的跨实例：

- Agent session 持久化与 owner 授权；
- 同 session 互斥和全站 active-run 上限；
- Provider QPS/RPM/TPM/在途协调；
- 入口限流、HTTPS 升级和部署验证。

这属于新的架构决策，需同步 Requirements、Technical 文档和 Specs。

## 故障排查

### D1 不可访问

- 确认 `database_id` 属于当前账号；
- 检查 `CHISHA_DB` binding；
- 运行 `npx wrangler d1 migrations list chisha --remote`。

### Provider 调度返回 503

- 检查 `PROVIDER_SCHEDULER` binding 和 DO migration；
- 检查 `SESSION_OWNER_SECRET` 长度；
- 区分配置错误、配额耗尽与短暂拥塞，不要盲目提高重试次数。

### 地图不显示

- 请求 `/api/map/config`，确认 `configured: true`；
- 检查 `AMAP_JS_API_KEY` 和高德域名白名单；
- 只为实际需要的地图资源扩展代理白名单，禁止通配转发。

### Dry-run 意外迁移

项目 wrapper 在 `--dry-run` 时必须打印跳过远程 migration。若没有看到该信息，停止命令并
确认使用的是 `npm run deploy -- --dry-run`，而不是自定义调用链。
