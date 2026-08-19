# 当前餐厅搜索 Workflow 架构决策（2026-08）

> 状态：当前生效。本文记录已接受的生产架构和重新评估条件。
>
> 强制边界以
> [`../specs/restaurant-search-agent.md`](../specs/restaurant-search-agent.md) 为准；
> 产品目标和验收标准见
> [`../requirements/restaurant-search-agent.md`](../requirements/restaurant-search-agent.md)。

## 决策

继续以 `/api/agent/chat` -> `runSearchAgentV3` 的确定性 multi-model workflow 作为当前
生产架构：代码控制阶段和调度，模型在受限位置完成开放世界语义任务，Runtime 负责执行、
资源和发布不变量。

当前不迁移到 `RestaurantSearchLeadAgent`、统一模型可见 `Agent` tool、model-tool loop
或 specialized subagents。缺少这些组件不构成架构缺口，也不能作为 PR 阻塞条件。此前的
orchestrator-worker 设计保留为
[`已评估但暂缓的备选方案`](./agent-architecture-root-decision-2026-08.md)，只有出现本
文列明的重新评估证据后，才通过新的技术决策启用。

## 执行结构

```text
用户输入
  -> Goal understanding model
  -> policy.ts 产生受约束的 action
  -> Runtime 执行搜索、并发和预算控制
  -> Evaluation model 验证候选证据
  -> policy.ts 决定继续、受限 replan、追问或结束
  -> FinalGuard
  -> ResultAssembler
  -> API / UI
```

Keyword expansion model 可以在既定并发边界内提供自然语言搜索建议；Search replan model
只在预设策略不足时提出受 schema、目标、relation、授权和预算约束的新 action。模型角色
不拥有工具循环，也不被称为 subagent。

## 责任边界

| 组件 | 当前职责 | 不得承担 |
| --- | --- | --- |
| 模型角色 | 目标理解、关键词扩展、候选证据判断、受限 replan | Provider code 选择、授权裁决、最终发布准入 |
| `policy.ts` | 有限策略空间内的 action、追问、replan 和停止决策 | 菜品/菜系 taxonomy、query-specific 特判、静默改写目标 |
| Runtime | schema、预算、超时、重试、并发、幂等、会话、持久化、trace、FinalGuard | 产生语义不同的替代 action、提升证据等级 |
| Provider adapter | 协议转换、固定餐饮范围、分页、超时、字段规整 | 用户意图、broaden、菜品匹配和候选资格判断 |
| FinalGuard | 删除、降级、分区、保序精确去重 | 搜索、补位、排序或生成新候选 |

单次结构化模型调用统一视为 model role。公共调用能力使用 `callStructuredModel`，日志使用
`modelRole` 或 `operationName`；不能因为采用 function/tool 形式返回 JSON，就把一次调用
描述为 Agent loop。

## 为什么选择当前架构

餐厅搜索当前的工具集合、阶段和发布约束是有限且稳定的。确定性 workflow 已经具备：

- 自然语言目标理解、搜索建议、证据验证和受限 replan；
- 并行召回、预算和供应商容量控制；
- 会话持久化、恢复、取消、结构化 trace 和失败分类；
- 单调 FinalGuard 与主推荐/候补分区；
- fixture eval、模型分支单测和可审查运行轨迹。

在这些能力能够满足产品目标时，引入 Lead Agent 和 child model-tool loop 会增加上下文
复制、token、延迟、模型兼容性要求、递归预算、child lifecycle 和新的失败面。目前没有
证据证明这些成本能换来稳定的质量收益，因此不以架构纯度替换已经可验证的实现。

这项选择不允许把 workflow 写成按菜名展开的状态机。代码只控制有限的业务阶段和确定性
边界；开放世界语义仍由模型处理，搜索 query 保留自然语言，Provider 分类不反向参与
planning，证据不足不能由下游提升。

## 质量与评测

- `npm run eval` 使用模型桩和 Provider fixture，锁定完整 workflow 的搜索步数、调用量、
  重复评估、事件、缓存、持久化和最终分区。
- 模型角色单测覆盖 schema、目标保真、relation、授权、证据和不可用路径。
- 真实模型或可审查 trace 用于评价开放世界语义质量、成本、延迟和失败率；fixture eval
  不能代替这部分证据。
- 评测集同时覆盖 typical、edge、adversarial、生产分布和 metamorphic cases。新增具体
  菜名 case 时，不得同步向生产代码增加对应词条或分支。

架构质量不以“是否存在 model-tool loop”衡量，也不以固定 action 序列、模型调用为零或
单个 golden case 通过证明；衡量对象是端到端目标保真、证据边界、授权、成本和恢复能力。

## 重新评估条件

只有出现可复现证据，证明下列一项或多项无法通过通用模型契约、工具契约、Runtime 边界
或 eval 改善时，才重新比较当前 workflow 与 Lead Agent/orchestrator-worker 方案：

1. `policy.ts` 为支持正常产品需求持续增长成开放世界语义规则或 query-specific 分支；
2. 新任务要求模型根据未知工具结果反复自主选择不同工具，预定义阶段无法表达；
3. 可并行的独立探索需要隔离上下文，并在质量上显著优于现有并发搜索；
4. 真实模型对拍证明 model-tool loop 的目标保真或证据覆盖收益稳定超过 token、延迟和
   失败率成本；
5. 当前 OpenAI-compatible endpoint 已通过多轮 tool calling、tool result 回填、恢复和
   结构化终止的能力评测。

重新评估必须形成新的 requirement、technical decision、Spec 和对拍报告。不得直接按
旧备选文档的迁移清单开始实现。
