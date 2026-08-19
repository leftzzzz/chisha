# Technical Documents

`docs/technical/` 记录架构、实现方法、权衡、迁移顺序和技术决策理由。开始实现前先读取
相关 requirement 和 technical decision，再以 `docs/specs/` 校验当前必须遵守的边界。
技术文档解释“为什么和怎么做”，不替代当前 Spec。

搜索方式：

```bash
rg -n "组件名|方案|权衡|迁移" docs/technical docs \
  --glob '*.md' --glob '!specs/**' --glob '!requirements/**'
```

## Active Decisions

- [Agent 架构根治决策（2026-08）](./agent-architecture-root-decision-2026-08.md) -
  orchestrator-workers、Claude Code 风格 Handler、Runtime、自然语言地点搜索、证据模型
  和迁移方案。
- [Runtime FinalGuard 与结果装配](./runtime-final-guard.md) - Runtime 完成协议、单调
  FinalGuard、纯 ResultAssembler、UI 发布边界和迁移期实现方案。
- [供应商容量调度与公网运行保护](./provider-capacity-scheduling.md) - Durable Object 容量协调、
  Agent fanout 分层、短等待、会话归属、故障降级和发布方案。
- [百炼模型角色分流与迁移（2026-08）](./aliyun-model-routing-2026-08.md) - 结构化模型的
  角色默认值、配置优先级、非思考工具调用、指标、灰度和回滚方案。

历史 review、实施方案和完成报告继续保留在 `docs/` 与 `docs/archive/`，用于理解当前代码
来源；文件顶部的状态说明决定其是否仍可作为实现依据。
