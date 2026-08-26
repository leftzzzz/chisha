# CI/CD 质量门禁与发布隔离

## 适用范围

本 Spec 约束 GitHub Actions、Jest 覆盖率、Cloudflare 可部署性验证、Workers Builds 分支触发
和生产发布责任边界。

## GitHub CI

- CI 在 pull request 和 `main` push 上运行；同一 workflow 与同一 ref 只保留最新运行。
- workflow 顶层权限保持 `contents: read`，普通 CI 不配置生产供应商或部署 secret。
- quality job 必须依次执行 `npm ci`、`npm run docs:check`、`npm run test:docs`、type-check、
  lint、`npm run test:ci` 和 deterministic `npm run eval`。
- cloudflare-validation job 必须依赖 quality 成功，使用独立 checkout 和依赖安装，然后执行
  `npm run build:cloudflare` 与 `npm run deploy -- --dry-run`。
- 任一命令非零退出都必须使 job 失败；不得用 `continue-on-error` 把门禁改成提示。
- PR CI 不得执行远程 D1 migration、非 dry-run 的 `wrangler deploy`、
  `wrangler versions upload` 或任何真实模型/地图供应商请求。

## 覆盖率

- `npm run test:ci` 是 CI 单测入口，必须开启 coverage；日常 `npm test` 可继续用于快速测试。
- 全局 statements、branches、functions、lines 阈值的唯一真源是 `jest.config.js`。
- 70% 是目标。当前阈值必须不高于全量测试实测值并真实在 CI 生效；正常变更不得下调。
- `.next`、`.open-next`、coverage 输出和工具自身目录不得进入测试发现或覆盖率收集。
- 不得仅为提高数字排除可执行业务代码、删除有效断言或新增不验证行为的测试。

## 测试责任

- 公网 API 的兼容映射、输入拒绝、限流、稳定 HTTP 状态和 AbortSignal 传递必须有路由级单测。
- `ProviderSchedulerDurableObject` 的持久化与失败关闭必须有对象边界测试；调度算法由
  `providerSchedulerCore` 测试覆盖。
- Agent 语义改动必须同时通过相关单测和 `npm run eval`。桩 eval 只证明 workflow 行为
  预算，不证明真实模型决策质量。
- 普通 CI 的测试必须可在无 `.env.local`、无生产 API Key 和无外网供应商调用时通过。

## Cloudflare 与发布

- Cloudflare Workers Builds 的 production branch 只能是 `main`，non-production branch
  builds 必须关闭。该设置属于 Cloudflare 控制面，不能从 `wrangler.jsonc` 推断已生效。
- PR 上的 Cloudflare connected build 若仍存在，表示分支触发隔离尚未完成；上传的 Worker
  Version 不等于 production deployment，但仍是不应发生的远程副作用。
- 当前生产发布的唯一责任方是 Cloudflare `main` connected build。不得在没有安全 token、
  受保护 environment 和迁移方案时另增 GitHub production deploy job。
- 当前 Cloudflare 发布不会等待 GitHub Actions；文档、PR 或发布记录不得声称 GitHub CI 已
  严格门禁生产，除非发布责任迁移已经完成并有配置证据。
- Cloudflare dry-run 必须跳过远程 D1 migration；真实部署继续由部署 wrapper 先应用 D1
  migration，再调用 Wrangler 发布。

## 变更验证

- 普通代码变更至少通过 quality job。
- Worker 入口、OpenNext、binding、migration、部署脚本或依赖变更必须同时通过
  cloudflare-validation。
- CI/CD 配置变更必须检查 workflow diff、执行本地对应命令，并在 PR 上观察真实 Actions
  结果；Cloudflare branch filter 还必须用新 PR 的检查列表与构建历史验证。
