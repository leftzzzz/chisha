# Technical Documents

`docs/technical/` 记录架构、实现方法、权衡、迁移顺序和技术决策理由。开始实现前先读取
相关 requirement 和 technical decision，再以 `docs/specs/` 校验当前必须遵守的边界。
技术文档解释“为什么和怎么做”，不替代当前 Spec。

搜索方式：

```bash
rg -n "组件名|方案|权衡|迁移" docs/technical --glob '*.md'
```

## Active Decisions

- [ChiSha 应用架构](./application-architecture.md) - 浏览器、API、Agent、持久化、Cloudflare
  生产拓扑和质量边界的当前技术说明。
- [当前餐厅搜索 Workflow 架构决策（2026-08）](./current-agent-workflow.md) - 当前生效的
  multi-model workflow、模型角色、Policy、Runtime、Provider 和重新评估边界。
- [Runtime FinalGuard 与结果装配](./runtime-final-guard.md) - Runtime 完成协议、单调
  FinalGuard、纯 ResultAssembler、UI 发布边界和当前实现方案。
- [供应商容量调度与公网运行保护](./provider-capacity-scheduling.md) - Durable Object 容量协调、
  Agent fanout 分层、短等待、会话归属、故障降级和发布方案。
- [CI/CD 质量门禁与发布隔离](./ci-cd-quality-gates.md) - GitHub Actions 分层、覆盖率基线、
  Cloudflare dry-run、Workers Builds 分支过滤和后续生产门禁迁移条件。

## Deferred Alternatives

- [Lead Agent / orchestrator-worker 备选方案](./agent-architecture-root-decision-2026-08.md) -
  已评估但暂不采用；仅供未来重新评估，不是当前实现依据或迁移清单。

## Pending Review

- [Agent 架构审查与改进技术方案](./agent-architecture-review.md) - 待评审的现状证据、
  责任边界、数据契约、分阶段实施和验证方案；不替代当前 workflow 决策。

历史 review、实施方案和完成报告统一保留在 `docs/archive/`，仅用于理解当前代码来源，
不作为实现依据。
