# 安全说明

## 报告漏洞

**不要用公开 issue 报告安全问题。** 请通过 GitHub 的
[私密安全通告](https://github.com/leftzzzz/chisha/security/advisories/new)
提交。这是个业余项目，没有 SLA，但会尽力在一周内回复。

## 自建部署前必须知道的事

这个项目开源的是代码，不附带任何 API Key。你自己部署一份之后，**账单是你的**，
以下几点直接决定你会不会被刷。

### 1. 部署到 Workers 时，别漏掉 ratelimits 配置

`lib/rateLimit.ts` 有两套后端：Cloudflare Workers 原生 Rate Limiting binding，
以及进程内存兜底。**内存兜底在 Serverless 上等于没有限流**——每个请求可能落在
不同的隔离实例里，内存不共享。

生产必须走 binding。`wrangler.jsonc` 里的 `ratelimits` 段声明了四个命名空间，
额度与 `lib/rateLimit.ts` 的 `RATE_LIMITS` 表一一对应（由
`__tests__/lib/rateLimit.config.test.ts` 强制一致）。**少配任何一个，对应入口就会
静默退回内存计数**——只在日志里留一条 warn：

```
Rate limit binding missing on a serverless runtime; falling back to in-process memory
```

部署后 grep 一下这条日志，有就是配漏了。

`/api/agent/chat` 上有两道闸门：按 IP（6 次/分钟）挡普通滥用，按常量 key 的总量
闸门（60 次/分钟）挡轮换 IP 的脚本——后者才是真正给账单封顶的那道。注意原生
binding **按 Cloudflare 机房各自计数**，所以总量闸门的实际上限是这个数乘以攻击者
能打到的机房数。它大幅收窄风险，但不是硬上限。

**部署到 Vercel 或自托管 Node 的话，这套 binding 不存在**，限流会退回内存。
Vercel 的 Node runtime 单实例内内存是共享的，比 Edge 好一些，但仍然不跨实例。
要挂公开站点就得自己接一个全局方案（Redis/Upstash 之类）。

### 2. 不要把 `/_AMapService` 改回通配转发

`app/api/amap-service/[...path]/route.ts` 是一条公开路径，服务端会给转发出去的
请求注入 `AMAP_SECURITY_CODE`。它现在只放行 JS API 实际需要的几条路径
（`v3/vectormap`、`v4/map/styles`、`maps`），其余 404。

放开成"任意路径转发给 restapi.amap.com"就等于把你的高德配额挂到公网上，
任何人都能拿你的域名当免费跳板。前端加了新的高德插件导致地图报错时，
把具体路径加进 `ALLOWED_PATHS`，不要改回通配。

### 3. 前端 Key 和服务端 Key 要分开

- `NEXT_PUBLIC_AMAP_KEY`（Web 端 JS API）**必然**暴露在浏览器里，这是高德的
  设计。防护手段是在高德控制台给它配**域名白名单**和安全密钥，而不是藏起来。
- `AMAP_API_KEY`（Web 服务）和 `OPENAI_API_KEY` 只在服务端使用，绝不能加
  `NEXT_PUBLIC_` 前缀。

### 4. 会话里存了什么

`agent_sessions` 表（`migrations/0001_create_agent_sessions.sql`）在 D1 里明文存：

- `location_json`：用户的经纬度和地址
- `messages_json`：完整的多轮对话原文
- `runtime_state_json`：搜索历史与候选裁决

有 `expires_at` 做过期清理。如果你对外提供服务，这些属于个人信息，需要自己
承担相应的告知与合规义务。

### 5. 第三方服务条款

- 高德 POI 数据受高德开放平台条款约束，仅可作为运行时缓存使用，不得导出、
  存档或再分发。仓库里 `evals/fixtures/amap.json` 是手工构造的假数据，
  不是抓取结果——**请不要往里面提交真实 POI 返回**。
- 模型调用受你所用服务商的条款约束。

## 依赖

```bash
npm audit
```

依赖漏洞按常规流程报 issue 即可，不需要走私密通道。
