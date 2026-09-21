# ChiSha 应用架构

> 状态：当前技术说明。本文解释应用边界和实现取舍；强制行为以 `docs/specs/` 为准。

## 总览

ChiSha 是一个 Next.js 16 App Router 应用。浏览器负责位置选择、推荐进度、转盘、分享和
本地历史；服务端负责自然语言目标理解、餐厅搜索与验证、匿名 Agent 会话以及 Provider
容量保护。生产目标平台是 Cloudflare Workers，通过 OpenNext 构建。

```text
Browser UI
  -> POST /api/agent/chat (SSE)
  -> runSearchAgentV3
       -> deterministic policy
       -> bounded model roles
       -> Amap / OSM provider adapters
       -> FinalGuard / ResultAssembler
  -> primary + candidate restaurants
  -> turntable and local history
```

当前 Agent workflow 的详细决策见
[当前餐厅搜索 Workflow](./current-agent-workflow.md)。它是已接受的生产架构；Lead Agent
备选只保留在 [Deferred Alternative](./agent-architecture-root-decision-2026-08.md)。

## 浏览器应用

- `app/page.tsx` 与 `components/HomePage.tsx` 组合主流程，`app/history/page.tsx` 提供历史页。
- `AppContext` + `AppReducer` 保存跨组件状态；hooks 把位置、搜索、转盘和错误交互封装为
  可测试边界。
- 桌面端以地图为主要空间背景并显示侧栏，移动端使用纵向布局和 Bottom Sheet；两端共享
  同一业务状态，不维护两套规则。
- 转盘展示后端主推荐和用户添加选项。候补、已移除餐厅与搜索新增通过管理面板显式流转。
- 历史和偏好摘要来自浏览器 `localStorage`；服务端不保存用户的转盘历史。
- 分享使用 URL 中的压缩数据恢复转盘，不携带位置或 Agent session。其取舍是无需分享
  后端和账号，但链接持有者能看到被编码的查询与餐厅信息。

## 服务端路由

- `/api/agent/chat` 是主链路：校验请求、取得匿名 owner、执行全局/会话准入、加载或创建
  D1 session，并把 Runtime 事件作为 SSE 流返回。
- `/api/agent/search` 是旧请求形状的薄兼容层，复用 chat 实现。
- `/api/agent/session/:id` 提供 owner-scoped 的诊断摘要、trace 读取和删除。
- `/api/search` 为转盘管理提供简单 POI 搜索；它绕过 Agent 语义 workflow，但不绕过限流
  与 Provider 调度。
- geocode、reverse geocode、map config 和受限 Amap proxy 支撑位置与地图显示。

公开协议以 [Public API and Streaming Spec](../specs/public-api-and-streaming.md) 为准。

## Agent 与数据流

1. Goal understanding model 将自然语言和会话上下文整理为 `UserGoal`。
2. Keyword expansion、evaluation、受限 replan 模型角色分别处理局部语义任务。
3. `orchestrator/policy.ts` 根据目标、授权、观察与预算产生常规 action。
4. Runtime 并发执行计划，Provider adapter 只做协议与事实转换。
5. FinalGuard 统一裁决主推荐/候补，ResultAssembler 只映射 guarded result。
6. API 保存运行状态并发送 `final`、`question` 或类型化 `error` 事件。

模型角色不是独立 subagent，也不拥有工具循环。这样保留了开放世界语义能力，同时让预算、
授权、Provider 保护和发布边界保持可复现、可测试。

## 持久化与身份

| Data | Authority | Lifetime / boundary |
| --- | --- | --- |
| 转盘历史和偏好 | 浏览器 `localStorage` | 用户本机；最多 100 条 |
| Agent session、消息、runtime state | Cloudflare D1 | 由 `expires_at` 管理 |
| 匿名 owner | 签名 HttpOnly Cookie + session `owner_id` | 只允许访问自己的会话 |
| Provider token/lease | Durable Object | 短期容量协调，不执行外部请求 |
| Eval POI | `evals/fixtures/amap.json` | 手工构造，禁止真实 Provider 数据 |

D1 migrations 是会话 schema 的唯一迁移入口。正常生产部署先应用远程 migration 再上传
Worker；dry-run 和构建不能修改远程数据库。

## Cloudflare 生产拓扑

`worker.ts` 在最外层执行公网 HTTP 到 HTTPS 的 308 升级并导出
`ProviderSchedulerDurableObject`。OpenNext Worker 使用：

- D1 binding `CHISHA_DB` 保存会话；
- Durable Object binding `PROVIDER_SCHEDULER` 协调 active run、session 与各 Provider；
- 原生 Rate Limiting bindings 处理廉价入口反滥用；
- Worker secrets 保存高德、模型和 owner 签名凭证；
- assets binding 提供静态资源。

Vercel 或普通 Node 可以用于本地/私有实验，但缺少这些 Cloudflare binding 时不满足当前
公网保护拓扑。公开部署到其他平台前必须先提供等价的跨实例会话、容量和限流实现，并形成
新的技术决策与 Spec 更新。

## 质量边界

- Jest/Testing Library 锁定模块和 API 分支，deterministic eval 锁定一轮 workflow 的总
  搜索与评估行为；真实模型语义质量仍需可审查 trace 或独立线上评测。
- GitHub CI 只做无生产凭证的质量检查和 Cloudflare dry-run。生产发布由 Cloudflare Git
  集成负责，直到仓库明确迁移到受保护的 GitHub environment。
- 文档、配置和路由通过 `docs:check`、agents-spec guard 以及常规静态检查保持同步。
