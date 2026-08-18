# 公网运行保护实现对抗性审查（2026-08）

## 审查范围

- 公网入口：`/api/agent/chat`、`/api/search`、`/api/agent/session/[id]`
- 调度：Provider scheduler client、Durable Object、token bucket、lease 与 circuit
- 上游：高德、阿里云兼容模型、OSM、超时和取消链路
- 数据边界：匿名 owner Cookie、D1 session migration、同会话写入互斥
- 发布：OpenNext Worker 入口、Wrangler binding、migration wrapper 和生产验收路径

攻击模型包括多 IP 持续请求、同 session 并发重放、伪造代理头、复制或篡改 Cookie、
主动断开 SSE、上游额度耗尽、Worker/DO 中断、租约续期失败、熔断恢复竞争和异常响应体。

## 发现与修复

| 级别 | 发现 | 风险 | 已实施处理与证据 |
| --- | --- | --- | --- |
| P0 | 普通高德成功曾误进入失败分支 | 首次成功后反而触发 `unavailable` 熔断 | 成功与 probe 恢复分支拆开；全量 `amap.test` 回归覆盖 |
| P0 | 高德官方错误码组交叉误判 | `10004/10014` QPS 被当作额度，`10044` 日量被当作 QPS | 按[官方错误码表](https://lbs.amap.com/api/webservice/guide/tools/info)重分 rate/quota/config，并覆盖 HTTP 429、`10004`、`10044` |
| P1 | 普通成功也发送 circuit-success RPC | 放大 DO 流量，额外 RPC 故障可丢弃正常结果 | lease 暴露 `probe`；只有半开探测成功才清熔断 |
| P1 | 旧成功可能清除稍后发生的故障 | 并发响应乱序导致熔断被错误解除 | circuit 保存 `probeLeaseId`，只有当前 probe lease 可清除 |
| P1 | HTTP 响应头到达即释放 Provider lease | 慢响应体期间实际在途数可突破上限 | 高德、模型和 OSM 都在 lease 内消费/缓冲响应体 |
| P1 | Provider lease 续期失败只记录日志 | 失去容量所有权后仍继续调用供应商 | 续期失败中止组合 signal，并映射为类型化可重试故障 |
| P1 | SSE cancel、详情补全和反向地理编码可能吞掉 abort | 客户端离开后继续分页、fallback 或消耗额度 | request/cancel signal 贯穿 Runtime；AbortError 不再被详情或 fallback 吞掉 |
| P1 | 租约丢失走取消分支但不关闭在线 SSE | 客户端保持无心跳悬挂连接 | 区分客户端取消和 admission lease 丢失；后者发送可恢复错误并关闭流 |
| P1 | SSE 先 `controller.close()` 再异步 release admission lease | Cloudflare 可在响应结束后终止请求，已完成会话仍占用 session/active-run 直至 120 秒 TTL；线上连续续接均在 3.5 秒后 429 | release 合并为幂等 cleanup Promise；正常、异常与 cancel 均等待 cleanup，之后才暴露流结束；延迟 release 回归测试锁定顺序 |
| P1 | session DELETE 未参与互斥 | 运行结束可把刚删除的 session 重新写回 | DELETE 取得同一 session lease；API 并发测试验证第二 turn 在 Runtime 前 429 |
| P1 | owner token 只靠浏览器 `Max-Age` 过期 | 被复制的旧 token 可无限期重放 | 到期时间纳入 HMAC，服务端校验并在合法访问时重新签发；生产密钥至少 32 字符 |
| P1 | owner Cookie 与 session 都是 30 分钟 | 长运行结束续期后，Cookie 可能先于 session 过期 | Cookie 调整为 60 分钟并滚动续期，session 保持 30 分钟 |
| P1 | 同批所有 Provider 调用失败被当作零结果 | 故障被误报为“附近没有餐厅”，继续浪费预算 | 保留部分成功；整批失败时抛出首个类型化错误 |
| P1 | 生产接受普通转发头作为客户端 IP | 攻击者可伪造 IP 绕过入口提示限流 | 生产只信任 `CF-Connecting-IP`；缺失时统一进入保守 key |
| P2 | 偏好数组、地址、session id 等字段无界 | 单请求可放大解析、合并和 prompt 体积 | schema 增加数量、长度、坐标和值域上限，并对声明体积做早拒绝 |
| P2 | 新 session 在后续 admission 失败后遗留 | D1 可被失败请求堆积孤儿记录 | 失败路径回收 lease 并删除本次创建的 session |
| P2 | DO 状态解析失败时重置为空 | 状态损坏会清除在途租约和熔断，短时放大流量 | 状态结构异常时失败关闭，不静默重置 |
| P2 | `wrangler deploy --dry-run` 的 custom build 曾执行远程 D1 migration | 只读验证产生生产写入 | migration 移到 deploy wrapper；dry-run 明确跳过。审查期间已发生的一次 `0002` 是可重复、仅新增 nullable 列的迁移 |
| P2 | 首次 DO migration 的 PR Version upload 被 Cloudflare 拒绝 | 预览失败可能被误判为 bundle/binding 故障，或诱导删除必要 migration | 本地真实 Version upload 已复现错误 `10211`：构建、资源上传和 binding 校验后，仅因 Version API 不能应用 DO migration 被拒；发布文档明确要求合并后首次使用非版本化 deploy |

## 验证结果

- `npm run type-check`：通过。
- `npm run lint`：通过。
- `npm test -- --runInBand --silent`：48 suites、425 tests 全部通过；其中两项延迟 cleanup
  测试分别锁定正常 close 顺序与 cancel 后的运行退出顺序。
- `npm run eval`：15/15 通过，搜索步数、关键词、评估调用和并发基线无变化。
- `npm run build`：通过。
- `npm run build:cloudflare`：通过。
- `npm run deploy -- --dry-run`：通过，bundle 中包含 DO、D1、五个 Rate Limiting binding；
  明确输出跳过远程 D1 migration。
- `npm run versions:upload`：D1 无待应用迁移，构建、资源上传与 binding 校验通过；Cloudflare
  Version API 按预期以 `10211` 拒绝尚未通过非版本化部署应用的首次 DO migration。
- 首次线上验收：普通高德搜索、完整 Agent SSE、owner Cookie 同源读取和异源 404 均通过；
  随后连续 session resume 均等待约 3.5 秒返回 429，而 120 秒 TTL 后 DELETE 成功，确认并
  修复了 close-before-release 生命周期缺陷。
- `agents-spec` 结构审计：零错误、零警告。

## 保留风险与上线判定

1. 高德精确 QPS 和阿里云具体模型 RPM/TPM 仍只能在各自控制台确认。代码默认值是安全
   起点，不是账号级配额证据；上线记录必须继续区分二者。
2. 短等待是 best-effort，不保证严格 FIFO。极端竞争下允许 429/503；要实现公平必达必须
   改为异步 job 协议，而不是延长当前 SSE 队列。
3. 匿名 Cookie 仍是 bearer 凭证，不提供跨设备恢复、账号撤销或按用户计费。本期通过 HMAC、
   服务端到期、SameSite、HttpOnly、Secure 和 owner 校验把风险限制在已接受边界内。
4. 首次 DO migration 会让合并前的 Cloudflare Version 预览保持失败；这是 Cloudflare 发布
   模型的引导限制，不是允许忽略的长期红灯。合并后的首次非版本化部署必须成功，之后要
   再验证 Version upload 已恢复。
5. 单元测试验证算法与 API 竞争，Wrangler dry-run 验证绑定和 bundle；真实多 PoP 协调、
   secret 和供应商调用只能在合并部署后的线上验收最终确认。

审查结论：代码层无未处理 P0/P1；可以进入 PR 与生产灰度，但必须完成上述线上验收后才算
目标完成。
