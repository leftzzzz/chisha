# 供应商容量调度与公网运行保护

## 状态

接受，计划随公开版上线实施。本文解释技术选择；当前强制契约见
[`../specs/public-runtime-protection.md`](../specs/public-runtime-protection.md)。

## 现状与根因

当前 `lib/amap.ts` 的 Promise 链只能约束单个 JavaScript 隔离实例；Cloudflare 原生
Rate Limiting binding 适合入口反滥用，但不提供供应商账号所需的严格全局并发与 QPS
协调。与此同时，Runtime 一批最多并行三个搜索计划，每个计划还可能产生分页、详情与
模型验证调用。因此 HTTP 请求数与实际供应商请求数不是一一对应关系。

`AMAP_MAX_QPS=1` 会把所有高德调用串成长队列并损害 Agent fanout，它只能作为未知配额
时的紧急保守配置，不是目标架构。

### 外部限制核验

截至 2026-08-18，高德公开资料只给出配额体系和不同身份/授权对应的基础搜索月量，精确
QPS 必须从[控制台配额管理](https://lbs.amap.com/api/webservice/guide/tools/flowlevel)读取；
[定价页](https://lbs.amap.com/upgrade#price)也表明搜索额度会在多个端和 Key 的服务范围内
共享。由此只能确定必须做账号级协调，不能从“免费版”推导出 1 QPS。

阿里云百炼的[官方限流说明](https://help.aliyun.com/zh/model-studio/rate-limit)明确：主账号下
RAM 用户、业务空间和 API Key 共享模型限额，不同模型分别计算，RPM/TPM 之外还需要避免
瞬时 RPS/TPS 突增。429 表示速率限制，免费额度耗尽通常是 403；购买 token 额度不等于
提高速率限制。由于生产实际模型和控制台限额无法从仓库安全推断，`MODEL_RPM_LIMIT=0`、
`MODEL_TPM_LIMIT=0` 只代表“尚未录入控制台值”，此时仍由全局在途 lease 兜底。

## 架构决策

### 协调原语

使用一个 Durable Object 类、多个按协调域命名的实例：

```text
public request
  -> entry admission (per-IP hint + global active-run lease)
  -> session lease (one active turn per session)
  -> Agent Runtime keeps logical fanout
       -> amap:<credential-scope>   token bucket + in-flight leases
       -> model:<endpoint>:<model>  in-flight + optional RPM/TPM reservations
       -> osm:<endpoint>            low-rate fallback protection
```

一个实例只协调一个必须共享顺序的资源，不创建“全站所有流量共用一个对象”的热点。DO
只授予和回收租约，不在对象内调用高德、模型或 OSM。外部 I/O 仍由 Worker 发起。

### 调度算法

- QPS/RPM 速率使用可持久化 token bucket；突发容量默认不大于一秒允许量，避免长时间
  空闲后突发。TPM 保留完整分钟预算，因为单次合法模型请求本身可能大于一秒 TPM 份额。
- 并发使用带过期时间的 lease。调用方在 `finally` 回收，并在长调用期间定期续租；DO
  alarm 回收因 Worker 中断遗留的租约。租约时长不能被误当成调用超时。
- acquire 返回 `granted`、`retryAfterMs`、`queueDepth` 和可选 `leaseId`。调用方以带 jitter
  的等待在总预算内重试，不把等待者保存在 DO 内存中，因此对象驱逐不会丢队列。短等待是
  best-effort，不承诺严格 FIFO。
- TPM 是发送前的估算预留：输入字符换算保守 token 估值并加 `maxTokens`。真实用量只用于
  指标校准，不在响应后追溯阻塞已完成请求。
- 所有配置解析都有上下界；逻辑 fanout 与物理速率使用不同环境变量。

建议初始配置：

```dotenv
AGENT_SEARCH_CONCURRENCY=3
AGENT_MAX_ACTIVE_RUNS=3
PROVIDER_MAX_WAIT_MS=3000

# 用 floor(min(账号QPS, 服务QPS, Key QPS) * 0.7) 替换 4
AMAP_SAFE_QPS=4
AMAP_MAX_INFLIGHT=6
AMAP_DETAIL_CONCURRENCY=2

MODEL_MAX_INFLIGHT=4
MODEL_RPM_LIMIT=0
MODEL_TPM_LIMIT=0

OSM_SAFE_QPS=1
OSM_MAX_INFLIGHT=1
```

`MODEL_RPM_LIMIT=0`/`MODEL_TPM_LIMIT=0` 表示控制台数值尚未配置时只启用严格在途上限，
不是无限在途。取得阿里云实际配额后再启用对应 token bucket。

### 入口与会话

入口先解析和校验小体积请求、建立匿名 owner 并执行可信 IP 反滥用。已有会话先做 D1
所有权检查并取得 session lease，再取得全局运行 lease，避免无效或同会话重复请求占住全局
名额；新会话先取得全局 lease，创建记录后立即取得其 session lease。所有步骤都在 SSE 响应
建立前完成，任何后续异常都在 `finally` 回收租约。

匿名所有者 Cookie 保存随机 id 与 HMAC 签名，服务端只将 owner id 写入 D1。签名密钥
`SESSION_OWNER_SECRET` 是生产必需且至少 32 字符的高熵 secret。Cookie token 把到期时间
纳入 HMAC，服务端拒绝过期 token，不能仅依赖浏览器删除。Cookie 仅在生产添加 `Secure`，本地 HTTP 开发
仍保持 HttpOnly 与 SameSite。每次成功解析 Cookie 时重新签发并滚动刷新有效期，使其不短于会话 TTL。
为避免 id 枚举，所有权不匹配与记录不存在统一
表现为 `SESSION_EXPIRED`/404。旧的无 owner 会话不允许被任意访问，公开版部署后自然过期。

D1 增加 `owner_id`。同会话 DO lease 在现有整行 upsert 前提供互斥；这解决当前公开入口的
并发覆盖，但不把它宣称为通用数据库 CAS。未来出现后台写入者时仍应引入 revision compare-
and-swap。

### 取消与超时

请求的 `AbortSignal` 传入 Runtime 使用的 Provider adapter，`fetchWithTimeout` 组合调用方
信号和超时信号。客户端断开后停止后续高德/OSM请求并尽早回收租约。模型结构化调用同样
接受可选 signal；输出 SSE 的 `cancel()` 也会主动中止当前运行。任何 active-run、session
或 Provider lease 续期失败都会中止对应工作，避免失去容量所有权后继续调用上游。无法取消
的已发请求仍受全局 lease 与上游超时约束。

### 错误与降级

高德错误分为：

- `rate_limited`：QPS/并发类错误，可做少量带 jitter 的退避；
- `quota_exhausted`：日量或购买量耗尽，不重试；
- `configuration`：Key、签名、权限或白名单错误，不重试；
- `unavailable`：网络或服务端瞬时故障，可有界重试。

只有搜索 Provider 错误可触发 OSM；本地配置错误不应被静默掩盖。OSM 使用自己的调度域，
避免高德故障时形成 fallback storm。模型 429 与 5xx保留类型化错误，入口不会用 OSM 掩盖
模型故障。

调度对象维护可持久化 `blockedUntil`。配额耗尽和配置错误报告给对应调度域，使后续 acquire
在冷却期内直接拒绝；冷却结束只放行有限探测请求。高德补充流量包后，探测成功清除状态并
自动恢复。QPS 类错误只使用上游 `Retry-After` 或短退避，不触发长时间熔断。

## 运行方式

OpenNext 生成 `.open-next/worker.js`。仓库提供薄 Worker 入口，转发 OpenNext 默认 handler
并导出 Durable Object 类；`wrangler.jsonc` 将 `main` 指向该入口，声明 binding 与 SQLite
migration。构建后用 Wrangler 校验真实 bundle，不能只靠 Next.js 类型检查。

生产缺少 `PROVIDER_SCHEDULER` 或 `SESSION_OWNER_SECRET` 时失败关闭。测试和明确的本地开发
模式可以使用进程内调度器，但日志必须标明非全局语义。

## 可观测性

每次租约至少记录：`provider`、`operation`、`outcome`、`waitMs`、`queueDepth`、
`leaseAgeMs`、匿名 hash 后的调度 key 和 trace id。不得记录 API key、Cookie 或完整用户
query。入口记录 active-run 拒绝，会话记录 owner mismatch，Provider 错误记录标准分类与
上游码。

session GET/DELETE 使用单独的廉价入口 Rate Limiting binding。它防止 D1 枚举读取，但不
承担身份判断；最终授权始终由 owner 校验完成。

## 被否决方案

- **固定高德 1 QPS**：混淆逻辑并发与物理配额，延迟过高，无法利用实际购买容量。
- **只用入口 IP 限流**：IP 可共享或轮换，且一次请求的上游放大倍数不固定。
- **只用 Cloudflare Rate Limiting binding**：可用于廉价入口防滥用，不承担严格全局账号
  容量协调。
- **一个进程内 semaphore**：多 isolate、多 PoP 之间不共享状态。
- **同步请求进入持久长队列**：超出浏览器和 Worker 生命周期，用户体验不可预测。
- **本期使用 Cloudflare Queues**：Queues 适合异步作业；当前 SSE 协议没有 job lifecycle。
- **用单个全局 DO 承载全部资源**：把独立供应商和会话变成不必要的单点热点。

## 发布与回滚

1. 先应用 D1 owner migration 与 DO migration，再发布 Worker；dry-run 必须跳过远程 D1
   migration，避免构建验证产生生产写入。
2. 在生产 secrets 中配置 `SESSION_OWNER_SECRET`，并按控制台确认容量变量。
3. 以安全值灰度，观察等待时间、上游 429、5xx、租约过期和 fallback 比例。
4. 只调整物理容量变量，不通过降低 `AGENT_SEARCH_CONCURRENCY` 处理供应商配额。
5. 回滚代码时保留新增 D1 列和 DO migration；它们向后兼容，不执行破坏性 down migration。

## 验证矩阵

- 单元：token refill、RPM/TPM 预留、在途上限、等待超时、release 幂等、续租、过期租约
  回收和熔断恢复探测。
- API：伪造转发头、过大 search payload、入口拥塞、同 session 并发、owner 越权。
- Provider：高德限速/耗尽/配置错误分类，OSM fallback storm，模型 429/5xx。
- 回归：Agent chat、D1 session、`npm run eval`、Next build、OpenNext build、Wrangler dry-run。
- 线上：正常 SSE、匿名会话续接、不同 Cookie 越权拒绝、并发拒绝可恢复、日志和错误率。
