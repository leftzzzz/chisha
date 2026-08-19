# Specs

`docs/specs/` 是当前可执行行为、约束和工程边界的唯一规则源。修改代码前先阅读适用
Spec；不要从 requirement 或 technical 文档推断当前规则。接受新的产品或技术决策时，
必须在同一变更中同步对应 Spec。

通用工程任务规则适用于所有代码、配置、脚本的新增、修改、修复和审查；其完整正文见
[通用工程任务规则](./general-engineering-task-rules.md)。业务目标和验收标准不在此复制，
应从 `docs/requirements/` 的当前需求读取。

搜索方式：

```bash
rg -n "关键词|组件名|文件路径" docs/specs
```

## Spec Index

- [通用工程任务规则](./general-engineering-task-rules.md) - 代码、配置、脚本任务的执行、
  决策优先级、单一真源和验证交付规则。
- [Restaurant Search Agent](./restaurant-search-agent.md) - Restaurant Search Agent 的
  当前 workflow、模型角色、Policy、Provider、证据、Runtime 和 eval 强制边界。
- [Public Runtime Protection](./public-runtime-protection.md) - 公网入口、匿名会话、跨实例
  Provider 调度、短等待、错误分类和部署验证强制边界。
- [CI/CD Quality Gates](./ci-cd-quality-gates.md) - GitHub CI、覆盖率、Cloudflare 可部署性校验、
  Workers Builds 分支触发和生产发布责任边界。
