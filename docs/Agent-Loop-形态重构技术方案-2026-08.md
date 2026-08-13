# Agent Loop 形态重构技术方案（2026-08）

> 对应评审：`docs/agent-loop-shape-review-2026-08.md`
> 前置方案：`docs/Agent-Harness-优化技术方案-2026-08.md`（已落地，本方案不回退其成果）

制定日期：2026-08-12
落地状态：M1–M4 + M6a 已合入（见文末「落地记录」）；M5 与 M6b 未启动。

---

## 1. 背景与目标

上一轮把 harness 的工程质量修干净了：策略原语收敛到 `policy.ts`、结束原因枚举化、观测链路打通、降级路径补齐。本轮解决的是**形态**问题——loop 里那个 Planner 模型的剩余决策权，已不足以支撑它每轮一次的串行往返。

目标（可量化）：

| 指标 | 现状 | 目标 |
|---|---|---|
| 典型查询串行模型步 | 7 | ≤3 |
| 典型查询模型 API 调用 | 9 | 4–6 |
| 顺序策略实现份数 | 3 | 1 |
| 同一餐厅重复送评估次数 | 无上限 | 1（同 goalSignature 内） |
| 模型决策路径 eval 覆盖 | 0 | 20–30 条 golden case |

非目标：

- 不改前端状态机与 SSE 事件契约（事件更少、更早，但类型不变）
- 不改 `FinalGuard` 准入语义与授权 scope 模型
- 不做上下文压缩 / 会话摘要（沿用上一轮的暂缓决策）
- 不换模型供应商、不改 `modelClient` 的传输层

---

## 2. 设计原则

1. **模型只做代码枚举不了的事**：理解口语、联想搜索词、判断 POI 是否满足语义目标。控制流归代码。
2. **guard 只校验，不改写**：动作由 policy 生成后，guard 的任何一次拒绝都是编程错误，应当被日志和 eval 抓到，而不是静默修正。
3. **每一步都能回滚**：每个模块带独立开关，可单独关掉回到当前行为。
4. **先有基线，再动行为**：M1 之前不合入任何行为可见的改动。

---

## 3. 模块设计

### M1 `evals/`：离线评测集（阻塞项）

#### 3.1.1 为什么放在第一位

M2–M5 全部行为可见（追问率、主推荐命中、搜索轮数都会变）。没有基线就只能手工点几个 query 拍脑袋。

#### 3.1.2 现成的接缝

`runSearchAgentV3` 的签名天然可测，不需要起 HTTP：

```ts
runSearchAgentV3(
  input: AgentInput,
  emit: EmitAgentEvent,                              // ← 注入计数器
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>   // ← 注入 fixture
): Promise<AgentFinalResult>
```

模型指标已有 `summarizeTurnMetrics(context)`（`metrics.ts`），trace 已有完整节点。评测集只需消费这些，不需要新埋点。

#### 3.1.3 目录与接口

```
evals/
  cases/           # golden query，按场景分组
    exact.json         # 明确菜品/菜系
    open.json          # 随便/都行
    constrained.json   # 距离/预算/排除项
    multiturn.json     # 追问后续答
  fixtures/amap/   # 录制的高德响应，按 (keyword, radius, poiType) 索引
  run.ts           # 入口
  baseline.json    # 上一次结果，用于 diff
```

```ts
// evals/types.ts
export interface EvalCase {
  id: string;
  turns: Array<{ message: string; location: Location }>;
  expect: {
    /** 该轮是否应当追问。undefined 表示不校验 */
    shouldAsk?: boolean;
    /** 主推荐最少条数 */
    minPrimary?: number;
    /** 主推荐中必须出现的菜系（任一命中即可） */
    anyCuisine?: string[];
    /** 主推荐中不允许出现的菜系 */
    noCuisine?: string[];
  };
}

export interface EvalResult {
  caseId: string;
  passed: boolean;
  failures: string[];
  metrics: {
    askedUser: boolean;
    primaryCount: number;
    searchRounds: number;
    /** 串行模型步数：按 trace 中 model_* 节点的时间区间合并计算 */
    serialModelSteps: number;
    modelCalls: number;
    promptTokens: number;
    completionTokens: number;
    wallMs: number;
  };
}
```

```jsonc
// evals/cases/exact.json 示例
[
  {
    "id": "exact-hotpot",
    "turns": [{ "message": "想吃火锅", "location": { "lat": 30.28, "lng": 120.15 } }],
    "expect": { "shouldAsk": false, "minPrimary": 3, "anyCuisine": ["火锅"] }
  },
  {
    "id": "exclude-spicy",
    "turns": [{ "message": "不要辣的，其他都可以", "location": { "lat": 30.28, "lng": 120.15 } }],
    "expect": { "shouldAsk": true }
  }
]
```

#### 3.1.4 运行模式

| 模式 | 模型 | 高德 | 用途 |
|---|---|---|---|
| `npm run eval` | 真实 | fixture | 默认。评测模型决策质量，结果可复现 |
| `npm run eval -- --record` | 真实 | 真实 | 录制/更新 fixture |
| `npm run eval -- --deterministic` | `AGENT_DETERMINISTIC=1` | fixture | 快速回归确定性策略，CI 可跑 |

fixture 命中规则：`${keywords.join('|')}:${radiusMeters}:${poiType ?? ''}`，与 `policy.searchPlanKey` 同构。未命中时 `--record` 模式下真实请求并写入，否则报错列出缺失键。

#### 3.1.5 改动清单

| 文件 | 改动 |
|---|---|
| `evals/**` | 新增 |
| `package.json` | 新增 `eval` script |
| `lib/agent/metrics.ts` | 导出 `serialModelSteps` 计算（按 trace 区间合并，不新增埋点） |

#### 3.1.6 验收

- `npm run eval` 跑完 20–30 条 case 并输出汇总表
- 连续两次运行结果一致（fixture 模式下高德侧完全确定）
- `evals/baseline.json` 提交入库，后续每个模块的 PR 附带 diff

---

### M2 Evaluation 去重与 verdict 缓存

#### 3.2.1 现状

`selectRestaurantsForEvaluation`（`runtimeV3.ts:1494`）只切片不去重，同一餐厅被多个关键词命中就被重复送评估。`source: 'cache'` 是从未写入的枚举（`types.ts:186`、`runtimeV3.ts:1627`）。

#### 3.2.2 目标设计

```ts
// lib/agent/evaluationCache.ts
export interface VerdictCacheEntry {
  verdict: CandidateVerdict;
  goalSignature: string;
  createdAt: number;
}

/** 缓存键：goal 变了签名就变，候选自动失效，与 isCandidateFreshForContext 同一套语义 */
export function verdictCacheKey(goalSignature: string, restaurantId: string): string;

export interface VerdictCache {
  get(key: string): VerdictCacheEntry | undefined;
  set(key: string, entry: VerdictCacheEntry): void;
}

/** 一次请求内的缓存。跨请求缓存留到后续再评估，Workers isolate 短命，收益存疑 */
export function createTurnVerdictCache(): VerdictCache;
```

```ts
// runtimeV3.ts
interface EvaluationSplit {
  /** 需要真正调模型的 */
  toEvaluate: Restaurant[];
  /** 命中缓存，直接复用 verdict 的 */
  cached: Array<{ restaurant: Restaurant; verdict: CandidateVerdict }>;
}

function splitRestaurantsForEvaluation(
  restaurants: Restaurant[],
  cache: VerdictCache,
  goalSignature: string,
  targetCount: number
): EvaluationSplit;
```

#### 3.2.3 两个必须处理的正确性点

**(1) 缓存的是原始 verdict，不是准入结论。**

`applyVerdictGuard`（`guards.ts:64`）会把 `primaryEligible` 与 `plan.allowedForPrimary` 相与。同一家店在 exact 计划（`allowedForPrimary: true`）和未授权 broadened 计划（`false`）下准入结论不同。所以：

> 缓存 EvaluationAgent 的**原始输出**，命中后仍然走一遍 `applyVerdictGuard`，用**当前 plan** 的门控。

**(2) 去重必须重指 `sourceAttempt`，不能只是跳过。**

`isPrimaryRecommendationAllowed`（`finalGuard.ts:70`）读的是 `context.attempts[candidate.sourceAttempt - 1]`。若一家店先被未授权的 broadened 搜索命中（只能进候补），后又被 exact 搜索命中（应当可进主推荐），直接跳过会让它永远停在候补。

> 命中缓存的餐厅仍然走 `evaluateSearchResult` → `mergeCandidates`，带**本次 attempt 的 sourceAttempt**。省掉的只是模型调用，不是候选构造。

对应地，`evaluator.ts:233` `shouldReplaceCandidate` 需要补一条：来源 attempt 可进主推荐的候选优先于不可进主推荐的，优先级高于 score 比较。

#### 3.2.4 改动清单

| 文件 | 改动 |
|---|---|
| `lib/agent/evaluationCache.ts` | 新增 |
| `runtimeV3.ts:1494` | `selectRestaurantsForEvaluation` → `splitRestaurantsForEvaluation` |
| `runtimeV3.ts:1232` | `runSearchPlan` 合并缓存命中与模型输出，`source` 按实际来源标注 |
| `runtimeV3.ts:1617` | `mergeEvaluationOutputs` 的 `source` 判定改为真实来源 |
| `evaluator.ts:233` | `shouldReplaceCandidate` 补 attempt 准入优先级 |

#### 3.2.5 验收

- eval 中「同一 goalSignature 下同一 restaurantId 的 EvaluationAgent 调用次数」恒为 1
- 主推荐结果与基线**逐条一致**（这是零行为变化的一步，任何 diff 都是 bug）
- 多关键词 case 的 `modelCalls` 下降

#### 3.2.6 开关

`AGENT_EVALUATION_CACHE`（默认 `true`）。关闭时走原路径，用于对拍。

---

### M3 policy 成为唯一 planner

#### 3.3.1 现状

顺序决策三写（评审 3.2），且阈值已漂移：`supervisorPlanner.ts:285` 用 `min(6, targetCount)`，`runtimeV3.ts:1046` 用 `targetCount`。

#### 3.3.2 目标接口

```ts
// policy.ts
/** 常量集中，消灭阈值漂移 */
export const POLICY_LIMITS = {
  /** 达到即可结束的不同品牌数 */
  ENOUGH_DISTINCT_BRANDS: 3,
  /** 低于此值仍应尝试联想词 */
  KEEP_EXPANDING_BELOW: 6,
} as const;

export type PolicyDecision =
  | { kind: 'search'; plans: SearchPlan[] }
  | { kind: 'finish'; reason: FinishReason; selectedIds: string[]; candidateIds: string[]; confidence: number }
  /** 确定性策略枯竭，需要模型重新构思方向（见 M5） */
  | { kind: 'need_replan'; exhausted: { triedKeywords: string[]; triedIntents: SearchPlan['searchIntent'][] } }
  /** 需要追问，文案由 Supervisor 生成（见 M5）；降级时用 policy 模板 */
  | { kind: 'need_clarification'; situation: ClarificationSituation; fallbackQuestion: PendingQuestion };

/** 唯一的顺序决策实现 */
export function decideNextAction(ctx: PolicyContext): PolicyDecision;
```

`decideNextAction` 吸收：

- `supervisorPlanner.ts:277` `deterministicSupervisorPlannerAction` 全部分支
- `runtimeV3.ts:1040` `buildExpansionSearchBeforeFinish`
- `runtimeV3.ts:262`、`:291` 预算耗尽兜底

#### 3.3.3 guard 退化为 validate-only

动作由 policy 生成后，guard 不再需要改写与重写：

```ts
// guards.ts（或新建 actionGuard.ts）
export type ActionValidation =
  | { ok: true }
  | { ok: false; violations: GuardrailViolation[] };

export function validateAction(action: AgentAction, ctx: PolicyContext): ActionValidation;
```

违规处理：记 `guard_decision` trace + `logger.error` + eval 计数，然后回落 `decideNextAction` 的下一个决策。**不再请求模型重写。**

删除：

| 位置 | 删除内容 |
|---|---|
| `runtimeV3.ts:669` | `resolveGuardedAction` 的 `request_rewrite` 分支及第二次模型调用（`:710`） |
| `runtimeV3.ts:1040` | `buildExpansionSearchBeforeFinish`（迁入 policy） |
| `types.ts` | `GuardrailDecision` 的 `request_rewrite` 变体 |
| `supervisorPlanner.ts:100` | `ACTION_REWRITE_PROMPT` |
| `supervisorPlanner.ts:277` | `deterministicSupervisorPlannerAction`（迁入 policy） |

保留 `ACTION_SYSTEM_PROMPT` / `ACTION_FUNCTION` / `AgentActionSchema`，M5 的 replan 分支要用。

#### 3.3.4 注意点

- **`guardSearchAction` 的字段规整逻辑不能丢**（排除项过滤、半径 clamp、poiType 解析、重复计划检测）。它们从"事后改写模型输出"变成"policy 构造计划时就正确"——`buildSearchPlan`（`policy.ts:62`）已经做了大部分，缺的是排除项过滤和 `hasTriedPlan` 检查，补进去。
- **保留 `validateAction` 里的重复计划检测**作为断言：policy 不该生成重复计划，生成了就是 bug。
- 阈值统一到 `POLICY_LIMITS` 后，`ENOUGH_DISTINCT_BRANDS` 与 `KEEP_EXPANDING_BELOW` 的组合行为需要 eval 对拍——当前两份实现在 `distinctBrands ∈ [6,8)` 结论相反，统一后必然有一侧行为改变。

#### 3.3.5 改动清单

| 文件 | 改动 |
|---|---|
| `policy.ts` | 新增 `decideNextAction` / `POLICY_LIMITS`；`buildSearchPlan` 补排除项过滤 |
| `runtimeV3.ts` | loop 主体改为消费 `PolicyDecision`；删除 rewrite 分支与 `buildExpansionSearchBeforeFinish` |
| `guards.ts` | 新增 `validateAction`；`guardSearchAction`/`guardFinishAction` 删除或降为断言 |
| `supervisorPlanner.ts` | 删除确定性 planner，只保留 replan 用的模型调用 |
| `types.ts` | `GuardrailDecision` 收敛 |

#### 3.3.6 验收

- `grep -rn "distinctBrands"` 只在 `policy.ts` 命中
- 一轮内 SupervisorPlanner action 模型调用次数 ≤1（M5 之前为 0）
- eval 全部 case 的 `serialModelSteps` 至少下降 2

#### 3.3.7 开关

`AGENT_PLANNER_MODE=policy | model`（默认 `policy`）。`model` 保留旧路径一个版本周期用于对拍，下个版本删除。

---

### M4 plan-once fan-out

#### 3.4.1 目标设计

`decideNextAction` 一次返回整批计划，而不是一个：

```ts
// policy.ts
export function planSearchBatch(ctx: PolicyContext): SearchPlan[] {
  // 1. 未尝试的 initial target 全部入批（exact）
  // 2. 批内额度未满时，按 related → broadened 顺序补齐
  // 3. 受 remainingSearchCalls 与 AGENT_SEARCH_CONCURRENCY 双重约束
  // 4. broadened 仅在无主推荐时入批（沿用 untriedTargetsForParallel 的判断）
}
```

`runtimeV3.ts:1094` 的 `planParallelBatch` 被它取代——区别在于不再需要"模型先给主计划、策略再顺带铺宽"，整批由 policy 直接产出。`executeSearchBatch`（`runtimeV3.ts:1153`）的两阶段结构（只读并行 + 串行提交）保持不变，它是正确的。

#### 3.4.2 首搜与联想词并发

现状 `runtimeV3.ts:171-182` 必须等 KeywordExpansion 返回。改为：

```ts
// 1. Supervisor 返回后立即构造 context（此时 goal 只有 primaryKeywords）
const context = createInitialContext(input, baseGoal, resetPlan);

// 2. exact 批次不依赖联想词，立刻发起
const exactPlans = planSearchBatch(context);               // 只含 initial target
const exactResults = exactPlans.length > 0
  ? executeSearchBatch(actionId, exactPlans, context, searchPlaces, emit)
  : Promise.resolve([]);

// 3. 联想词与首搜并发
const [observations, expansion] = await Promise.all([
  exactResults,
  runKeywordExpansionAgent({ ... }),
]);

// 4. 联想结果并入 goal，供后续批次使用
context.goal = applyKeywordExpansion(context.goal, expansion);
```

约束：

- `applyKeywordExpansion` 只写 `relatedTargets` / `broadenedTargets` / `relatedKeywords` / `broadenedKeywords`，不改主目标 → 不影响 `goalSignature`，已提交的候选不会因此变 stale。**合入前需在 `goalVersion.ts` 加断言测试锁死这一点。**
- 追问路径（`supervisorOutput.question` 或 `clarificationNeeded` 非空）不发起首搜，维持现状。
- 需要 KeywordExpansion 才能产生首搜计划的场景（开放探索，`primaryKeywords` 为空），退化为串行——与现状一致。

#### 3.4.3 并行默认开启

`AGENT_PARALLEL_SEARCH` 默认从 `false` 翻到 `true`；`AGENT_SEARCH_CONCURRENCY` 保持默认 3。

#### 3.4.4 对观测与前端的影响（必须同批处理）

服务端沿用上一轮的约定：`planId` 区分同批次事件、`sourceAttempt` 在串行提交阶段分配。这部分不用改。

**但前端目前完全忽略 `planId`**，这是并行默认开启前必须先补的缺口：

| 位置 | 现状 | 并行后的表现 |
|---|---|---|
| `lib/api.ts:581` | `onSearching(event.keywords, event.round)` —— 不传 `planId` | 3 个并发计划的 `searching` 事件依次触发同一回调 |
| `useRestaurantSearch.ts:244` | 覆盖式写入 `currentKeywords` / `round` / `currentStage` | 后到的覆盖先到的，用户只看到最后一个关键词 |
| `lib/api.ts:584` | `onSearchResult(found, total, ...)` | `total` 是**单个计划**的数量，不是批次累计；进度条数字会来回跳 |

改动：

1. `AgentSearchCallbacks` 的 `onSearching` / `onSearchResult` 透传 `planId`（服务端事件本来就带，只是客户端签名丢了）
2. `SearchProgress` 把 `currentKeywords` 从 `string[]` 改为按 `planId` 索引的 `Map`，展示时合并为「正在搜索「火锅、川菜、烤肉」...」
3. `found` / `total` 改为批次累加，而不是最后一个计划的值

这三条与 M4 同一个 PR 合入，否则并行开启后进度展示会明显劣化。eval 侧另需断言事件顺序不倒挂（同一 `planId` 的 `tool_start` 早于 `tool_result`）。

#### 3.4.5 改动清单

| 文件 | 改动 |
|---|---|
| `policy.ts` | 新增 `planSearchBatch` |
| `runtimeV3.ts:1094` | 删除 `planParallelBatch`，改由 policy 产出整批 |
| `runtimeV3.ts:140` | `runAgentTurn` 重排：context 提前构造，首搜与 KeywordExpansion 并发 |
| `runtimeV3.ts:102` | `AGENT_PARALLEL_SEARCH` 默认翻为 `true`；新增 `AGENT_CONCURRENT_FIRST_SEARCH` |
| `lib/api.ts:58` | `onSearching` / `onSearchResult` 透传 `planId` |
| `hooks/useRestaurantSearch.ts:244` | 进度状态按 `planId` 聚合，`found`/`total` 改累加 |
| `goalVersion.ts` | 新增断言测试：`applyKeywordExpansion` 不改变 `goalSignature` |

#### 3.4.6 验收

- 典型 exact case：串行模型步 = 3（Supervisor / Evaluation / 无 planner），首个 `search_result` 事件早于 KeywordExpansion 完成
- 高德请求数不超过 `min(AGENT_SEARCH_CONCURRENCY, remainingSearchCalls)`
- eval 中 `wallMs` P50 显著下降
- 并行开启后进度文案展示全部并发关键词，`total` 单调不减

---

### M5 replan 与追问归位（P1）

#### 3.5.1 replan

`decideNextAction` 返回 `need_replan` 时（所有关键词试完、仍无主推荐），调一次模型重新构思方向：

```ts
// supervisorPlanner.ts
export async function replanSearchDirection(input: {
  goal: UserGoal;
  exhausted: { triedKeywords: string[]; triedIntents: SearchPlan['searchIntent'][] };
  observations: AgentObservation[];
}): Promise<{ targets: SearchKeywordTarget[] } | null>;
```

- 整轮最多一次，用 `context.replanUsed` 标记
- 返回的 targets 并入 `goal.relatedTargets`，回到 `planSearchBatch`
- 返回 `null` 或调用失败 → 转 `need_clarification`

#### 3.5.2 追问归位

`need_clarification` 携带结构化情形，由 Supervisor 生成文案：

```ts
export type ClarificationSituation =
  | { kind: 'strict_distance_empty'; maxMeters: number }
  | { kind: 'no_primary_after_broaden'; target: string }
  | { kind: 'evaluation_degraded' }
  | { kind: 'no_positive_target' };
```

Supervisor 生成失败或超时 → 用 `policy.buildNoPrimaryQuestion` 的模板兜底（现状行为）。`optionEffects` 的构造仍在 policy（`buildBroadenEffect` / `buildFallbackPrimaryEffect`），模型只负责问句文案——**授权语义不能交给模型**。

---

### M6 prompt 降规则与错误类型化（P2）

#### 3.6.1 词表下沉

```ts
// lib/agent/phrases.ts
/** 明确授权开放推荐的表达 */
export function isOpenExplorationPhrase(message: string): boolean;
/** 软偏好式开放询问（"附近有什么"/"清淡点"），需要追问而非直搜 */
export function isVagueBrowsingPhrase(message: string): boolean;
```

在调用 Supervisor **之前**跑，命中结果作为 `trustedContext.phraseHints` 传入。`supervisor.ts:59-89` 的规则 8 / 8a 从"背词表 + 自行仲裁"改为"参考 phraseHints，冲突时以用户原文语义为准"。

同理处理 `keywordExpansionAgent.ts:32` 的 `OPEN_EXPLORATION_DEMOTED_KEYWORDS`。

目标：Supervisor system prompt 从 24 条压到 ≤10 条原则 + 3 个 few-shot 难例（不要辣的其他都可以 / 附近有什么 / 追问后改口）。

#### 3.6.2 错误类型化

```ts
// lib/agent/types.ts
export class AgentError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode,
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) { super(message, options); }
}
```

在抛出点携带 code：`supervisor.ts:117`、`evaluationAgent.ts:94`、`modelClient.ts:297`（HTTP 状态码 → `RATE_LIMITED` / `SEARCH_PROVIDER_FAILED`）、`lib/amap.ts`。

`toAgentErrorCode`（`runtimeV3.ts:385`）改为：`error instanceof AgentError ? error.code : 'UNKNOWN'`，删除全部正则分支。`evaluationFailureFromError`（`:1515`）、`isLikelyEvaluationRateLimit`（`:1631`）同理。

---

## 4. 落地阶段

| 阶段 | 模块 | 行为可见 | 依赖 | 建议 PR 粒度 |
|---|---|---|---|---|
| 1 | M1 eval | 否 | — | 1 个 PR |
| 2 | M2 去重 + 缓存 | 否（应零 diff） | M1 | 1 个 PR |
| 3 | M3 policy 唯一 planner | **是** | M1、M2 | 2 个 PR（先迁移 policy，再删 guard rewrite） |
| 4 | M4 fan-out | **是** | M3 | 2 个 PR（先批量计划，再首搜并发） |
| 5 | M5 replan + 追问归位 | **是** | M3 | 1 个 PR |
| 6 | M6 prompt + 错误类型 | **是**（prompt 部分） | M1 | 2 个 PR |

阶段 2 是刻意安排的**校验步**：它应当产生零行为 diff，如果 eval 报出 diff，说明 M1 的评测集本身不稳定，必须先修 M1 再往下走。

---

## 5. 测试方案

### 5.1 单元测试

| 模块 | 用例 |
|---|---|
| `policy.decideNextAction` | 每个分支一条：够了 finish / 预算耗尽 / 未授权候选 ask / exact→synonym→broadened 序列 / 枯竭 replan |
| `policy.planSearchBatch` | 批次受 `remainingSearchCalls` 与并发上限双重约束；broadened 仅在无主推荐时入批；不产出重复计划 |
| `POLICY_LIMITS` 边界 | `distinctBrands = 2/3/5/6/8` 五个点的决策 |
| `evaluationCache` | 同 goalSignature 命中；goal 变更后不命中；命中后仍按当前 plan 过 `applyVerdictGuard` |
| `evaluator.shouldReplaceCandidate` | 可进主推荐的 attempt 覆盖不可进主推荐的 |
| `validateAction` | 排除项关键词、重复计划、越界半径全部判违规 |
| `phrases` | 开放授权词 / 软偏好询问词各 10 条正负样本 |
| `AgentError` | 各抛出点的 code 与 retryable |

模型路径用例需在用例内 `delete process.env.AGENT_DETERMINISTIC` 并 mock `fetch`（沿用 `jest.setup.js` 的约定）。

### 5.2 集成

- `runSearchAgentV3` 全链路：注入 fixture `searchPlaces` + mock 模型，断言事件序列与 `runtimeState`
- 并发场景：3 个计划同批，其中 1 个 `searchPlaces` 抛错 → 其余两个正常提交，失败计划记一次空 attempt（现有 `recordFailedAttempt` 行为不变）
- 首搜并发：断言 `search_result` 事件早于 KeywordExpansion 的 `model_call` trace 完成

### 5.3 eval 对拍

每个行为可见的阶段，PR 附 `npm run eval` 的 baseline diff，逐条解释变化原因。允许变差的前提是给出理由并更新 baseline。

---

## 6. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 典型 exact 查询串行模型步 ≤3 | eval `serialModelSteps` |
| 2 | 一轮内 planner action 模型调用 ≤1 | eval `modelCalls` 按 agentName 分组 |
| 3 | 顺序决策只有一份实现 | `grep -rn "distinctBrands\|nextUntriedTarget"` 只命中 `policy.ts` |
| 4 | 同一 `(goalSignature, restaurantId)` 只评估一次 | eval 计数 |
| 5 | `source: 'cache'` 有真实写入方 | 单测 |
| 6 | guard 不再发起模型调用 | `supervisorPlanner` 在 `runtimeV3` 中的引用点 ≤1 |
| 7 | `toAgentErrorCode` 无正则分支 | 代码审查 |
| 8 | Supervisor system prompt ≤10 条规则 | 代码审查 |
| 9 | eval 全绿或 diff 有据 | baseline diff |

---

## 7. 风险与回滚

### 7.1 policy 统一阈值导致行为变化

**风险**：`distinctBrands ∈ [6,8)` 区间当前两份实现结论相反，统一后必有一侧改变（多搜一轮或少搜一轮）。

**处理**：先用 eval 量化两种取值的影响（主推荐命中率 vs 搜索轮数），再定 `KEEP_EXPANDING_BELOW`。这是一个产品取舍，不是纯技术决定。

**回滚**：`AGENT_PLANNER_MODE=model`。

### 7.2 删掉每轮 planner 后，中途追问变差

**风险**：policy 模板追问不如模型生成的贴合上下文，可能导致追问文案生硬、`optionEffects` 指向不准。

**处理**：M5 把文案生成权还给 Supervisor。M3 到 M5 之间的窗口期用模板兜底——与当前的降级路径（模型不可用时）行为一致，不是新风险。

### 7.3 fan-out 放大高德压力

**风险**：单轮从 1 个请求变 ≤3 个并发，`AGENT_POI_PAGES_PER_SEARCH=2` 意味着实际 HTTP 请求 ×2。

**处理**：M2 先落地（Evaluation 调用量净降），高德侧受 `AGENT_SEARCH_CONCURRENCY` 硬约束。eval 中记录高德请求数，超阈值就下调并发。

**回滚**：`AGENT_PARALLEL_SEARCH=false`。

### 7.4 首搜并发引入状态竞态

**风险**：context 在 KeywordExpansion 返回前就已创建并被首搜批次写入，`applyKeywordExpansion` 此时改 goal 可能影响已提交候选的 `goalSignature`。

**处理**：`applyKeywordExpansion` 只写联想字段，不参与 `deriveGoalSignature`。合入前在 `goalVersion.ts` 加断言测试锁死；测试失败即说明该前提被破坏，必须退回串行。

**回滚**：`AGENT_CONCURRENT_FIRST_SEARCH=false`（M4 单独开关，与 `AGENT_PARALLEL_SEARCH` 分离）。

### 7.5 eval fixture 过期

**风险**：高德数据变化后 fixture 与线上脱节，eval 通过但线上退化。

**处理**：`--record` 模式定期刷新（建议每次大版本前），fixture 目录记录录制日期。eval 的定位是**行为回归**，不是线上质量监控——后者靠 3.9 已建立的 metrics 链路。

---

## 8. 环境变量增补

```
AGENT_PLANNER_MODE=policy         # policy | model，默认 policy（M3）
AGENT_PARALLEL_SEARCH=true        # 默认从 false 翻为 true（M4）
AGENT_SEARCH_CONCURRENCY=3        # 一批最多几个计划（M4）
AGENT_CONCURRENT_FIRST_SEARCH=true # 默认 true（M4 首搜并发，独立开关）
```

同步更新 `CLAUDE.md` 的环境变量清单与 `lib/agent/` 职责说明。

---

## 9. 落地记录（2026-08-12）

### 9.1 结果

`npm run eval`（11 个 golden case 全通过）相对改造前基线：

| 指标 | 改造前 | 改造后 | 变化 |
|---|---|---|---|
| 串行搜索步 | 20 | 18 | −2 |
| 搜索关键词数 | 20 | 20 | 0 |
| planner 模型决策次数 | 31 | **0** | −31 |
| 送评估的餐厅条目 | 61 | 50 | −11 |
| 重复评估 | 12 | **1** | −11 |
| 追问率 | 0.308 | 0.308 | 0 |
| 各 case 主推荐数 | — | — | 全部不变 |

单测 299 通过；`npm run build`、`type-check`、`lint` 全绿。
生产构建起服务打真实 HTTP 验证过：无 key 时 Supervisor 正常降级、
policy 独立驱动完整 loop、同一 action 内并发发出 `涮锅`(synonym) 与
`中餐`(broadened)、多轮授权后追问自动升级，全程无挂死。

剩下的那 1 次重复评估是**故意的**：在 `川菜`(exact) 下判失败的店，换到
`火锅`(synonym) 这个更宽的镜头必须重判。见 9.3。

### 9.2 与方案不一致的地方

1. **没有保留 `AGENT_PLANNER_MODE=model` 回滚开关**（方案 3.3.7）。
   保留它就等于保留那份要消灭的重复实现——回滚的正确手段是 `git revert`，
   信心的正确来源是 eval。`deterministicSupervisorPlannerAction` 已删除。

2. **`KEEP_EXPANDING_BELOW` 取 8（targetCount）而不是 planner 侧的 6。**
   方案说这是产品取舍、要用 eval 定。数据：取 6 会让 `exact-hotpot` 主推荐
   从 8 掉到 7；开启 fan-out 后同一批多铺一个关键词不增加串行步数，
   所以选"更宽的阈值 + 并行"。

3. **verdict 复用规则比方案更保守。** 方案 3.2.3 只说"缓存原始裁决"，实现
   收紧为「只复用 `passed`，且产出它的镜头不比当前更宽」。原因见 9.3。

4. **`evaluatePlanCandidates` 做了两轮申领**，方案里没有。并发批次下第一轮
   会把餐厅让给同批其他计划，等完之后若当前镜头下仍无可复用裁决就自己判。
   没有这一轮，fan-out 会把"换个关键词本该通过"的候选吃掉。

5. **M6b（prompt 降规则）未做。** 改 Supervisor prompt 的效果只有 live eval
   能验证，当前环境没有 API key。不做无法验收的改动。

6. **M5（追问文案归还 Supervisor）未单独做**，其价值已被 `runSearchReplan`
   覆盖：策略枯竭时一次模型调用既可以给新搜索词，也可以给贴合上下文的问句。

### 9.3 两个被 eval 抓出来的真实回归

都是实现过程中引入、被 golden case 与单测挡住的，记下来避免重犯：

1. **批次把预算全花在同义词上，饿死了相邻品类。** 旧 planner 的
   `!hasTriedIntent('synonym')` 门其实编码了"一个结果都没有时优先换镜头"
   这个策略，被我在改批量化时丢掉了。修复：`distinctBrands === 0` 时组
   混合批（1 个 synonym + broadened），而不是深挖同义词。

2. **并发 + 裁决缓存吃掉了本该重判的候选。** 「寿司专门店」在「日本料理」
   下判失败，被同批「寿司」计划的 in-flight 合并直接沿用，于是永远不通过。
   修复即 9.2-3 与 9.2-4。

### 9.4 下一步

- M6b：`phrases.ts` 词表下沉 + Supervisor prompt 从 24 条收敛到原则 +
  few-shot。**前置条件是 live eval 能跑**（配 `OPENAI_API_KEY` 后
  `EVAL_MODE=live npm run eval`）。
- 补 live 模式的 `serialModelSteps` 实测：offline 模式下模型是桩，
  首搜与联想词并发省下的那一次往返在指标上看不见。
- eval fixture 定期用 `--record` 刷新（当前为手写的合成数据）。
