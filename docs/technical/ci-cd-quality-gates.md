# CI/CD 质量门禁与发布隔离技术方案

## 状态

接受，2026-08-19。产品验收见
[`../requirements/ci-cd-quality-gates.md`](../requirements/ci-cd-quality-gates.md)，当前强制契约见
[`../specs/ci-cd-quality-gates.md`](../specs/ci-cd-quality-gates.md)。

## 现状与根因

`.github/workflows/ci.yml` 只有一个 job。普通 `npm test` 不收集覆盖率，所以 Jest 中声明的
70% 阈值没有被执行；OpenNext 与 Wrangler 配置也不在 CI 验证范围内。

Cloudflare Workers Builds 是仓库外的第二套触发器。它会监听 GitHub 分支并执行 connected
build：PR 分支上传的是 Worker Version，不会改变 production deployment。由于本 Worker
包含 Durable Object，Cloudflare 不为该分支生成可用 preview URL。用户看到的“Cloudflare
Workers Builds”检查因此容易被理解为一次部署，但实际上是无流量版本上传。

GitHub 仓库当前没有 Secrets、Variables 或 deployment environment。Cloudflare 生产构建也
不会等待 GitHub Actions。因此直接增加一个 GitHub deploy job 既无法鉴权，也会制造两个
生产发布责任点。

## 架构决策

### 流水线分层

```text
pull request
  -> GitHub quality
       type-check -> lint -> Jest coverage -> deterministic Agent eval
  -> GitHub cloudflare-validation (needs quality)
       OpenNext build -> Wrangler deploy --dry-run
  -> no remote mutation

main push
  -> same GitHub validation (quality evidence)
  -> Cloudflare connected production build/deploy (independent owner)
```

GitHub Actions 拆成两个 job。第二个 job 使用全新 checkout 和 `npm ci`，既能证明构建不依赖
前一个 job 的未跟踪产物，也避免 `.next/standalone/package.json` 被 Jest haste map 误识别为
第二个同名 package。两个 job 都设置超时和只读仓库权限。

两个 job 都通过根目录 `.node-version` 选择 Node.js。2026-09-18 升级到
`@opennextjs/cloudflare@1.20.6` 和 `wrangler@4.134.0` 后，Wrangler 明确要求 Node.js 22；
同一文件也供 Cloudflare Workers Builds 读取，避免本地、GitHub CI 与 connected build
使用不同主版本。

`cloudflare-validation` 先执行 `npm run build:cloudflare`，再执行
`npm run deploy -- --dry-run`。后者复用已生成的 `.open-next/worker.js` 并验证 Worker 入口、
assets、Durable Object migration、D1 和 Rate Limit bindings；部署 wrapper 看到 `--dry-run`
时必须跳过远程 migration。

### 覆盖率门禁

新增单一 CI 测试命令 `npm run test:ci`，固定为 Jest CI 模式、串行执行并开启 coverage。
GitHub workflow 不复制 Jest 参数，阈值继续以 `jest.config.js` 为唯一真源。

初次基线按变更完成后的全量实测值向下取整，四项指标分别设阈值。这样会阻止无测试代码
持续稀释覆盖率，但不会因历史欠账一次性冻结所有 PR。70% 继续作为提升目标；新增重要业务
模块时优先通过局部测试提高基线，不能扩大 `collectCoverageFrom` 排除项来绕过门禁。

Jest 的 path ignore 同时排除 `.next` 与 `.open-next` 生成目录，保证开发者先构建再测试时也
不会产生模块名冲突。

### 新增回归测试

| 边界 | 测试责任 | 不测试的内容 |
| --- | --- | --- |
| `/api/agent/search` | 旧 `query` 到主链路 `message` 的映射、header/字段保留、非法 JSON、GET 405 | 重复主 Agent Runtime 行为 |
| `/api/geocode` 与 `/api/geocode/reverse` | 校验、限流、AbortSignal 传递、错误码到 HTTP 状态映射 | 真实高德网络响应 |
| `ProviderSchedulerDurableObject` | SQL 建表、状态写回、alarm、跨调用 lease、损坏状态失败关闭 | 已由 core 测试覆盖的 token bucket 数学细节 |

所有外部依赖使用明确 mock。API 路由测试使用 Node test environment，避免浏览器 polyfill 改变
Request/Response 语义。

### Cloudflare 分支构建

Workers Builds 的 branch filter 是 Cloudflare 控制面配置，`wrangler.jsonc` 不能声明它。
项目设置必须调整为：

- production branch 为 `main`；
- non-production branch builds 设为关闭，或用 include/exclude 规则确保任何 PR head branch
  都不触发；
- 合并后用一个新 PR 核验只有 GitHub `CI` 检查，没有 Cloudflare connected build。

当前 Wrangler OAuth 权限可以部署 Worker，但不能读取或修改 Workers Builds trigger；因此该
设置必须由拥有 Workers Builds Configuration 权限的账号在 Cloudflare Dashboard 或 API 中
完成。仓库改动不能伪造这项完成状态。

### 后续生产门禁迁移

若要让生产发布严格等待 GitHub CI，应在独立变更中完成以下前置条件：

1. 创建仅允许目标 Worker、目标 D1 所需动作的 Cloudflare API token；
2. 保存到受保护的 GitHub production environment，并配置审批/分支限制；
3. 增加 `needs: [quality, cloudflare-validation]` 的 deploy job；
4. 验证 D1 migration 与部署成功后，关闭 Cloudflare Git integration，保持单一发布责任点；
5. 为失败 migration、失败 deploy 和回滚分别建立可审计操作手册。

在这些条件满足前，GitHub CI 是合并质量证据，不宣称它与 Cloudflare 发布严格串行。

## 失败与回滚

- quality 失败：修复类型、lint、测试、覆盖率或 eval 回归；不得让 build job继续运行。
- Cloudflare validation 失败：根据 OpenNext 或 Wrangler 输出修复配置；dry-run 不能改远程状态。
- PR 仍触发 Cloudflare build：回滚或修正 Cloudflare branch filter，不通过增加仓库内 deploy
  workflow 规避。
- CI 运行时间不可接受：先根据 job 时序定位瓶颈；不得删除覆盖率、eval 或 dry-run 门禁。
- workflow 语法错误时可回滚 `.github/workflows/ci.yml`，测试命令和文档仍可独立使用。
