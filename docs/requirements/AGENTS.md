# Requirements

`docs/requirements/` 记录产品要解决的问题、用户需求、验收标准和已接受的产品决策。
实现新功能前先检索相关 requirement，再阅读 `docs/technical/` 的方案和 `docs/specs/` 的
当前强制边界。Requirement 不替代 Spec。

搜索方式：

```bash
rg -n "用户场景|能力|验收条件" docs/requirements --glob '*.md'
```

## Current Requirements

- [ChiSha 业务规则与产品边界](./chisha-product-rules.md) - 输入、位置、转盘、候补、历史
  和跨功能用户交互的当前业务规则。
- [Restaurant Search Agent](./restaurant-search-agent.md) - 自然语言搜索、范围授权、证据
  分区和当前 workflow 行为的产品要求。
- [最终推荐发布边界](./final-recommendation-publication.md) - 主推荐最终准入、候补分区、
  顺序保真和禁止下游自动补位的产品要求。
- [公网运行保护与供应商容量管理](./public-runtime-protection.md) - 公开使用时的并发、短等待、
  上游额度、匿名会话和线上验收要求。
- [百炼模型成本与延迟优化](./aliyun-model-cost-latency.md) - 百炼模型迁移、角色分流、成本、
  延迟、可观测性和正式切流验收要求。
- [CI/CD 质量门禁与发布隔离](./ci-cd-quality-gates.md) - PR 无副作用验证、覆盖率防回退、
  Cloudflare 分支触发和生产发布责任边界。

## Pending Review

- [Agent 架构改进需求](./agent-architecture-improvement.md) - 待评审的目标保真、证据、
  推荐效用和业务评测改进清单；不代表功能已经实现或新规则已经生效。

历史需求统一保留在 `docs/archive/`，用于追溯已有产品决策，不自动覆盖当前 Spec。
