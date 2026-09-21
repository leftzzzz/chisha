# 安全说明

## 报告漏洞

不要用公开 issue 报告安全问题。请通过 GitHub
[私密安全通告](https://github.com/leftzzzz/chisha/security/advisories/new)提交，并包含影响、
复现条件和建议修复方向。提交前删除 API Key、Cookie、真实坐标、完整对话和私有 trace。

这是个人维护的开源项目，没有响应 SLA，也不提供托管服务安全承诺。

## 支持的生产边界

当前公开生产拓扑是 Cloudflare Workers + D1 + Durable Objects + Rate Limiting bindings。
详细部署步骤见 [Cloudflare 部署指南](./docs/DEPLOYMENT.md)，强制边界见
[Public Runtime Protection Spec](./docs/specs/public-runtime-protection.md)。

普通 Vercel、Netlify 或自托管 Node 默认缺少跨实例会话、Provider 容量和原生入口限流，
不能直接视为等价的公开部署。用于私有实验可以，公开服务前必须补齐等价保护。

## 凭证

- `OPENAI_API_KEY`、`AMAP_API_KEY`、`AMAP_SECURITY_CODE` 和
  `SESSION_OWNER_SECRET` 只能存在服务端 secret store。
- `NEXT_PUBLIC_AMAP_KEY`/`AMAP_JS_API_KEY` 是 Web 端 JS Key，会暴露在浏览器；防护方式是
  高德域名白名单与安全密钥，不是把它伪装成服务端 secret。
- 生产 `SESSION_OWNER_SECRET` 必须至少 32 个随机字符。缺失或过短时 Agent session 入口
  应失败关闭。
- `.env.local`、`.dev.vars`、Cloudflare 下载配置、shell 输出和真实 trace 不得提交。

公开环境变量名称与默认关系以 [`.env.example`](./.env.example) 为准。

## 公网准入

### HTTPS

`worker.ts` 在 OpenNext 之前把非本地公网 HTTP 以 308 重定向到同 host、path 和 query 的
HTTPS。308 保留 POST 方法和请求体，避免 Agent SSE 建连或 Secure Cookie 在跳转时丢失。
本地回环地址继续允许 HTTP。

### Rate Limiting

`wrangler.jsonc` 声明五个 Cloudflare Rate Limiting bindings：

| Binding | Boundary |
| --- | --- |
| `RL_AGENT_CHAT` | Agent chat 按客户端 IP |
| `RL_AGENT_CHAT_ALL` | Agent chat 全局廉价闸门 |
| `RL_AMAP_PROXY` | 高德前端地图代理 |
| `RL_GEOCODE` | 正/逆向地理编码 |
| `RL_AGENT_SESSION` | session 读取和删除 |

额度与 `lib/rateLimit.ts` 的 `RATE_LIMITS` 必须一致，并由测试强制。Cloudflare binding 是
廉价反滥用，不是严格账单硬上限；Agent active runs、同 session 互斥和每个 Provider 的
物理容量由 Durable Object 单独协调。

缺少 binding 时本地开发会使用进程内存计数。Serverless 多实例中的内存计数不构成公开
保护；生产日志出现以下内容应视为配置缺陷：

```text
Rate limit binding missing on a serverless runtime; falling back to in-process memory
```

### Provider Scheduler

`PROVIDER_SCHEDULER` Durable Object 管理：

- 全站同时运行的 Agent 数；
- 同一 session 的单运行互斥；
- 高德、OSM 和模型的 token/lease、在途与可选速率上限；
- 已知配额耗尽或配置故障的短路与恢复探测。

每个外部 HTTP 尝试都必须先取得对应 lease，调用结束在 `finally` 释放，长调用自动 renew。
等待有上限；拥塞返回带 `Retry-After` 的 429，基础设施或上游不可用返回 503。生产缺少
核心调度 binding 时昂贵入口应失败关闭。

## 匿名会话

首次 Agent 请求签发 `chisha_owner` Cookie：

- 密码学随机 owner id；
- HMAC-SHA-256 签名并包含服务端校验的到期时间；
- HttpOnly、SameSite=Lax、Path=/；生产增加 Secure；
- 合法访问时滚动刷新。

D1 session 保存 `owner_id`。chat resume、session GET/trace、DELETE 都必须先匹配 owner；
不存在、过期和 owner 不匹配统一返回 404，避免枚举。Cookie 不是账号系统，清除 Cookie 或
换浏览器后不能继续旧会话。

同一 session 的并发执行由跨实例 lease 互斥，避免整行 runtime state 最后写入覆盖。

## 数据

### D1 Agent sessions

`agent_sessions` 可能明文保存：

- 经纬度和地址；
- 多轮对话原文；
- 目标、搜索 action、候选、裁决和 trace；
- owner id 与过期时间。

部署者负责隐私告知、保留期限、访问控制、备份和删除策略。`expires_at` 是应用清理边界，
不是法律合规承诺。

### 浏览器与分享

- 转盘历史位于用户浏览器 `localStorage`，包含查询、位置和选择结果。
- 历史导出文件由用户自行保管。
- 分享 URL 不含位置或 session，但包含查询和餐厅；持有链接的人可以读取这些内容。

### Fixture 与第三方数据

高德 POI 数据受其平台条款约束。`evals/fixtures/amap.json` 必须保持手工构造，禁止提交
真实响应、缓存导出或用户查询结果。模型输出也受所选供应商条款约束。

## 高德地图代理

`app/api/amap-service/[...path]/route.ts` 会注入安全密钥，因此只能代理前端地图实际需要的
精确白名单路径。不得恢复为通配 REST 转发；需要新地图资源时，只加入观察到的具体路径并
补测试。

## 日志与诊断

允许记录 trace id、事件类型、计数、等待时长、Provider 分类和 lease 生命周期。禁止记录：

- API Key、Cookie、HMAC、authorization header；
- 完整 prompt、完整用户 query 或完整坐标；
- D1 原始 session row 或未打码 Provider 响应。

分享日志或 issue 前再次人工打码。`?include=trace` 只用于自己的 session 排障，不应公开
转贴完整响应。

## 依赖与更新

```bash
npm audit
npm run type-check
npm run lint
npm run test:ci
npm run build:cloudflare
npm run deploy -- --dry-run
```

普通依赖升级问题可以使用公开 issue；可利用漏洞仍走私密安全通告。不要不经审查直接运行
会改写依赖树的自动修复并提交。
