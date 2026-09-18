# Public API and Streaming Spec

本 Spec 约束 `app/api/**`、`lib/api.ts` 和对应 API 测试的公开 HTTP/SSE 契约。Agent
语义与发布资格见 [Restaurant Search Agent Spec](./restaurant-search-agent.md)；准入、匿名
会话、限流和 Provider 容量见
[Public Runtime Protection Spec](./public-runtime-protection.md)。

## 路由

| Route | Methods | Responsibility |
| --- | --- | --- |
| `/api/agent/chat` | `POST` | 主 Agent 多轮 SSE 入口 |
| `/api/agent/search` | `POST` | 把旧 `{ query }` 请求映射为 chat 的兼容入口 |
| `/api/agent/session/:id` | `GET`, `DELETE` | 读取会话摘要/可选 trace，或删除自己的会话 |
| `/api/search` | `POST` | 转盘管理面板使用的有界直接 POI 搜索 |
| `/api/geocode` | `POST` | 地址转坐标 |
| `/api/geocode/reverse` | `POST` | 坐标转地址 |
| `/api/map/config` | `GET` | 返回前端地图 Key 的运行时配置状态 |
| `/api/amap-service/:path*` | `GET`, `POST` | 仅代理前端地图所需的高德白名单路径 |

未列出的旧接口（包括 `/api/understand`）不是当前公开契约。各业务路由不支持的方法必须
返回 405，而不是静默执行其他路径。

## Agent Chat 请求

`POST /api/agent/chat` 接受 JSON：

```ts
type AgentChatRequest = {
  message?: string;              // 1..500；与 optionId 至少一个存在
  optionId?: string;             // 1..64；必须同时提供 sessionId
  location: { lat: number; lng: number; address?: string };
  sessionId?: string;
  preferenceSummary?: UserPreferenceSummary;
  groupPreferenceSummaries?: UserPreferenceSummary[];
};
```

- `message` 和 `optionId` 表达两条不同协议路径；选项 label 不得替代 `optionId`。
- 请求体、位置、偏好数组和字符串在进入模型、D1 或 Provider 前必须有界校验。
- 新会话可以不传 `sessionId`；续跑、选项回答和会话访问必须持有匹配的匿名 owner Cookie。
- 准入前失败返回 JSON；流建立后的业务失败发送 `error` SSE 事件。

## SSE 帧

- 响应使用 `Content-Type: text/event-stream`，每个事件采用 `data: <JSON>\n\n`，事件类型由
  JSON 的 `type` 字段区分。
- 进度事件包括 `thinking`、`status`、`searching`、`search_result`、`filtering`、
  `action`、`observation`、`guardrail`、`tool_start`、`tool_result` 和 `partial_results`。
- 会话事件包括 `question`、`session_paused`、`session_resumed` 和 `session_updated`。
  `question.options[].id` 是协议，`label` 仅用于展示。
- `final` 是当前正常终止结果，包含主推荐 `restaurants`、候补 `candidates`、解释和未满足
  约束；`done` 保留为客户端可解析的兼容事件，但新 Runtime 不应以它建立第二套终止语义。
- `error` 包含 message、可选类型化 code 和 recoverable；消费者不得按 message 子串猜测
  错误类型。
- `heartbeat` 只重置客户端无事件超时，不触发业务状态；服务端默认间隔与客户端 45 秒
  无事件超时必须保持安全余量。
- 事件可以带 `traceId`；并发搜索进度以 `planId` 聚合，不能按到达顺序互相覆盖。
- `question` 后保存会话并发送 `session_paused`，随后结束本次流。回答通过新的 POST 续跑，
  不是在原 SSE 上双向通信。

## 会话 API

- `GET /api/agent/session/:id` 默认返回有界会话摘要、goal、action/observation 计数和摘要；
  只有显式 `?include=trace` 才返回完整 trace。
- Observation 摘要包含已评估数、未评估数和评估停止原因；旧会话缺少渐进评估字段时，
  已评估数可以使用既有 verdict 数量，无法确定的数量返回 `null`，不把缺失伪装成零或失败。
- `DELETE` 取得同会话互斥 lease 后删除并返回 `{ "ok": true }`。
- 不存在、过期和 owner 不匹配统一返回 404，不能泄露会话是否存在。
- 429 表示短暂拥塞或入口限流，503 表示配置/协调/上游不可用；可重试响应提供
  `Retry-After`。

## 直接搜索与位置 API

- `/api/search` 的 keywords 为 1..8 个非空字符串，每个不超过 100 字符；distance 为
  100..10000 米，count 为 1..20。它不经过 Agent 语义 workflow，但必须经过入口限流和
  高德全局调度。
- `/api/geocode` 接受 `{ address, city? }`，`/api/geocode/reverse` 接受
  `{ location }`；成功响应使用共享 `{ success, data }` JSON envelope。
- `/api/map/config` 禁止缓存，返回 `{ amapKey, configured }`；这里只能暴露 Web 端 JS Key，
  不能暴露 Web 服务或模型凭证。
- 高德地图代理只允许代码中列明的地图资源路径。增加地图功能时扩展精确白名单，禁止恢复
  通配转发。

## 兼容与验证

- `/api/agent/search` 只负责 `{ query -> message }` 映射并委托 chat；不得复制 Runtime、
  会话或安全实现。
- 对请求字段、状态码、SSE 事件、终止行为或会话可见性的改变属于契约变更，必须同步
  客户端、API 测试、本 Spec 和相关安全 Spec。
- 相关变更至少运行对应 API/heartbeat/session 测试；Agent 事件或终止语义变化还要运行
  `npm run eval`。
