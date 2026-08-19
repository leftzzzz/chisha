# Agent Harness 优化技术方案（2026-08）

> **后续**：本方案已落地。其中"Supervisor 决定 action、Runtime guard 校验并
> 请求重写"的形态已被下一轮取代——常规轮次的动作决策收归 `policy.ts`，
> guard 不再改写也不再请求重写。见
> `docs/agent-loop-shape-review-2026-08.md` 与
> `docs/Agent-Loop-形态重构技术方案-2026-08.md`。
> 上述文件只解释当前 workflow 的形成过程；当前生效架构见
> `docs/technical/current-agent-workflow.md`。

编制日期：2026-08-12
依据文档：`docs/agent-harness-review-2026-08.md`
适用范围：`lib/agent/**`、`app/api/agent/**`、`lib/api.ts`、`lib/logger.ts`、`lib/monitoring.ts`、`hooks/useRestaurantSearch.ts`、`context/AppReducer.ts`

本方案把评审文档中的 P0/P1/P2 条目转成可执行的模块设计、文件改动清单、分阶段落地顺序与验收标准。评审文档负责"是什么问题"，本文负责"改成什么样、怎么改、怎么验"。

---

## 1. 背景与目标

当前 Agent Harness 的地基（trace 埋点结构、goal 版本与候选失效、授权 scope、system/user 分离）已经就位，遗留问题集中在三类：

1. **策略双写**：`runtimeV3` 与 `supervisorPlanner` 各有一套确定性策略，已在用户可见文案上发生漂移。
2. **串行链路**：单轮最多约 10 次串行模型调用，且工具调用被限制为单关键词串行。
3. **观测断链**：trace 只写不读、事件与 trace 不对齐、客户端无卡死检测、模型调用零指标。

本方案的目标不是把系统改成"更自主的 Agent"，而是**承认它是 workflow 形态并把它做扎实**：

- 确定性策略只有一份实现，可单测、可回归。
- 模型只在"理解目标"和"验证候选"两处承担语义职责。
- 任何一次推荐都能从 trace 回放；任何一次失败都留下痕迹。
- 单轮延迟从"串行 10 次模型调用"降到"3–4 次"。

---

## 2. 设计原则

1. **约束前移**：能用 schema 表达的限制不要用事后改写（guard rewrite 是最后手段，不是常规路径）。
2. **单一策略源**：确定性策略只存在于 `lib/agent/policy.ts`，runtime 与 planner 都是它的消费方。
3. **用户文案与内部状态解耦**：内部用枚举，出口一次性映射为文案。
4. **观测优先于优化**：先让失败可见、指标可算，再动性能与 prompt。
5. **失败必须留痕**：错误路径与成功路径同等对待，trace 与 session 都要写。
6. **向后兼容存量 session**：30 分钟 TTL 内的旧 session 结构必须仍可反序列化。

---

## 3. 非目标

1. **不引入 deterministic 语义验证器替代 EvaluationAgent**（沿用 `docs/Agent优化技术方案.md` 第 3.1 节结论）。M5 中的"评估失败回退"仅指**候选降级为 `unverified` 候补并明确告知**，不允许用本地规则把候选标成 `passed`。
2. **不做上下文压缩 / 会话摘要 / prompt caching**（评审 3.4，已确认暂缓）。
3. **不放开 runtime 的硬约束**：距离、预算、营业状态、排除项仍由确定性代码判定。
4. **不改动产品交互形态**：转盘、追问气泡、历史记录的交互不在本方案内。

---

## 4. 模块设计

### M1 `lib/agent/policy.ts`：收敛确定性策略

#### 4.1.1 现状

以下 6 组逻辑在两个文件里各有一份实现：

| 逻辑 | runtimeV3.ts | supervisorPlanner.ts |
|---|---|---|
| 构造 SearchPlan | `buildRuntimePlan:1676` | `buildPlan:483` |
| 半径递增 | `nextRuntimeRadius:1766` | `nextRadius:583` |
| poiType 推断 | `inferPoiTypesForGoalKeyword:1733` | `inferPoiTypesForGoalKeyword:613` |
| 无主推荐追问 | `buildNoPrimaryQuestion:1441` | `buildFailureQuestionAction:410` |
| 放宽授权 effect | `allowBroadenQuestionEffect:1551` | `allowBroadenQuestionEffect:460` |
| 未尝试关键词 | `nextUntriedGoalTarget:1605` | `untriedGoalTargets:539` |

两侧签名不一致（runtime 版收 `goal`，planner 版收 `context`），这是当初无法直接复用的原因。

#### 4.1.2 目标接口

新增 `lib/agent/policy.ts`，对外只依赖一个最小上下文，便于单测：

```typescript
export interface PolicyContext {
  goal: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  location: Location;
  targetCount: number;
  maxSearchCalls: number;
}

export type TargetKind = 'initial' | 'related' | 'broadened';

// 计划构造
export function buildSearchPlan(
  ctx: PolicyContext,
  target: SearchKeywordTarget,
  searchIntent: SearchPlan['searchIntent'],
  allowedForPrimary: boolean,
  reason: string
): SearchPlan;

export function nextSearchRadius(ctx: PolicyContext): number;
export function resolvePoiTypes(
  goal: UserGoal,
  keyword: string,
  targetPoiTypes?: string[]
): string | undefined;

// 关键词队列
export function untriedTargets(ctx: PolicyContext, kind: TargetKind): SearchKeywordTarget[];
export function nextUntriedTarget(ctx: PolicyContext, kind: TargetKind): SearchKeywordTarget | null;
export function hasTriedKeyword(ctx: PolicyContext, keyword: string): boolean;
export function hasTriedIntent(ctx: PolicyContext, intent: SearchPlan['searchIntent']): boolean;

// 追问与授权
export function buildNoPrimaryQuestion(ctx: PolicyContext): PendingQuestion;
export function buildBroadenEffect(goal: UserGoal): ClarificationEffect;

// 准入辅助
export function primaryCandidates(ctx: PolicyContext): RestaurantCandidate[];
export function distinctPrimaryBrandCount(ctx: PolicyContext): number;
```

`AgentContext` 与 `AgentV3Context` 都结构性满足 `PolicyContext`，调用处无需适配层。

#### 4.1.3 改动清单

| 文件 | 操作 |
|---|---|
| `lib/agent/policy.ts` | 新增，承载上表 6 组逻辑的唯一实现 |
| `lib/agent/runtimeV3.ts` | 删除 `buildRuntimePlan` / `nextRuntimeRadius` / `resolveRuntimePlanPoiType` / `inferPoiTypesForGoalKeyword` / `sanitizePoiTypeCodes` / `nextUntriedGoalTarget` / `hasUntriedBroadenedTarget` / `hasTriedKeyword` / `hasTriedIntent` / `buildNoPrimaryQuestion` / `allowBroadenQuestionEffect` / `hasPrimaryCandidates`，改为从 policy 导入 |
| `lib/agent/supervisorPlanner.ts` | 删除 `buildPlan` / `nextRadius` / `resolvePlanPoiType` / `inferPoiTypesForGoalKeyword` / `untriedGoalTargets` / `nextUntriedInitialTarget` / `nextUntriedRelatedTarget` / `nextUntriedBroadenedTarget` / `hasTriedKeyword` / `hasTriedIntent` / `buildFailureQuestionAction` / `allowBroadenQuestionEffect`，改为从 policy 导入 |
| `__tests__/lib/agent/policy.test.ts` | 新增，覆盖半径递增、poiType 选择优先级、未尝试关键词队列、追问分支 |

#### 4.1.4 注意点

- `buildFailureQuestionAction` 与 `buildNoPrimaryQuestion` 行为**不完全一致**：runtime 侧多一个 `buildPostAuthorizationNoPrimaryQuestion` 分支（已授权放宽但仍无结果）。合并时以 runtime 侧为准（功能更全），planner 侧行为随之增强，需要在 `supervisorPlanner.test.ts` 更新对应断言。
- `nextRadius` 两侧对 strict 距离的处理不同：runtime 只在 `strict` 时钳制（`getStrictDistanceMaxMeters`），planner 对任意 distance 约束都钳制。以 runtime 语义为准（非 strict 距离应允许递增探索），planner 侧行为变化需在测试中显式覆盖。

---

### M2 `FinishReason`：用户文案与内部状态解耦

#### 4.2.1 现状

`translateExplanation`（`runtimeV3.ts:1373`）用中文字符串做 map key，只收录 runtime 侧 6 条；planner 侧 `supervisorPlanner.ts:283`、`:293` 的文案不在表内，会把内部术语透给用户。

#### 4.2.2 目标设计

新增 `lib/agent/finishReason.ts`：

```typescript
export type FinishReason =
  | 'MODEL_DECIDED'              // 模型自主 finish，使用模型给的 explanation
  | 'ENOUGH_PRIMARY'             // 已有足够主推荐
  | 'SEARCH_BUDGET_EXHAUSTED'    // 搜索次数耗尽
  | 'ACTION_BUDGET_EXHAUSTED'    // action 次数耗尽
  | 'GUARD_REJECTED'             // guard 拒绝继续执行
  | 'NO_MORE_STRATEGY'           // 无更多可验证策略
  | 'BROADEN_PROMOTION';         // 用户授权放宽后提升候补

const FINISH_TEXT: Record<FinishReason, string> = {
  MODEL_DECIDED: '',             // 空串表示使用模型 explanation
  ENOUGH_PRIMARY: '已为您找到合适的餐厅，以下是推荐结果。',
  SEARCH_BUDGET_EXHAUSTED: '已为您搜索附近多个方向，以下是精选推荐。',
  ACTION_BUDGET_EXHAUSTED: '已为您完成全面搜索，以下是最佳推荐。',
  GUARD_REJECTED: '已为您找到合适餐厅，以下是推荐结果。',
  NO_MORE_STRATEGY: '已为您搜索多个方向，以下是精选推荐。',
  BROADEN_PROMOTION: '已根据您的要求扩大搜索范围，以下是推荐结果。',
};

export function describeFinish(reason: FinishReason, modelExplanation?: string): string {
  const preset = FINISH_TEXT[reason];
  return preset || modelExplanation?.trim() || FINISH_TEXT.ENOUGH_PRIMARY;
}
```

`AgentAction` 的 finish 分支增加字段：

```typescript
| {
    type: 'finish';
    reason?: FinishReason;        // 缺省视为 MODEL_DECIDED，兼容存量 session
    selectedIds?: string[];
    candidateIds?: string[];
    explanation: string;          // 模型路径保留自然语言，内部路径填枚举对应的英文说明
    confidence: number;
  }
```

- 模型输出的 action 不带 `reason`（不暴露给模型），由 runtime 判定为 `MODEL_DECIDED`。
- 所有 runtime / planner 内部构造的 finish 必须显式带 `reason`。
- `finish()` 中 `translateExplanation(action.explanation)` 改为 `describeFinish(action.reason ?? 'MODEL_DECIDED', action.explanation)`。
- `explanation` 字段保留（trace 与 session 已有存量数据依赖），但**不再作为用户文案的唯一来源**。

#### 4.2.3 改动清单

| 文件 | 操作 |
|---|---|
| `lib/agent/finishReason.ts` | 新增 |
| `lib/agent/types.ts` | `AgentAction.finish` 增加 `reason?: FinishReason` |
| `lib/agent/schemas/action.ts` | finish 分支增加可选 `reason`，并从模型 function schema 中**排除**该字段 |
| `lib/agent/runtimeV3.ts` | 删除 `EXPLANATION_MAP` 与 `translateExplanation`；5 处内部 finish 补 `reason` |
| `lib/agent/supervisorPlanner.ts` | 3 处 deterministic finish 补 `reason` |
| `__tests__/lib/agent/finishReason.test.ts` | 新增：断言所有 `FinishReason` 都有非空文案（`MODEL_DECIDED` 除外），且不含内部术语（"准入""候选""上限"等词表校验） |

---

### M3 单关键词写进 schema

#### 4.3.1 现状

`schemas/plan.ts:75` 允许 `keywords` 1–5 个，guard 却只允许 1 个（`runtimeV3.ts:755`），差额通过 `MULTI_INTENT_KEYWORDS` → `request_rewrite` 补救，而 deterministic 兜底自己就输出 `['餐厅','美食']`（`supervisorPlanner.ts:314`、`:370`）——**必然触发一次无意义的重写往返**。

#### 4.3.2 目标设计

1. `SearchPlanSchema.keywords` 收紧为 `.min(1).max(1)`（保留数组形状，避免破坏 `SearchAttempt.keywords` 与存量 session）。
2. 模型 function schema（`supervisorPlanner.ts:99` 的 `ACTION_FUNCTION`）中 `keywords` 增加 `maxItems: 1` 与描述"只能是一个餐饮意图词"。
3. 删除 `guardSearchAction` 中的 `MULTI_INTENT_KEYWORDS` → `request_rewrite` 分支（`runtimeV3.ts:833`–`845`）。模型若仍输出多词，由 `callJsonFunctionAgent` 既有的 schema 修复重试处理（`modelClient.ts:123`），不再占用 planner 的一次完整往返。
4. 开放探索兜底改为单词队列：`['餐厅','美食']` → 首轮 `['餐厅']`，`'美食'` 进入 `broadenedTargets` 队列由后续轮次消费。

#### 4.3.3 影响面

- `guardSearchAction` 中 `keywords.slice(0, 5)` → `.slice(0, 1)` 后 `hasMultipleKeywords` 分支整体删除，guard 逻辑净减约 20 行。
- `amapPoiSearch` 调用方（`chat/route.ts:210`）的 `preferProvidedPoiType: Boolean(plan.poiType) && plan.keywords.length === 1` 条件恒真，可简化。
- 与 `AGENTS.md` 的"每个 Amap 请求一个搜索意图"规则从此在类型层一致。

---

### M4 一轮内并行 fan-out

#### 4.4.1 设计取舍

模型 action 仍然是**单 plan**（模型决定"下一步做什么"），并行由 policy 决定（"这一步能不能铺开"）。这样既不放大模型的决策空间，也不改变 guard 的单 action 校验模型。

#### 4.4.2 目标设计

在 `runtimeV3` 中把 `executeSearchAction` 拆为两层：

```typescript
// policy 决定本轮能并行铺开哪些计划
export function planParallelBatch(
  ctx: PolicyContext,
  primaryPlan: SearchPlan,
  maxParallel: number
): SearchPlan[];   // 返回 [primaryPlan, ...同 intent 的未尝试 target 计划]

// runtime 并行执行
async function executeSearchBatch(
  actionId: string,
  plans: SearchPlan[],
  context: AgentV3Context,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>,
  emit: EmitAgentEvent
): Promise<AgentObservation[]>;
```

执行语义：

1. `plans` 内的 Amap 请求并行发起，并发上限 `AGENT_SEARCH_CONCURRENCY`（默认 3）。
2. 每个 plan 的结果各自跑 `applyHardConstraintGuard` → `runBatchedEvaluationAgent`，evaluation 并发沿用 `AGENT_EVALUATION_CONCURRENCY`（默认 2），总并发 = min(搜索并发, 评估并发) 由现有 `mapWithConcurrency` 控制。
3. `context.attempts` 按 `plans` 顺序追加（保证 `sourceAttempt` 索引稳定，`finalGuard.ts:64` 依赖它）。
4. 预算记账：一次 batch 消耗 `plans.length` 次 `maxSearchCalls`；`planParallelBatch` 内部保证 `plans.length <= remainingSearchCalls`。
5. 失败隔离：单个 plan 抛错不影响其余 plan，记为空结果 observation + `error` trace。

#### 4.4.3 并行对观测的影响（必须同步处理）

并行后 `searching` / `tool_start` / `tool_result` 事件会交错。处理方式：

- `SearchPlan` 增加 `planId: string`（runtime 生成，不进模型 schema）。
- `searching` / `tool_start` / `tool_result` / `search_result` 事件增加 `planId` 与 `round`。
- 前端 `useRestaurantSearch` 按 `planId` 聚合展示，`LoadingSteps` 从"单条进行中"改为"同轮多条并列"。

#### 4.4.4 开关与回滚

`AGENT_PARALLEL_SEARCH`（默认 `false`，灰度后转 `true`）。关闭时 `planParallelBatch` 恒返回 `[primaryPlan]`，行为与当前完全一致。

#### 4.4.5 预期收益

单轮串行模型调用：`1(goal) + 1(联想) + 4(planner) + 4(evaluation) ≈ 10` → `1 + 1 + 1~2(planner) + 1~2(evaluation) ≈ 4`。Amap QPS 上升约 3 倍（需确认配额，见 §8 风险）。

---

### M5 降级路径

#### 4.5.1 入口降级（评审 3.6-1）

`runSearchSupervisor` 失败时不再让整轮 SSE error。新增 `lib/agent/degraded.ts`：

```typescript
export function buildDegradedGoalFromQuery(query: string, location: Location): UserGoal | null;
```

行为：

1. 用 `normalizeSearchKeywords([query])` 抽词，过滤 `isGenericSearchKeyword`。
2. 抽词非空 → 构造最小 `UserGoal`：`primaryKeywords = 抽词结果`、`hardConstraints = []`、`clarificationNeeded = []`、`allowBroaden = false`、`ambiguity = ['需求理解服务暂时不可用，已按原文关键词搜索。']`。
3. 抽词为空 → 返回 `null`，runtime 走 `ask_user`（"能具体说说想吃什么吗？"），而不是抛错。

runtime 侧在 `getSupervisorPlannerOutput` 外包 try/catch，降级时：
- `appendTrace(context, 'error', { error: { code: 'SUPERVISOR_UNAVAILABLE', ... } })`
- `emit({ type: 'guardrail', severity: 'info', message: '需求理解服务暂时不可用，已按原文搜索。' })`

#### 4.5.2 评估降级（评审 3.6-2）

保持非目标 §3.1 的边界：**不允许把候选标成 `passed`**。改动仅限于让失败不吞掉整轮：

- `buildUnverifiedEvaluationFallback`（`runtimeV3.ts:1200`）保持"全部 `unverified`、不进主推荐"的语义。
- 但当**本轮所有 evaluation 均失败且已有历史主推荐**时，finish 而不是追问（`reason: 'GUARD_REJECTED'`），避免用户看到"没找到"。
- 当没有任何历史主推荐时，追问文案区分"没搜到"与"验证服务不可用"，后者提供"重试"选项。

---

### M6 观测链路

#### 4.6.1 客户端心跳（P0，唯一影响用户的问题）

```typescript
// lib/api.ts —— requestAgentStream 合并 agentSearch 的心跳逻辑
const HEARTBEAT_TIMEOUT_MS = 45000;

const controller = new AbortController();
let timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
const resetTimeout = () => {
  clearTimeout(timeoutId);
  timeoutId = setTimeout(() => controller.abort(), HEARTBEAT_TIMEOUT_MS);
};
// 每解析到一条 data: 行调用 resetTimeout()
// 流正常结束或抛错时 clearTimeout
```

注意超时值与服务端心跳的关系：单次 evaluation 的 timeout 是 60s，若只加客户端超时而服务端不发心跳，45s 会误杀正常的长请求。因此**服务端心跳与客户端超时必须同批上线**——有 10s 间隔的心跳后，45s 无事件即可判定为真正的卡死：

```typescript
// app/api/agent/chat/route.ts —— 流级心跳
const heartbeat = setInterval(() => {
  sendEvent(controller, { type: 'heartbeat', at: Date.now() });
}, 10000);
// finally 中 clearInterval
```

`heartbeat` 事件加入 `AgentEvent`，客户端只做 `resetTimeout()`，不触发任何回调、不进 trace 面板。

同时删除 `lib/api.ts` 中的 `agentSearch`（无调用方）及其重复的 SSE 解析块，`/api/agent/search` 路由保留做 HTTP 层兼容。

#### 4.6.2 失败落 trace（P0）

`runSearchAgentV3` 内部包一层：

```typescript
export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode,
    readonly runtimeState?: AgentRuntimeState
  ) { super(message); }
}
```

- runtime 捕获任意异常 → `appendTrace(context, 'error', {...})` → 抛出 `AgentRunError`，携带 `snapshotRuntimeState(context)`。
- `chat/route.ts` 的 catch 中：若为 `AgentRunError` 且带 `runtimeState`，先 `applyRuntimeStateToSessionAsync` + `saveAgentSessionAsync`，再发 error 事件。
- 第一次调用（context 尚未构造）失败时 `runtimeState` 为空，仅记日志。

#### 4.6.3 traceId 补齐（P0）

- `runtimeV3.ts:219` 的强制 guardrail 事件带上前一行 `runtime_decision` trace 的 id。
- `AgentFinalResult` 增加 `questionTraceId?: string`，`buildPausedResult` 填入 `question` trace 的 id；`chat/route.ts` 的 `question` / `session_paused` 事件带上它。
- 叙事类事件（`thinking` / `status` / `searching` / `filtering` / `partial_results`）**明确不带 traceId**，并在 `emitTraceCallback` 上方加注释说明这是有意为之——它们是 UI 文案，不是可回放节点。

#### 4.6.4 观测契约单一来源（P1）

- `lib/api.ts` 改为 `import type { AgentEvent } from '@/lib/agent/types'`，删除本地副本（`api.ts:42`–`76`）。纯类型导入，无运行时开销与 bundle 影响。
- `AgentEvent` 增加 `heartbeat`；删除从未 emit 的 `strategy_change`（含客户端 `onStrategyChange` 回调）。

#### 4.6.5 结构化错误码（P1）

```typescript
export type AgentErrorCode =
  | 'SESSION_EXPIRED'
  | 'CONFIG_MISSING'
  | 'SUPERVISOR_UNAVAILABLE'
  | 'EVALUATION_FAILED'
  | 'SEARCH_PROVIDER_FAILED'
  | 'RATE_LIMITED'
  | 'UNKNOWN';
```

- `{ type: 'error' }` 事件增加 `code: AgentErrorCode` 与 `recoverable: boolean`。
- `classifyAgentError`（`api.ts:181`）改为直接读 `code`，中文子串匹配仅作为旧版本兼容兜底并标注 `@deprecated`。

#### 4.6.6 模型调用指标（P1）

`callJsonFunctionAgent` 返回值从 `T` 改为：

```typescript
export interface ModelCallResult<T> {
  data: T;
  metrics: {
    agentName: string;
    model: string;
    durationMs: number;
    promptTokens?: number;
    completionTokens?: number;
    attempts: number;              // 含截断重试与 schema 修复重试
    mode: 'tools' | 'functions';   // 是否降级到 legacy
    truncated: boolean;
  };
}
```

- 4 个调用方各自解构 `data`，并把 `metrics` 交给新增的 `lib/agent/metrics.ts`：
  ```typescript
  export function recordModelCall(context: AgentContext, metrics: ModelCallMetrics): void;
  export function summarizeTurnMetrics(context: AgentContext): TurnMetrics;
  ```
- 每次调用写一条 `model_call` trace（新增 `AgentTraceType`）。
- 每轮结束时 `logger.info('agent turn finished', summarizeTurnMetrics(context))`，字段含 `sessionId` / `turnId` / `modelCalls` / `totalTokens` / `totalModelMs` / `toolCalls` / `degradedCount`。

> 该项是 M8 eval 集的前置依赖：没有 token 与耗时，就无法度量 prompt 与并行改造的收益。

#### 4.6.7 trace 存储瘦身（P1，配合评审 3.5）

`snapshotRuntimeState` 落库前过滤：

```typescript
const PERSISTED_TRACE_TYPES = new Set([
  'model_goal', 'model_action', 'guard_decision', 'runtime_decision',
  'question', 'final', 'error',
]);
const MAX_PERSISTED_TRACE = 80;

function persistableTrace(trace: AgentTraceItem[]): AgentTraceItem[] {
  return trace.filter((item) => PERSISTED_TRACE_TYPES.has(item.type)).slice(-MAX_PERSISTED_TRACE);
}
```

高频的 `tool_start` / `tool_result` / `observation` / `state_update` / `evaluation` / `model_call` 只进日志（Cloudflare observability 已开启），不进 D1。

#### 4.6.8 trace 可读（P1）

`GET /api/agent/session/[id]?include=trace` 返回 `trace` 数组（默认不含）。用于本地调试与线上排障，无需前端改动。

#### 4.6.9 日志上下文（P2）

```typescript
// lib/agent/turnLogger.ts
export function createTurnLogger(sessionId: string, turnId: string): {
  info(message: string, data?: object): void;
  warn(message: string, data?: object): void;
  error(message: string, data?: object): void;
};
```

`runtimeV3` / `supervisorPlanner` / `supervisor` / `evaluationAgent` / `keywordExpansionAgent` / `modelClient` 的日志调用统一改用它，所有日志自动带 `sessionId` / `turnId`。

---

### M7 模型分级与缓存（P1）

| env | 默认 | 用途 |
|---|---|---|
| `OPENAI_MODEL` | `gpt-4o` | 兜底，未细分时沿用 |
| `OPENAI_MODEL_SUPERVISOR` | 继承 `OPENAI_MODEL` | goal 理解 / 追问 |
| `OPENAI_MODEL_PLANNER` | 继承 `OPENAI_MODEL` | action 决策 |
| `OPENAI_MODEL_EVALUATION` | 继承 `OPENAI_MODEL` | 候选验证（调用量最大，建议配便宜模型） |
| `OPENAI_MODEL_KEYWORD` | 继承 `OPENAI_MODEL` | 关键词联想 |

`evaluationCache`（`evaluationAgent.ts:31`）的进程内 Map 在 Workers 上命中率接近 0，本方案**直接删除**（含 `evaluationCacheKey` 的 `stableStringify` 开销）。若后续确有需求，再以 D1/KV 实现并附命中率埋点。

---

### M8 清理与 eval（P1/P2）

#### 4.8.1 死代码清理

| 目标 | 处理 |
|---|---|
| `lib/llm.ts`（464 行，零引用） | 删除 |
| `lib/agent/tools.ts`（deprecated，未接入） | 删除 |
| `lib/agent/subagents/planningAgent.ts` + `schemas/plan.ts` 中的 `PlanningAgentPlanSchema` / `PlanningAgentOutputSchema` | 删除（连同 `__tests__/lib/agent/subagents/planningAgent.test.ts`） |
| `lib/monitoring.ts`（337 行，零调用、endpoint 注释掉） | 删除 |
| `CLAUDE.md` / `AGENTS.md` / `docs/PROJECT-STRUCTURE.md` | 同步修正架构描述，移除 `lib/llm.ts` 相关表述 |

#### 4.8.2 让模型路径可测

现状 `process.env.NODE_ENV === 'test'` 直接短路到 deterministic 分支（`supervisorPlanner.ts:158`、`keywordExpansionAgent.ts:125`），导致模型路径零覆盖。

改为显式开关：

```typescript
const useDeterministic = process.env.AGENT_DETERMINISTIC === '1' || !OPENAI_API_KEY;
```

`jest.setup.js` 中默认设置 `AGENT_DETERMINISTIC=1`，需要测模型路径的用例显式取消并 mock `fetch`。

#### 4.8.3 eval 集（P2）

`scripts/agent-eval.ts` + `__fixtures__/agent-eval/*.json`：

- 20–50 条真实 query（含开放需求、硬约束、多轮追问、排除项、无结果场景）。
- Amap 响应录制为 fixture，保证可重放。
- 输出指标：追问率、主推荐命中率、平均搜索轮数、平均模型调用数、总 token、P95 端到端耗时。
- 依赖 M6.6 的指标埋点。

---

## 5. 落地阶段

| 阶段 | 内容 | 依赖 | 风险 |
|---|---|---|---|
| **P1 观测与安全网** | M6.1 心跳（服务端+客户端同批）、M6.2 失败落 trace、M6.3 traceId 补齐、M5.1 入口降级 | 无 | 低，纯增量 |
| **P2 策略收敛** | M1 policy.ts、M2 FinishReason、M3 单关键词 schema | P1 | 中，行为等价重构，靠测试兜底 |
| **P3 性能** | M4 并行 fan-out（开关灰度）、M7 模型分级、M5.2 评估降级 | P2 | 中高，见 §8 |
| **P4 契约与指标** | M6.4 契约单一来源、M6.5 错误码、M6.6 模型指标、M6.7 trace 瘦身、M6.8 trace 可读、M6.9 日志上下文 | P1 | 低 |
| **P5 清理与 eval** | M8.1 死代码、M8.2 可测性、M8.3 eval 集 | P4 | 低 |

**为什么观测在最前**：M4 的并行改造会显著改变事件时序与失败模式，没有 M6 的心跳、失败 trace 和模型指标，改造后出问题无法定位，收益也无法度量。

---

## 6. 测试方案

### 6.1 单元测试

| 模块 | 新增/修改测试 | 关键断言 |
|---|---|---|
| M1 | `policy.test.ts`（新增） | 半径按 1.25 递增且 strict 时钳制；poiType 优先级 target > goal 推断 > goal.poiType；未尝试队列排除已 attempt 关键词；无主推荐追问在"已授权放宽"分支返回换类型问题 |
| M1 | `runtimeV3.test.ts` / `supervisorPlanner.test.ts`（修改） | 合并后 planner 侧新增的 post-authorization 追问分支；planner 侧非 strict 距离不再钳制 |
| M2 | `finishReason.test.ts`（新增） | 每个枚举有文案；文案不含内部术语词表；`MODEL_DECIDED` 回落到模型 explanation；模型 explanation 为空时回落到默认文案 |
| M3 | `schemas.defaults.test.ts`（修改） | 多关键词 plan 被 schema 拒绝；guard 不再产生 `MULTI_INTENT_KEYWORDS` |
| M4 | `runtimeV3.parallel.test.ts`（新增） | batch 内 attempts 顺序稳定；单 plan 失败不影响其余；预算按 plans.length 扣减；开关关闭时行为与串行一致 |
| M5 | `degraded.test.ts`（新增） | supervisor 抛错时返回降级 goal 并写 error trace；抽词为空时走 ask_user 而非抛错 |
| M6 | `api.heartbeat.test.ts`（新增） | 45s 无事件触发 abort；收到 heartbeat 后计时重置；heartbeat 不触发业务回调 |
| M6 | `chat.route.error.test.ts`（新增） | runtime 抛 `AgentRunError` 时 session 被保存且含 error trace |
| M6 | `modelClient.test.ts`（修改） | 返回 metrics，含 attempts / mode / truncated |

### 6.2 集成与手工验证

1. **心跳**：本地把 evaluation timeout 调至 90s，确认 UI 不再无限转圈，且不会误杀正常长请求。
2. **并行**：开关开/关各跑 10 条 query，对比推荐结果集合（应高度重合）与端到端耗时。
3. **降级**：临时置空 `OPENAI_API_KEY` 的 supervisor 分支，确认返回原文关键词搜索结果而非报错页。
4. **存量 session**：用改造前生成的 session（无 `reason` / 无 `planId`）续跑，确认可正常反序列化与续跑。

---

## 7. 验收标准

| 编号 | 验收项 | 判定方式 |
|---|---|---|
| A1 | 评审 3.1 表中 6 组重复逻辑各只剩一份实现 | 代码检索无同名重复函数 |
| A2 | 任何 finish 路径都不会把内部术语透给用户 | `finishReason.test.ts` 词表校验通过 |
| A3 | 开放探索兜底不再触发额外一次 planner 调用 | trace 中同一 turn 的 `model_action` 数量减少 |
| A4 | 单轮串行模型调用 ≤ 4 次（并行开启，4 关键词场景） | turn metrics 日志 `modelCalls` |
| A5 | 服务端静默超阈值时 UI 报错而非无限转圈 | 手工验证 + `api.heartbeat.test.ts` |
| A6 | 失败 turn 在 session 中留有 `error` trace | `chat.route.error.test.ts` + 线上抽查 |
| A7 | 前端 trace 面板能看到所有 guard / runtime 决策 | 手工触发预算耗尽场景 |
| A8 | 可以回答"上一轮花了多少 token、多少毫秒" | turn metrics 日志字段齐全 |
| A9 | D1 单 session 行大小随轮次增长明显放缓 | 对比改造前后 10 轮会话的 `runtime_state_json` 长度 |
| A10 | 死代码清理后 `npm run type-check` 与 `npm test` 通过 | CI |

---

## 8. 风险与回滚

### 8.1 并行 fan-out 放大外部依赖压力

- **风险**：Amap QPS 上升约 3 倍，可能触发配额或限流；evaluation 并发叠加可能触发模型侧 429。
- **缓解**：`AGENT_SEARCH_CONCURRENCY` 默认 3 且可降为 1；沿用 `runBatchedEvaluationAgent` 已有的"429 时降为串行重试"逻辑（`runtimeV3.ts:1245`）。
- **回滚**：`AGENT_PARALLEL_SEARCH=false` 即刻恢复串行，无需发版。

### 8.2 策略合并导致行为变化

- **风险**：M1 中两侧语义不一致的两处（post-authorization 追问、非 strict 距离钳制）合并后 planner 侧行为改变。
- **缓解**：以 runtime 语义为准（功能更全、更符合"非 strict 允许探索"的产品预期），并在测试中显式覆盖两处差异。
- **回滚**：M1 是纯重构，可整体 revert。

### 8.3 心跳超时误杀

- **风险**：客户端心跳超时若先于服务端心跳事件上线，会把正常的长 evaluation 请求杀掉。
- **缓解**：M6.1 的服务端与客户端改动**必须在同一个 PR 内合并、同批发布**；超时值 45s 显著大于 10s 心跳间隔，留足抖动余量。

### 8.4 存量 session 兼容

- **风险**：`reason` / `planId` / trace 过滤等改动作用于 30 分钟 TTL 内的存量 session。
- **缓解**：所有新增字段均为可选并有缺省语义；`agentSessionFromD1Row` 已对缺失字段做 `?? []` 兜底；测试用例 §6.2-4 专门覆盖。

### 8.5 删除 `agentSearch` 与 `monitoring.ts`

- **风险**：外部或未来代码引用被删导出。
- **缓解**：两者当前均零调用方（已检索确认）；`/api/agent/search` 路由保留，仅删客户端函数。

---

## 9. 落地状态（2026-08-12）

| 模块 | 状态 | 说明 |
|---|---|---|
| M1 policy.ts | ✅ 已落地 | 6 组重复逻辑各只剩一份；两处语义差异按 runtime 语义合并 |
| M2 FinishReason | ✅ 已落地 | 删除 EXPLANATION_MAP；`finishReason.test.ts` 含内部术语词表校验 |
| M3 单关键词 schema | ✅ 已落地 | `keywords` 收紧为单值，删除 MULTI_INTENT_KEYWORDS 改写往返与违规码 |
| M4 并行 fan-out | ✅ 已落地（默认关闭） | `AGENT_PARALLEL_SEARCH`；附带修复失败计划被反复重试的缺陷 |
| M5 降级 | ✅ 已落地 | 入口降级只接受 taxonomy 已知餐饮词；验证失败追问区分"没搜到/验证不可用" |
| M6 观测 | ✅ 已落地 | 心跳、失败落 trace、traceId 补齐、契约单源、错误码、模型指标、trace 裁剪、`?include=trace`、日志上下文 |
| M7 模型分级 | ✅ 已落地 | 4 个 env；同时删除命中率接近 0 的进程内评估缓存 |
| M8 清理与可测性 | ✅ 已落地 | 删除 4 个死代码文件；`AGENT_DETERMINISTIC` 取代 NODE_ENV 短路 |
| M8.3 eval 集 | ⬜ 未做 | 指标埋点（M6.6）已就绪，eval 集本身留待后续 |
| 上下文压缩 | ⬜ 未做 | 见评审文档"待优化"第 24 项，已确认暂缓 |

### 验收结果

| 编号 | 结果 |
|---|---|
| A1 重复逻辑各剩一份 | ✅ 代码检索确认 |
| A2 finish 不透内部术语 | ✅ 词表校验用例通过 |
| A3 兜底不再触发额外 planner 调用 | ✅ guard 不再产生 MULTI_INTENT 改写 |
| A4 单轮串行模型调用 ≤ 4 | ⚠️ 结构上成立（fan-out 合并轮次），未在真实模型下实测；指标埋点已就绪 |
| A5 静默超时时 UI 报错 | ✅ `api.heartbeat.test.ts` + 本地流验证 |
| A6 失败 turn 留有 error trace | ✅ 路由用例 + 本地验证（5 条 error trace） |
| A7 前端可见 guard/runtime 决策 | ✅ 强制决策与追问事件均带 traceId（本地流确认） |
| A8 可回答本轮 token/耗时 | ✅ `model_call` trace + turn 日志 |
| A9 D1 单行增长放缓 | ✅ 持久化 trace 仅含决策类节点（本地 18 条，无高频节点） |
| A10 type-check + test 通过 | ✅ 260 tests / 30 suites 全绿，lint 无告警，`npm run build` 通过 |

本地端到端验证（无 OPENAI_API_KEY、无 AMAP_API_KEY 的最恶劣环境）：
理解降级 → 单意图词搜索（火锅/涮锅/中餐，poiType 正确）→ 数据源全失败但逐个记为
已尝试 → 达到预算上限 → 追问暂停。全程无 500，事件流带 planId / traceId / heartbeat。

---

## 10. 与既有文档的关系

- `docs/agent-harness-review-2026-08.md`：本方案的问题依据，编号一一对应（M1↔3.1、M2↔3.1、M3↔3.2、M4↔3.3、M5↔3.6、M6↔3.9、M7↔3.3/3.6、M8↔3.8/3.10）。
- `docs/agent-architecture-review.md`（2026-05）：已过期，其 P0 项已落地，保留作历史记录。
- `docs/Agent优化技术方案.md`（2026-06）：本方案沿用其 §3.1「不做 deterministic verifier fallback」的结论，其余内容已由 Runtime V3 实现覆盖。
- 上下文压缩 / 会话摘要 / prompt caching 不在本方案范围，见评审文档「待优化」第 24 项。
