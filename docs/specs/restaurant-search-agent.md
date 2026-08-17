# Restaurant Search Agent Spec

本 Spec 适用于 `lib/agent/**`、`app/api/agent/**`、`evals/**`、
`__tests__/lib/agent/**` 以及 Restaurant Search Agent 架构文档。

完整的架构理由和迁移方案见
[`../technical/agent-architecture-root-decision-2026-08.md`](../technical/agent-architecture-root-decision-2026-08.md)，
产品目标和验收标准见
[`../requirements/restaurant-search-agent.md`](../requirements/restaurant-search-agent.md)。

## 当前实现边界

- 当前 `runSearchAgentV3` 是确定性 workflow：`orchestrator/policy.ts` 决定常规
  action，模型只执行局部语义任务。
- 目标 Agent 架构尚未落地。任何改动必须明确是在维护当前 workflow，还是在推进
  目标 Agent；不能把目标组件描述成当前事实。
- 新增行为不得继续扩大菜品、菜系、品牌、地域叫法或失败 query 的语义特判集合。

## 目标命名

- 架构模式称 `orchestrator-worker pattern`。
- 主 Agent 固定命名为 `RestaurantSearchLeadAgent`，通用角色称 `lead agent` 或
  `main agent`。
- 下级是 `specialized subagents`，具体名称使用 `<Domain>Subagent`。
- 子 Agent 调用入口是统一、模型可见的 `Agent` tool。
- 执行基础设施称 `Agent Runtime`，内部拆分 guard、limits、scheduler、session、
  trace 和 child-run lifecycle。
- `ManagerAgent`、`OrchestratorAgent`、`SearchSupervisorAgent` 或 `Policy` 不得作为
  目标主 Agent 名称。旧代码中的同名概念只表示迁移前事实。

## Agent 资格与模型调用命名

- `Agent` 只指由 Runtime 驱动、能够在多轮 model-tool loop 中自主选择动作、观察工具
  结果并决定继续或结束的执行主体。Lead Agent 和 subagent 都必须满足这个定义。
- 一次强制结构化输出的模型请求不是 Agent，即使它通过 prompt 扮演一个特定角色。
  当前 `KeywordExpansionAgent`、`EvaluationAgent`、`GoalUnderstandingAgent`、
  `SearchReplanAgent` 和 `callJsonFunctionAgent` 都是迁移前的历史命名，不能据此声称已经
  实现 Agent 或 subagent。
- 单次结构化模型调用的目标公共名称固定为 `callStructuredModel`；仍需保留的一次性
  模型角色使用 `<Purpose>Model`，真实子 Agent 才使用 `<Purpose>Subagent`。
- 单次调用的日志和指标维度使用 `modelRole` 或 `operationName`，不得继续用
  `agentName` 把模型角色伪装成 Agent。
- `callStructuredModel` 最多是 Runtime 可复用的单次模型请求能力。完整 Agent 必须由
  Runtime 反复推进 assistant/tool-call/tool-result 循环；不得把公共调用器本身描述为
  Agent Runtime 或 Agent loop。

## Lead Agent 与 Subagent

1. `RestaurantSearchLeadAgent` 是唯一全局语义决策者，负责用户目标、计划、任务拆分、
   下一动作、搜索与目标的关系、是否补证/追问/结束以及最终综合。
2. 简单任务默认由 Lead Agent 直接调用 Domain tools 完成。只有可以独立探索或验证、
   适合并行，或确实需要不同 instructions、工具或模型的任务才委派 subagent。
3. Subagent definitions 由 Runtime 静态注册；Lead Agent 根据 definition 的
   `description` 通过 `Agent` tool 动态创建 subagent instances。运行时不得动态发明
   Agent 类型，也不得由代码固定 GoalUnderstanding -> KeywordExpansion -> Evaluation
   -> Replan 顺序。
4. 每个 subagent 必须有独立上下文、明确 task、专用 instructions、受限工具集、
   `maxTurns`、成本上限和结构化输出。它不能修改全局 UserGoal 或做最终推荐。
5. Lead Agent 必须综合 subagent 的压缩 findings/evidence，并对继续委派、追问或结束
   保持最终责任。

## Agent Tool Handler

- 模型传输层继续使用 OpenAI-compatible endpoint；目标架构不依赖 Claude Agent SDK
  或 Anthropic 模型。
- Runtime 必须实现与 Claude Code subagent 行为一致的 `Agent` tool handler：模型可见
  的统一入口、definition-based selection、独立 child context、受限 tool loop、结构化
  result、child run id、预算和 trace。
- `Agent` tool handler 只执行 Lead Agent 已发出的调用，不决定何时委派或调用哪个
  subagent。
- 模型客户端必须支持完整的 assistant/tool 循环，不能把一次强制 JSON function call
  当成 Agent loop。上线前必须通过目标 OpenAI-compatible endpoint 的 tool-calling
  capability eval。

## Subagent Task Snapshot

第一版委派使用自包含、不可变快照，不使用 `goalSliceIds`、`knownEvidenceRefs` 等要求
subagent 回读共享可变状态的间接引用。

```ts
interface SubagentTaskSnapshot {
  taskId: string;
  objective: string;
  goalSnapshot: UserGoal;
  authorizationSnapshot: AuthorizationSnapshot;
  location: Location;
  attemptSummary: SearchAttemptSummary[];
  candidateFacts?: RestaurantCandidateFact[];
  excludedScope: string[];
  successCriteria: string[];
  outputSchemaVersion: string;
  budget: SubagentBudget;
}
```

只有真实 payload 超出评测确定的上下文预算后，才允许引入只读 artifact store；不得先用
不透明 id 缩短 task brief。

## Runtime 与 Policy

- `Policy` 不是目标架构组件。开放世界 semantic planning 迁入 Lead Agent；现有
  `policy.ts` 中仍需保留的确定性逻辑拆入 Runtime 的 guard、limits、scheduler 和
  authorization，不得整体堆进一个巨型 `runtime.ts`。
- Runtime 负责 Agent/tool loop、schema、鉴权、预算、超时、重试、并发、幂等、
  parent-child task tree、checkpoint/resume、取消、部分失败、状态持久化和 trace。
- Runtime 可以拒绝非法动作，但不能把它改写成语义不同的“合法动作”。
- 硬距离、明确排除项、停业、安全与用户授权是 Runtime 可执行的确定性边界，任何
  Agent 和工具都不能绕过。

## Domain Tool Contract

Lead Agent 和 Search subagent 只接触少量、面向任务的高层 Domain tools。地点召回只
暴露自然语言搜索工具：

```ts
interface SearchPlacesInput {
  query: string;
  location: Location;
  radiusMeters: number;
  relation: 'exact' | 'equivalent' | 'broader' | 'alternative';
  filters?: {
    openNow?: boolean;
    maxAveragePrice?: number;
  };
}
```

- 不得向 Agent 暴露 `lookup_place_categories`、`list_place_categories`、
  `CategoryRegistry`、`categoryRef`、POI typecode 列表或任何
  `natural-language -> provider-code` 步骤。
- `search_places.query` 必须保留 Agent 给出的自然语言，不得通过 taxonomy、子串、别名
  表或 Adapter 静默改写。
- Amap adapter 固定使用 `keywords = query`、`types = 050000`。`050000` 只限定本产品
  搜索餐饮场所，是稳定 Provider 范围配置，不表达菜品、菜系或目标匹配。
- Amap、OSM 等 Provider adapter 只做协议转换、分页、超时和无损字段规整，不做用户
  意图、broaden、搜索方向或候选资格判断。
- 高德分类码表只能把返回的 `typecode` 解释为 Provider 事实，例如
  `050202 -> 日本料理`；不得反向参与搜索 planning，也不能证明餐厅提供寿司。
- 第一次搜索不足时，由 Lead Agent 产生新的自然语言 action。任何 `broader` 或
  `alternative` action 都必须显式记录 relation、rationale 和用户授权，不能由 Runtime
  或 Adapter 自动生成。

每个搜索 action 至少包含：

```ts
interface SearchAction {
  id: string;
  query: string;
  supportsGoalIds: string[];
  relation: 'exact' | 'equivalent' | 'broader' | 'alternative';
  rationale: string;
  authorizationRef?: string;
}
```

- `allowedForPrimary` 不属于 Agent 产生的 `SearchAction`。Runtime 必须根据 action 的
  `relation` 和授权记录派生搜索范围资格，模型不能直接声明或覆盖该结果：

```ts
const primaryScopeAuthorized =
  action.relation === 'exact'
  || action.relation === 'equivalent'
  || authorizationCovers(action.authorizationRef, action);
```

- `authorizationCovers` 必须校验授权引用确实覆盖当前 goal、relation 和 action scope；
  引用缺失、失效或范围不匹配时返回 `false`。
- `primaryScopeAuthorized` 只表示 action 的搜索范围是否可用于主推荐，是候选准入的必要
  非充分条件。候选仍必须通过证据验证、硬约束和 FinalGuard，不能仅凭该派生值进入
  主推荐。
- `SearchAction.id` 是 trace、observation 和授权关联使用的稳定标识；Runtime 接受 action
  时分配并持久化，模型不负责生成技术 id。

## Goal、授权与证据

- UserGoal 必须保留用户原始表达和全部显式约束。派生搜索只能成为新 action，不能
  覆盖 UserGoal；多轮修改生成新版本并记录来源。
- `broader/alternative` 不能因搜索失败自动获得主推荐资格，必须存在用户预先授权或
  一次显式追问的授权记录。
- 召回 query、Provider category 和目标证据是三个不同概念。搜索命中和 POI category
  只能作为召回或候选事实，不能直接证明菜品供应。
- Verification subagent 只返回 `supported`、`contradicted` 或 `unknown` 及证据来源。
  菜单项、商家页面或其他可追溯资料可以支持菜品结论；仅有“高德归类为日本料理”时，
  “提供寿司”仍为 `unknown`。
- FinalGuard 只能删除、降级或分区，不能把 `unknown/unverified` 提升为 `supported` 或
  主推荐。证据不足的候选只能进入明确标注的不确定候补。
- Observation 和 evidence 必须记录 action id、Provider、原始 query、Provider 参数、
  来源、获取时间和可追溯原始事实。

## 仍然生效的运行契约

- 模型或候选验证不可用时必须显式失败，不得用本地语义词表静默伪造模型结论。
- 错误码在抛出点使用 `AgentError` 类型化；消费端不得匹配错误 message 猜类型。
- 追问选项使用稳定 id：`optionEffects` 的 key 是 `option.id`，前端回传 id，label 只
  用于展示。

## 禁止的实现方式

- 不得为单个菜品、菜系、品牌、地域叫法或失败 query 新增生产 `if`、正则、别名或
  taxonomy 词条来改变决策、搜索或准入。
- 不得用子串词表做有损语义归一或丢弃未知修饰词。
- 不得把 prompt 中的开放世界语义规则机械搬到 TypeScript 常量。
- 不得把 Provider 分类目录包装成 Agent 搜索工具或让 Agent 选择 typecode/ref。
- 不得让 FinalGuard、结果装配器、Runtime 或 Adapter 重新决定用户意图、broaden
  关系、搜索方向或证据状态。
- 不得把固定 action 序列、planner 模型调用为零或单个 golden case 通过当作 Agent
  质量证明。

允许的确定性逻辑包括 Unicode/空白规整、精确去重、schema 校验、数值边界、安全与
合规、用户明确授权检查、固定的 Provider 产品范围，以及不增加语义结论的过滤。

## Eval 要求

- 现有模型桩 + fixture eval 只证明 Runtime/workflow 回归，不证明真实模型质量。
- Agent eval 必须检查工具选择、自然语言 query、relation、授权、证据、停止原因和最终
  分区，并覆盖目标 OpenAI-compatible endpoint。
- 必须分别评测 Lead-only 和 Lead + subagents，只有独立探索带来的质量收益超过延迟、
  token 和失败面成本时才启用委派。
- 多 Agent eval 必须检查调用时机、subagent description 选择、task snapshot 完整性、
  重复/空洞委派、child failure 和 Lead 综合质量。
- 评测集覆盖 typical、edge、adversarial、生产分布和 metamorphic/property cases：
  同义改写、修饰词/排除项追加、工具结果重排、证据删除、未授权 broaden。
- 新增具体菜名 eval 时，生产代码不得同步增加对应语义词条。

## 变更前检查

1. 这是事实/安全/Provider 协议，还是开放世界语义判断？
2. 是否保留用户原始目标、自然语言 query 和全部修饰词？
3. 是否出现分类目录、taxonomy 或 Adapter 对语义的静默改写？
4. 是否有任何 `unknown` 被提升？
5. Subagent 是由 Lead Agent 通过 `Agent` tool 动态选择，还是代码固定调用？
6. 简单任务是否被不必要地委派？
7. 测试锁定的是通用不变量还是单个样例？
8. PR 是否说明当前 workflow 维护与目标 Agent 迁移的边界？

相关契约改动至少运行适用的 Agent 单测、`npm run eval` 和文档结构检查。
