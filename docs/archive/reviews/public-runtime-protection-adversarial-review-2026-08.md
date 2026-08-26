> 状态：历史归档。仅用于追溯，不是当前实现依据。

# 公网运行保护文档对抗性审查（2026-08）

## 审查范围

- `docs/requirements/public-runtime-protection.md`
- `docs/technical/provider-capacity-scheduling.md`
- `docs/specs/public-runtime-protection.md`

审查假设攻击者可以轮换 IP、伪造普通代理头、猜测 session id、并发重放请求、主动断开
SSE，并能在上游额度耗尽期间持续请求；同时假设 Worker 会被中断或迁移、DO 会被驱逐、
供应商响应可慢于常规租约时长。

## 发现与处理

| 级别 | 攻击或故障 | 原方案缺口 | 处理结论 |
| --- | --- | --- | --- |
| P0 | 新匿名用户建立 SSE 后才创建会话 | 流开始后不能可靠补写 `Set-Cookie`，新会话无法安全绑定 owner | owner 在返回 Response 前生成；所有准入与 lease 也前移到 SSE 建立前 |
| P1 | 上游调用或 Agent turn 超过固定 lease TTL | DO 会误回收仍在使用的名额，实际并发突破上限 | 增加 renew；调用方定期续租，alarm 只清理失联 lease |
| P1 | 攻击者用无效 session id 占满全局运行名额 | 若先拿 global lease 再查 owner，廉价越权请求能挤压正常用户 | 已有会话先 owner 校验和 session lease，再拿 global lease |
| P1 | 同 session 并发请求 | D1 整行 upsert 最后写入覆盖前一轮状态 | 每个 session 独立 DO lease，跨 Worker 互斥 |
| P1 | 高德配额耗尽后每次请求继续撞上游 | 重试虽被禁止，但每个新请求仍会产生一次失败和 fallback storm | 持久化 `blockedUntil`，冷却后有限探测，补包后自动恢复 |
| P1 | 高德故障导致所有流量涌向 OSM | fallback 成为新的公共服务滥用源 | OSM 独立低速率、低在途调度域 |
| P1 | 轮换 IP 或伪造 `X-Forwarded-For` | IP 限流不能保护共享账单且可被错误取值绕过 | 可信 CF 头优先；账单保护依赖 global/provider lease，不依赖 IP |
| P1 | 随机枚举 session GET/DELETE | owner 能阻止泄露，但无界查询仍消耗 D1 | 增加独立 session API 入口限流，未找到与无权统一响应 |
| P2 | 多个等待者按相同间隔轮询 acquire | 容量恢复时形成同步重试尖峰 | caller-side 等待加入 jitter；总等待硬上限 5 秒 |
| P2 | 严格 FIFO 依赖 DO 内存等待队列 | DO 驱逐会丢等待者，长队列不适合同步 SSE | 不存等待 Promise，明确 short wait 为 best-effort |
| P2 | 旧 D1 会话没有 owner | 第一位知道 id 的访客可能“认领”旧会话 | 旧会话一律不可访问并自然过期，不做自动认领 |
| P2 | 本地 HTTP 无法写 Secure Cookie | 本地开发会反复生成 owner，掩盖真实流程 | Secure 仅生产强制，本地仍启用 HttpOnly/SameSite |

## 保留风险

1. 匿名 Cookie 不是账号体系；清除 Cookie 或跨设备后不能恢复旧会话。这是本期明确接受的
   产品限制。
2. caller-side 短等待不保证公平，极端竞争下个别请求可能连续被拒绝；`Retry-After` 与前端
   重试承担恢复体验。需要严格公平或必达时必须升级为异步 job 协议。
3. 同 session lease 只约束当前公网入口。未来新增后台 session 写入者时，必须同时接入该
   lease 或为 D1 增加 revision CAS。
4. 阿里云 RPM/TPM 在控制台数值未知时不能被代码凭空确认；本期先用全局在途上限，取得真实
   限额后配置速率维度并通过指标校准 token 估算。

## 审查结论

上述 P0/P1 缺口已回写需求、技术文档和 Spec。文档可以作为实现基线；实现审查必须逐项
验证本表的攻击路径，而不能只验证正常请求。
