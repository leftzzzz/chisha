# Agent Loop 形态评审（2026-08 第二轮）

> **历史评审，仅作演进记录。** 本文推动系统收敛为确定性 policy 主控 workflow；该
> workflow 后续被接受为当前生产架构。当前生效决策见
> `docs/technical/current-agent-workflow.md`。

> 上一轮 `docs/agent-harness-review-2026-08.md` 审的是 harness 的**工程质量**（双写、观测、降级、清理），P0/P1 已基本落地（见 `44c5dbf`…`f9060f1`）。
> 本轮不重复那些结论，只审一个问题：**这个 loop 的形态对不对**——模型和代码的分工是否放在了正确的位置。

> **后续**：本文的 M1–M4 已落地。文中"顺序策略实现份数 3→1"的问题在
> `conversationMode` 上再次复发，且子 Agent 反向吸收了策略——下一轮针对
> **职责边界**的评审与方案见
> `docs/Agent-职责边界重构-需求文档-2026-08.md` 与
> `docs/Agent-职责边界重构-技术方案-2026-08.md`。
> 文中的 `runtimeV3.ts` / `supervisorPlanner.ts` / `supervisor.ts` 已不存在。

评审日期：2026-08-12
评审范围：`lib/agent/runtimeV3.ts`、`lib/agent/policy.ts`、`lib/agent/supervisorPlanner.ts`、`lib/agent/supervisor.ts`、`lib/agent/guards.ts`、`lib/agent/finalGuard.ts`、`lib/agent/evaluator.ts`、`lib/agent/subagents/**`、`lib/agent/modelClient.ts`、`app/api/agent/chat/route.ts`

参考实践：
- [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)

---

## 1. 本轮的问题意识

从第一性原理出发，一个 agent loop 只有在满足这个条件时才值得存在：

> **下一步该做什么，必须看到上一步的结果才能决定，而且这个决定无法被代码枚举。**

不满足这个条件，loop 就退化成"用一次模型往返换一个代码能直接算出的值"——付了 agent 的延迟、成本和不确定性，拿到的是 workflow 的自由度。

用这条标尺审下来，本项目的判断是：

**上一轮把 harness 修干净了，但 loop 本身不该是现在这个形状。** 循环里那个 Planner 模型的剩余决策权已经窄到不足以支撑它每轮一次的串行往返成本；真正创造价值的三个模型角色（目标理解、关键词联想、候选语义验证）全部是单次调用，与循环无关。

---

## 2. 现状：一次典型查询实际发生了什么

以「想吃火锅」为例（无追问、两轮搜索后结束）：

| # | 步骤 | 位置 | 串行模型步 | API 调用 |
|---|---|---|---|---|
| 1 | Supervisor 理解目标 | `runtimeV3.ts:151` | 1 | 1 |
| 2 | KeywordExpansion 联想词 | `runtimeV3.ts:173` | 1 | 1 |
| 3 | Planner 决策 → search「火锅」 | `runtimeV3.ts:673` | 1 | 1 |
| 4 | Amap 搜索 | `chat/route.ts:249` | — | — |
| 5 | Evaluation（12 家 / 6 一批 / 并发 2） | `runtimeV3.ts:1560` | 1 | 2 |
| 6 | Planner 决策 → search 联想词 | `runtimeV3.ts:673` | 1 | 1 |
| 7 | Amap + Evaluation | | 1 | 2 |
| 8 | Planner 决策 → finish | `runtimeV3.ts:673` | 1 | 1 |
| | **合计** | | **7 串行步** | **9 次调用** |

每次调用 `timeoutMs = 60000`（`supervisorPlanner.ts:54`、`evaluationAgent.ts:22`、`supervisor.ts:35`）。其中第 3、6、8 步共 3 次串行往返，全部由 Planner 模型贡献。

下面论证这 3 次往返的收益接近于零。

---

## 3. 问题清单

### 3.1 Planner 模型在热路径上几乎没有剩余决策权（最严重）

**A. 存在一份能独立跑完整个搜索的确定性 planner。**

`deterministicSupervisorPlannerAction`（`supervisorPlanner.ts:277`，约 120 行 if 链）覆盖了全部分支：够了就 finish、预算耗尽就 finish/ask、未授权放宽候选就 ask、exact → fallback → synonym → broadened 的完整降级序列。它不是兜底草稿，是完整实现。

而它被触发的路径远比"异常降级"宽：

| 触发条件 | 位置 |
|---|---|
| 开放探索且无主推荐 | `supervisorPlanner.ts:164` `shouldForceOpenExplorationSearch` |
| 无 API key | `supervisorPlanner.ts:168` |
| `AGENT_DETERMINISTIC=1`（测试默认开启） | `supervisorPlanner.ts:168`、`jest.setup.js` |
| 模型调用抛错 | `supervisorPlanner.ts:174` |

**B. 模型真跑通了，输出也被逐字段改写。**

`guardSearchAction`（`runtimeV3.ts:887`）对模型返回的 `SearchPlan` 做的事：

| 字段 | 处理 | 行 |
|---|---|---|
| `keywords` | 过滤排除项后 `.slice(0, 1)` | `:905` |
| `radiusMeters` | 按 strict 距离 clamp，再钳到 300–5000 | `:924` |
| `poiType` | `resolveSearchActionPoiType` 用本地 taxonomy **直接覆盖** | `:965` |
| `allowedForPrimary` | 按授权状态覆盖 | `:937` |
| 整个 plan | 与历史 attempts 比对，重复即拒 | `:986` |

改写完之后，模型对这次搜索的实际贡献只剩「搜哪个关键词」——而 `nextUntriedTarget(ctx, kind)`（`policy.ts:227`）已经给出了答案。

**C. finish 也会被覆盖。**

`guardFinishAction` → `buildExpansionSearchBeforeFinish`（`runtimeV3.ts:1040`）：模型说结束，若仍有未尝试的联想词且品牌数不足，直接把 finish 换成一个确定性构造的 search plan。也就是说模型的 finish 只有在确定性策略同意时才生效。

**D. 有一次模型调用在结构上只可能亏。**

`resolveGuardedAction`（`runtimeV3.ts:669`）在 guard 判定 `request_rewrite` 时：

```
decision.suggestedAction  // ← 已经是一个完整合法的 action
  ↓
再花一次模型往返请模型"重写"（:710）
  ↓
重写结果再过一遍 guard（:719）
  ↓
还不通过 → 回落 decision.suggestedAction（:738）
```

最好情况是模型复现了已经算好的答案，最坏情况是多付两次往返后用回原值。这条路径没有正收益。

**E. 公允地说，模型 planner 保留了三项能力**——但都不值 3 次串行往返：

| 能力 | 现状 |
|---|---|
| loop 中途生成贴合上下文的 `ask_user`（带 `optionEffects`） | **有真实价值**，policy 的 `buildNoPrimaryQuestion`（`policy.ts:330`）是模板化的。但这属于"对话"能力，本应归 Supervisor |
| 提前 finish 并给出 `selectedIds` 排序 | 被 `buildExpansionSearchBeforeFinish` 与 FinalGuard 的重排（`finalGuard.ts:106`）双重覆盖 |
| 选队列外的关键词 | guard 不拦，但也无从验证是否比 KeywordExpansion 的产出更好 |

**结论**：Planner 应从"每轮调一次"改为"确定性策略枯竭时才调一次"。那才是模型有增量的场景——所有关键词试完仍无主推荐，需要重新构思搜索方向。

---

### 3.2 顺序策略仍然三写，`policy.ts` 只收敛了原语

上一轮抽出的 `policy.ts` 解决了**原语**双写（半径、poiType、追问文案、关键词队列），这部分做得干净。但**"下一步搜什么"的顺序决策**仍然分散在三处：

| 实现 | 位置 | 覆盖范围 |
|---|---|---|
| `deterministicSupervisorPlannerAction` | `supervisorPlanner.ts:277` | 全部分支 |
| `buildExpansionSearchBeforeFinish` | `runtimeV3.ts:1040` | related / broadened 分支 |
| 预算耗尽兜底 | `runtimeV3.ts:262`、`:291` | finish / ask 分支 |

三份对 related 与 broadened 的优先级判断各写了一遍，条件还不完全一致：

```ts
// supervisorPlanner.ts:284
shouldTryRelatedKeywords = hasUntriedTarget(ctx,'related')
  && distinctBrands < Math.min(6, ctx.targetCount)

// runtimeV3.ts:1046
if (distinctBrands >= context.targetCount) return null   // ← 阈值是 targetCount，不是 min(6, targetCount)
```

`targetCount = 8`（`runtimeV3.ts:544`），所以在 `distinctBrands ∈ [6, 8)` 区间两者结论相反：planner 认为够了要 finish，runtime guard 认为不够要继续搜。当前表现为 guard 赢——即多搜一轮。这不是致命 bug，但它正是上一轮想消灭的那类漂移，只是换了个位置复现。

---

### 3.3 控制流形状错了：应该是 plan-once fan-out，而不是每轮问一次模型

关键观察：**关键词队列在 KeywordExpansion 返回的那一刻就全部已知。**

`goal.relatedTargets` / `broadenedTargets`（各 ≤3，`keywordExpansionAgent.ts:26`）在第 2 步就确定了，此后每一轮 Planner 做的都是"从这个静态队列里取下一个还没试过的"。没有任何信息需要"看到第一轮结果才能决定第二轮搜什么"——**loop 存在的前提条件不成立**。

正确形态是一次铺开：

```
Supervisor → KeywordExpansion → 一次生成 N 个 SearchPlan
  → 并行 Amap → 并行 Evaluation → 合并排序 → FinalGuard
  → 够了就返回；不够才进第二轮（异常路径）
```

配套问题：

1. **并行能力已实现但默认关闭。** `AGENT_PARALLEL_SEARCH`（`runtimeV3.ts:102`）默认 `false`，线上仍是严格串行。功能上线了但是暗的——而且**前端还接不住**：服务端事件带了 `planId`，但 `lib/api.ts:581` 的回调签名没透传，`useRestaurantSearch.ts:244` 是覆盖式写入。一旦打开，3 个并发计划的 `searching` 事件会互相覆盖，`search_result` 的 `total` 也是单计划值而非批次累计。这解释了为什么它至今没敢默认开启。
2. **即使打开也只是"顺带铺宽"。** `planParallelBatch`（`runtimeV3.ts:1094`）在模型给出主计划后才追加同伴计划，Planner 往返仍在关键路径上，收益只有一半。
3. **第一次搜索被 KeywordExpansion 阻塞。** `runtimeV3.ts:171-182` 必须等联想词返回才构造 context 进入 loop。但首个 exact 计划只依赖 Supervisor 的 `primaryKeywords`，联想词第二轮才用得上。这一次往返白挂在**每个查询**的关键路径上。

---

### 3.4 Evaluation 重复评估同一批餐厅，且 `cache` 是空壳

**A. 没有跨轮去重。**

`selectRestaurantsForEvaluation`（`runtimeV3.ts:1494`）只做 `slice(0, limit)`，**不过滤 `context.candidates` 里已经拿到 verdict 的餐厅**：

```ts
const limit = Math.max(targetCount, configuredLimit);   // = 12
return restaurants.slice(0, limit);
```

「火锅」和「川菜」从高德返回的 POI 高度重叠，同一家店会被反复送进 Evaluation。而 Evaluation 是**调用量最大的 agent**（每轮 2 批），`CLAUDE.md` 也承认这一点。开启并行 fan-out 后重叠只会更多——3.3 的优化会放大 3.4 的浪费，两者应当同批处理。

**B. `'cache'` 是一个从未被写入的枚举值。**

```
types.ts:186          source?: 'model' | 'cache' | 'error'
schemas/verdict.ts:80 z.enum(['model','cache','error'])
runtimeV3.ts:1627     outputs.some(o => o.source === 'cache') ? 'cache' : 'model'   // ← 只读不写
```

全仓库无任何位置写入 `'cache'`（上一轮删掉进程内 Map 后残留）。类型在撒谎，读取分支是死代码。

而做缓存的材料是现成的：`goalVersion.ts` 已提供 `goalSignature`，`(goalSignature, restaurantId) → verdict` 就是一个正确的缓存键——goal 变了签名就变，候选自动失效，与 `isCandidateFreshForContext`（`finalGuard.ts:54`）用的是同一套失效语义。

---

### 3.5 Prompt 仍是规则堆叠而非原则

上一轮列为 P2 的"prompt 降规则"未启动，现状：

`supervisor.ts:59-89` = 17 条边界规则 + 7 条归类规则，其中：

- **硬编码触发词表**：`随便/随意/随机/都行/都可以/无所谓/你决定/你看着办/帮我决定/直接推荐/不知道吃啥…`（规则 8）
- **规则之间需要模型仲裁**：规则 8（这些词 → 开放推荐，不要 ask_user）与规则 8a（附近有什么/清淡点/便宜点 → 必须 ask_user）的边界完全靠模型自己划
- **补丁式编号**：1a / 1b / 7a / 8a 说明每条都是为修某个具体 case 加的

`keywordExpansionAgent.ts:32` 的 `OPEN_EXPLORATION_DEMOTED_KEYWORDS`（日料/寿司/拉面等降权词）同理。

问题不在长度而在类型：**词表精确匹配是确定性分类器，不该交给模型去背。** 要精确就下沉成 `isOpenExplorationPhrase()` 并单测；要泛化就换成 2–3 个 few-shot 难例。现在两头不占：既占 token，又不可单测，且每加一条都与已有条目产生交互，回归成本随长度平方增长。

---

### 3.6 错误分类靠正则匹配 message 字符串

上一轮把**客户端**的 `classifyAgentError` 中文子串匹配修掉了，但**服务端**同样的模式还在三处：

| 位置 | 模式 |
|---|---|
| `runtimeV3.ts:385` `toAgentErrorCode` | `/amap\|osm\|搜索超时\|poi/i` → `SEARCH_PROVIDER_FAILED`；`/SupervisorPlannerAgent/i` → `SUPERVISOR_UNAVAILABLE` |
| `runtimeV3.ts:1515` `evaluationFailureFromError` | `/schema\|parse\|invalid\|truncated/i` → `EVALUATION_PARSE_ERROR` |
| `runtimeV3.ts:1631` `isLikelyEvaluationRateLimit` | `/429\|rate\s*limit/i` |

任何碰巧包含 `poi` 的错误信息都会被归为数据源故障，而 `recoverable`（`chat/route.ts:319`）直接决定前端是否让用户重试。错误应在抛出点带类型，而不是在消费点猜。

---

### 3.7 没有 eval —— 这是重构的前置条件，不是 P2

30 个测试文件，但 `jest.setup.js` 默认 `AGENT_DETERMINISTIC=1`，模型决策路径覆盖率仍为 0（上一轮把它从 `NODE_ENV==='test'` 改成显式开关，可达性有了，但没有用例真的关掉它）。

更关键的是：**没有任何一组 golden query 能回答"改完之后行为有没有变差"。** 3.1–3.4 的改动全部行为可见（追问率、主推荐命中、搜索轮数都会变），没有 eval 就只能靠手工点几个 query 拍脑袋。

上一轮把 eval 排在 P2（第 18 项），从依赖关系看这个排序是错的——它是 P0 里唯一的阻塞项。

---

## 4. 目标形态

```mermaid
graph TB
    U[User Message] --> API[/api/agent/chat]
    API --> ORCH[Orchestrator: 预算 / 事件 / 状态提交]

    ORCH --> SUP[Supervisor 模型: 理解目标 / 追问]
    SUP --> KW[KeywordExpansion 模型]
    SUP -. exact 计划不等联想词 .-> BATCH

    KW --> BATCH[policy.decideNextBatch: 一次生成 N 个 SearchPlan]

    BATCH --> FAN[并行 fan-out]
    FAN --> A1[Amap kw1] --> EV[Evaluation 并行 + verdict 缓存]
    FAN --> A2[Amap kw2] --> EV
    FAN --> A3[Amap kw3] --> EV

    EV --> MERGE[mergeCandidates] --> ENOUGH{够了?}
    ENOUGH -- 是 --> FG[FinalGuard] --> RA[ResultAssembler]
    ENOUGH -- 否，队列还有 --> BATCH
    ENOUGH -- 否，队列枯竭 --> REPLAN[Planner 模型: 重新构思方向<br/>整轮最多 1 次]
    REPLAN --> BATCH
    REPLAN -- 无方向 --> ASK[ask_user]
```

职责边界（相对上一轮的调整用 **粗体** 标出）：

| 组件 | 负责 | 不负责 |
|---|---|---|
| Orchestrator | loop、预算、事件、状态提交 | 语义策略、关键词选择 |
| Supervisor（模型） | 理解目标、维护 goal、**生成所有面向用户的追问** | 生成 poiType、执行工具 |
| KeywordExpansion（模型） | 联想词 + poiType 建议 | 决定搜索顺序 |
| **policy.ts（确定性）** | **唯一 planner：计划批次、顺序、半径、poiType、授权 effect** | 语义理解 |
| **Planner（模型）** | **仅在确定性策略枯竭时重新构思搜索方向，整轮 ≤1 次** | 常规轮次决策 |
| guard | **只校验与拒绝，不改写、不请求重写** | 生成动作 |
| EvaluationAgent（模型） | 候选语义验证与证据归因 | 主推荐准入 |
| FinalGuard | 主推荐准入 | 编造理由 |

预期：典型查询从 **7 个串行模型步 / 9 次调用** 降到 **3 个串行步 / 4–6 次调用**。

---

## 5. 优化优先级

### P0

| # | 项 | 对应问题 | 验收 |
|---|---|---|---|
| 1 | **建 eval 集**（阻塞后续全部改动） | 3.7 | 20–30 条 golden query 可离线跑出：追问率 / 主推荐命中率 / 搜索轮数 / 串行模型步数 / token / P95 |
| 2 | **Evaluation 去重 + verdict 缓存** | 3.4 | 同一 `(goalSignature, restaurantId)` 一轮内只评估一次；`source:'cache'` 名副其实 |
| 3 | **policy 成为唯一 planner**，guard 退化为 validate-only | 3.1、3.2 | 顺序决策只剩一份实现；`request_rewrite` 分支及其模型往返删除 |
| 4 | **plan-once fan-out**，并行默认开启 | 3.3 | 典型查询串行模型步 ≤3 |

### P1

| # | 项 | 对应问题 |
|---|---|---|
| 5 | exact 搜索与 KeywordExpansion 并发起 | 3.3-3 |
| 6 | 模型 planner 降级为 `replan` 罕见分支 | 3.1-E |
| 7 | 中途 `ask_user` 的生成权归还 Supervisor | 3.1-E |
| 8 | 服务端错误在抛出点类型化 | 3.6 |

### P2

| # | 项 | 对应问题 |
|---|---|---|
| 9 | Supervisor prompt 降规则：词表下沉成代码 + few-shot 难例 | 3.5 |
| 10 | `OPEN_EXPLORATION_DEMOTED_KEYWORDS` 同上 | 3.5 |

---

## 6. 风险与取舍

- **不是"把 agent 改回 workflow"的倒退。** 上一轮已经承认这是 workflow（评审 7）。本轮是把这个承认执行到底：模型留在它不可替代的三个位置（理解口语、联想搜索词、判断 POI 是否满足语义目标），代码拿回它本来就在做的控制流。模型调用次数减少的同时，**模型的决策质量要求反而更高**——因为不再有一层确定性策略在后面兜着改写。

- **删掉 Planner 会损失中途追问的灵活性。** 这是真实损失，不能靠 policy 模板补齐。缓解方式是 P1-7：把追问生成权交回 Supervisor（它本来就负责对话），policy 在需要追问时抛出 `need_clarification` + 上下文，由 Supervisor 生成文案。代价是这条路径多一次模型往返——但它只在"没搜到"时触发，不在成功路径上。

- **plan-once fan-out 放大高德压力。** 单轮从 1 个请求变成 ≤3 个并发。`AGENT_SEARCH_CONCURRENCY` 已有上限控制，配合 P0-2 的去重，Evaluation 侧的调用量预计**净下降**。仍需在 eval 里盯住高德 QPS。

- **eval 会暴露"当前行为其实不达标"。** 建 eval 的常见结果是发现基线本身就有问题（例如追问率过高）。这是收益不是风险，但要预留处理时间，不要把 eval 结果直接当成重构的回归门槛——先固化基线，再逐项对比。
