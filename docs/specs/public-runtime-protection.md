# Public Runtime Protection Spec

本 Spec 适用于公网 API、Agent 会话、Provider adapter、模型客户端、Cloudflare Worker 入口、
Durable Object 调度和相关测试。产品要求见
[`../requirements/public-runtime-protection.md`](../requirements/public-runtime-protection.md)，
技术理由见
[`../technical/provider-capacity-scheduling.md`](../technical/provider-capacity-scheduling.md)。

## 并发分层

- `AGENT_SEARCH_CONCURRENCY` 只控制 Runtime 一批搜索计划的逻辑 fanout，默认 3。
- 高德、模型和 OSM 必须各自经过跨 Worker 实例的物理容量调度；不得通过把 Agent fanout
  固定为 1 来代替供应商保护。
- 高德生产速率由 `AMAP_SAFE_QPS` 控制。默认兼容值为 4；上线配置必须来自控制台实际最小
  QPS 的 70% 安全水位，不能在代码或文档中声称免费版恒为 1 QPS。
- 高德月调用量与 QPS 必须分别记录；购买或补充调用量不能被推断为 QPS 已同步提高。
- 模型至少有全局在途上限；RPM/TPM 为 0 时仅关闭对应速率维度，不得关闭在途保护。
- OSM fallback 使用独立且更保守的容量域，不能因为高德故障绕过调度。

## 全局调度

- 生产部署使用 Durable Object 做全局 token 与 lease 协调；每个独立资源使用独立对象名。
- DO 不执行外部网络请求，不保存等待 Promise，只返回授予或建议等待时长。
- lease 必须有唯一 id 和过期时间；调用方在 `finally` release，长调用在租约失效前 renew，
  alarm 回收遗留 lease，重复 release 必须幂等。
- 调用方总等待受 `PROVIDER_MAX_WAIT_MS` 限制，默认 3000ms，可配置范围 0–5000ms。超时
  返回类型化可重试错误及 `Retry-After`，不得无限等待。
- 生产缺少调度 binding 时，Agent chat 与直接搜索失败关闭；测试/本地 fallback 必须显式
  启用，不能由异常静默触发。

## 公网入口

- Worker 最外层必须将非本地公网 `http:` 请求以 `308` 重定向到同 host、path 和 query 的
  `https:` URL，再交给 OpenNext。不得使用会把 POST 改写为 GET 的 `301/302`；`localhost`、
  `*.localhost`、`127.0.0.1`、`0.0.0.0` 和 `[::1]` 保留 HTTP 本地开发能力。
- Worker compatibility flags 必须包含 `enable_request_signal`；否则生产传入请求的
  `Request.signal` 不会向 SSE 取消桥接发出 abort 事件，客户端断开无法传播到 Agent。
- 请求体必须在昂贵准入前完成有界 schema 校验。
- `getClientIP` 在 Cloudflare 环境优先 `CF-Connecting-IP`，其次才使用平台确认的其他头；
  `X-Forwarded-For` 不能覆盖可信头。
- `/api/agent/chat` 在返回 SSE 响应前取得全局 active-run lease 与 session lease。已有会话先
  校验 owner 并取得 session lease，再占全局名额；新会话先取得全局名额，创建后取得其唯一
  session lease。所有退出路径必须回收。
- SSE 正常结束必须先等待 admission lease release，再关闭响应流；客户端 cancel 必须返回
  同一个幂等 cleanup Promise，不能依赖 120 秒 lease TTL 回收正常完成的请求。
- `/api/search` 必须有入口限流、有界数组/字符串/半径/数量 schema，并通过高德调度器。
- session GET/DELETE 必须有独立入口限流，且限流不能代替 owner 授权。
- 拒绝拥塞使用 429；协调基础设施或上游不可用使用 503；两者包含合理 `Retry-After`。

## 匿名会话边界

- `AgentSession` 持久化非空 `ownerId`，新会话创建时必须传入已验证的匿名 owner。
- owner Cookie 使用密码学随机 id 与 HMAC-SHA-256，HttpOnly、SameSite=Lax、Path=/，
  token 到期时间必须纳入签名并由服务端校验；有效期不得短于会话 TTL并在合法访问时重新
  签发、滚动刷新；生产必须设置 Secure。Cookie 必须在
  SSE 响应头发送前生成。
- 生产 `SESSION_OWNER_SECRET` 缺失或少于 32 字符时不得创建或读取公网会话。
- chat resume、session GET、trace GET 和 DELETE 都必须在读取内容或修改前核对 owner。
- 不存在、过期、旧版无 owner 和 owner 不匹配统一表现为不可访问，不泄露记录是否存在。
- 同一 session 同时最多一个 Agent turn；这条互斥必须跨 Worker 实例生效。

## Provider 调用

- 所有实际高德 HTTP 尝试（包括重试）都必须先取得高德 lease/token；不得只调度外层搜索
  plan。
- 单次 Agent 运行内详情请求并发由 `AMAP_DETAIL_CONCURRENCY` 控制，默认 2。
- 高德日配额耗尽、Key/签名/权限错误不可重试；QPS 与瞬时错误只允许有界退避。
- 调度域必须对已知配额耗尽或配置故障设置可持久化短路窗口，并在窗口后有限探测；探测
  成功自动恢复，不能要求重新部署。
- 调用方 AbortSignal 必须与 Provider 超时组合；中止后不得继续分页、详情或 fallback。
- SSE cancel 或租约续期失败必须中止对应 Agent 运行；失去 lease 后不得继续调用供应商。
- 模型的每次实际 HTTP 尝试都经过 endpoint+model 调度域，并在发送前做可配置 RPM/TPM
  预留。结构化补全、schema repair 和兼容 fallback 都算独立尝试。
- Provider 调度错误必须保留类型，不能用错误 message 子串在下游重新猜测。

## 可观测性与数据安全

- 记录准入结果、等待时长、队列深度、Provider 分类、租约回收与 fallback；日志字段必须可
  关联现有 trace id。
- 禁止在调度 key 或日志中包含 API key、owner Cookie、签名、完整 prompt 或完整 query。
- 高德额度耗尽必须和瞬时限速分开计数，便于补流量包后的恢复验收。

## 变更与验证

- 调度默认值变化不得顺带改变 Agent 语义 fanout、搜索预算或 evidence/FinalGuard 契约。
- 新增或修改 Durable Object 时必须同步 Wrangler binding、migration、生成类型和 Worker
  导出，并通过 Cloudflare dry-run。
- Cloudflare dry-run 不得执行远程 D1 migration；部署命令才允许按既定顺序应用 migration。
- 首次发布新的 Durable Object class 或 migration 时必须使用非版本化 `npm run deploy`。
  Cloudflare Version upload 和 PR 预览不能应用新 DO migration；其 `10211` 失败只可在常规
  CI、构建与 binding 校验均通过且确认是该约束时接受，并必须在合并后的生产部署中完成
  migration 与线上验收。
- 适用改动至少运行类型检查、lint、相关 Jest、`npm run eval`、Next/OpenNext 构建和文档
  结构审计。
