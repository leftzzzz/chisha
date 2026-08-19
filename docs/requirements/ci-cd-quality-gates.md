# CI/CD 质量门禁与发布隔离

## 状态

已接受，2026-08-19。

## 背景

仓库已有 GitHub Actions CI，但 PR 只执行类型检查、lint、普通 Jest 和 Agent eval：

- `jest.config.js` 声明了 70% 全局覆盖率目标，CI 却没有启用 coverage，因此该阈值从未
  形成门禁；当前代码直接执行 coverage 会失败，不能把 70% 描述成已达到的事实。
- CI 没有验证 OpenNext Cloudflare 构建，也没有执行 Wrangler dry-run，因此 Worker 入口、
  Durable Object、D1、Rate Limit binding 与静态资源配置只能到发布时才暴露错误。
- Cloudflare Workers Builds 的 Git 集成会为 PR 分支运行 connected build 并上传 Worker
  Version。该 Version 不会自动获得生产流量；本项目包含 Durable Object，也没有可用的
  分支预览地址，所以这类 PR 构建只有成本和误导，没有可用的预览价值。
- Cloudflare connected build 与 GitHub Actions 相互独立。仅仅把 GitHub CI 变绿，不能
  声称它已经门禁 Cloudflare 的生产发布。

## 目标

1. PR 只执行确定性、无外部副作用的质量检查，不上传 Worker Version、不执行远程 D1
   migration，也不需要生产 API Key。
2. 类型检查、lint、单测覆盖率、Agent 行为评测、OpenNext 构建和 Wrangler 配置校验都成为
   可见且失败即阻断的 CI 检查。
3. 覆盖率先以仓库当前可达到的真实基线形成防回退门禁，再通过新增有效测试逐步提高到
   70%，不得用排除业务代码或空洞测试制造数字。
4. 为当前未覆盖的公网 API 兼容边界、地理编码错误映射和 Durable Object 持久化边界补充
   回归测试。
5. 生产发布保持单一责任方；在没有安全部署凭据和受保护 environment 前，不在 GitHub
   Actions 中复制一条并行生产发布链路。

## 已接受的产品决策

### PR 与主分支

- GitHub Actions 在 PR 和 `main` push 上运行相同的质量与 Cloudflare 可部署性验证。
- PR 流水线不得执行非 dry-run 的 `wrangler deploy`、`wrangler versions upload`、远程 D1
  migration 或真实供应商接口。
- Cloudflare Workers Builds 只允许 `main` 触发生产构建；非生产分支构建必须在 Cloudflare
  Build branches 设置中关闭。控制台设置不在 Git 仓库中，必须以合并后 PR 检查列表和
  Cloudflare 构建历史作为验收证据。
- 当前生产发布仍由 Cloudflare Git 集成负责。GitHub Actions 没有 Cloudflare deploy token，
  且私有仓库当前套餐不能配置 required status checks，因此本期不声称 GitHub CI 严格串行
  门禁生产部署。

### 覆盖率

- CI 必须执行带 coverage 的 Jest 命令，并由 `jest.config.js` 中的全局阈值决定成败。
- 70% 是持续提升目标，不是当前完成状态。首次启用门禁时采用不高于实测结果的整数下限；
  后续正常变更不得降低阈值。
- 如确需降低阈值，必须在同一变更中说明覆盖率下降原因、影响代码和恢复计划。

### 测试边界

- API 测试必须覆盖输入校验、限流或方法拒绝、下游参数传递和稳定错误状态映射，不调用真实
  高德或模型接口。
- Durable Object 测试必须覆盖状态建表、跨调用持久化、alarm 调度和损坏状态失败关闭；
  纯调度算法继续由 `providerSchedulerCore` 单测负责。
- Agent Runtime 语义改动除单测外仍必须执行 `npm run eval`；桩评测不代表真实模型质量。

## 验收标准

1. PR 上出现独立的质量检查和 Cloudflare 构建校验；任一步失败时对应 job 失败。
2. 质量检查执行 type-check、lint、带覆盖率门禁的全量 Jest 和 deterministic Agent eval。
3. Cloudflare 校验仅在质量检查通过后执行 OpenNext 构建与 `wrangler deploy --dry-run`，且日志
   明确跳过远程 D1 migration。
4. CI 不读取 `OPENAI_API_KEY`、`AMAP_API_KEY` 或 Cloudflare deploy token，也不产生外部版本、
   deployment 或数据库写入。
5. 覆盖率阈值与实测基线一致，CI 中真实生效；文档将 70% 标记为目标而非已完成指标。
6. 新增单测覆盖 Agent 兼容入口、正反向地理编码接口和 Provider Scheduler Durable Object
   的高风险契约。
7. 同一 PR 新 push 会取消旧的 CI；不同 PR 以及生产发布不会互相取消。
8. Cloudflare 非生产分支构建关闭后，新 PR 不再出现 Cloudflare connected build；若仍出现，
   发布隔离配置尚未验收完成。
9. `main` 仍只有一条生产发布来源，部署脚本继续保证 dry-run 不迁移、真实部署先迁移再发布。

## 非目标

- 本期不把覆盖率一次性补到 70%，不以大量低价值快照测试换取数字。
- 本期不引入依赖真实密钥的端到端供应商测试，也不把 live model eval 放进普通 PR CI。
- 本期不升级现有依赖漏洞；依赖升级应单独评估兼容性并提交。
- 在仓库具备最小权限 Cloudflare token、受保护 GitHub environment 和可用 required checks
  之前，不把生产发布迁入 GitHub Actions。
