# Agent 架构治理与演进技术方案

> ⚠️ **已过期，仅作演进记录。** 本文描述的 Agent 架构已被后续两轮改造取代：
> 当前形态见 `docs/agent-loop-shape-review-2026-08.md` 与
> `docs/Agent-Loop-形态重构技术方案-2026-08.md`。

> 本文档针对当前 ChiSha Agent 实现的架构问题给出可落地改造方案。目标不是继续增加子 Agent，而是收敛控制权、强化会话安全、降低模型调用成本，并把“可验证推荐”作为主推荐准入边界。

---

## 一、问题定义

当前主链路为：

```mermaid
graph LR
    U[用户消息] --> API[/api/agent/chat]
    API --> S[SearchSupervisorAgent]
    S --> P[PlanningAgent]
    P --> A[Amap POI Search]
    A --> G[Runtime Hard Guard]
    G --> E[EvaluationAgent]
    E --> VG[Runtime Verdict Guard]
    VG --> R[ResultAssembler]
    R --> UI[前端转盘]
```

这套实现已经有 Agent Runtime、目标结构化、多轮追问、候选验证和 Runtime guard，但仍存在几个核心问题：

1. **Supervisor 不是真正主控 Agent**  
   当前 Supervisor 主要负责初始目标解析和失败追问，运行循环仍由 `runtimeV2` 固定执行 `Planning -> Search -> Evaluation -> Finalize`。

2. **多 Agent 调用成本高且一致性弱**  
   每次搜索可能调用 Supervisor、PlanningAgent、EvaluationAgent，多轮搜索会重复调用 Planning/Evaluation，延迟和 token 成本偏高。

3. **会话 token 暴露完整状态**  
   当前 `agent_state_` token 是 Base64Url 编码的 session JSON，没有签名和加密，用户可篡改 `goal/attempts/candidates`。

4. **追问不是统一 action**  
   追问目前是 `paused result` 和 route 层会话补丁，不是 Agent Loop 的一等动作，难以沉淀 action log 和调试链路。

5. **主推荐准入规则不够集中**  
   EvaluationAgent、deterministic guard、ResultAssembler 都在影响候选是否能成为主推荐，边界分散。

6. **前端没有充分消费 Agent 解释**  
   后端已产出 `tool_start/tool_result/partial_results/unmetConstraints`，但前端主要展示搜索进度和 final 结果。

---

## 二、改造目标

### 2.1 架构目标

1. Supervisor 成为唯一 loop controller，负责决定下一步动作。
2. Runtime 只负责执行工具、校验结构、保护硬约束、保存状态和最终准入。
3. 主推荐必须通过统一准入规则，未验证结果只能进入候补或触发追问。
4. 会话状态服务端可信存储，客户端只持有不可篡改 session id。
5. 降低每轮模型调用次数，避免 PlanningAgent 和 EvaluationAgent 互相重复理解目标。
6. 前端展示 Agent 决策理由、不可验证约束和候补原因。

### 2.2 非目标

- 不引入 LangChain/LangGraph 等重型框架。
- 不重写首页、转盘和历史记录。
- 不让模型直接生成高德 typecode。
- 不让模型绕过距离、排除项、停业等硬约束。
- 不承诺当前数据源无法验证的事实，例如真实菜单、环境、排队、评分可靠性。

---

## 三、目标架构

### 3.1 推荐架构

```mermaid
graph TB
    U[用户消息] --> API[/api/agent/chat]
    API --> SS[SessionStore]
    API --> C[SearchSupervisorAgent]

    C --> D{AgentAction}
    D -- search --> T[search_restaurants Tool]
    T --> HG[HardConstraintGuard]
    HG --> EV[CandidateVerifier]
    EV --> OBS[Observation]
    OBS --> C

    D -- ask_user --> Q[session_paused]
    D -- finish --> FG[FinalGuard]
    FG --> RA[ResultAssembler]
    RA --> UI[final/done]
```

核心变化：

- Supervisor 不再只做 goal parser，而是接收每轮 observation 后继续决策。
- PlanningAgent 可以删除或降级为 Supervisor 内部结构化输出的一部分。
- EvaluationAgent 可以保留，但只作为 `CandidateVerifier` 的可选模型增强；最终准入由 Runtime FinalGuard 决定。
- `ask_user`、`search`、`finish` 都是统一 `AgentAction`，而不是 route 层特殊分支。

### 3.2 组件职责

| 组件 | 职责 | 不允许做的事 |
|---|---|---|
| SearchSupervisorAgent | 维护目标、选择 action、生成追问、决定是否结束 | 编造餐厅事实、生成高德 typecode |
| Runtime | 执行 action、校验 schema、保存状态、限流、超时、日志 | 根据语义偏好替用户做不透明放宽 |
| search_restaurants Tool | 调用高德搜索并返回事实字段 | 修改 goal、决定主推荐 |
| CandidateVerifier | 输出候选验证 verdict | 绕过硬约束 |
| HardConstraintGuard | 确定性过滤距离、排除项、停业等 | 判断“是否真的有某道菜” |
| FinalGuard | 主推荐准入和候补归类 | 编造推荐理由 |
| SessionStore | 可信会话持久化 | 把完整状态暴露给客户端 |

---

## 四、核心数据模型

### 4.1 AgentAction

```typescript
type AgentAction =
  | {
      type: 'search';
      plan: SearchPlan;
    }
  | {
      type: 'ask_user';
      question: PendingQuestion;
    }
  | {
      type: 'finish';
      selectedIds?: string[];
      candidateIds?: string[];
      explanation: string;
      confidence: number;
    };
```

### 4.2 Observation

```typescript
interface AgentObservation {
  actionId: string;
  plan: SearchPlan;
  provider: 'amap' | 'osm';
  rawCount: number;
  hardRejected: Array<{
    restaurantId: string;
    reasons: string[];
  }>;
  verdicts: CandidateVerdict[];
  acceptedPrimaryIds: string[];
  candidateIds: string[];
  unmetConstraints: string[];
}
```

### 4.3 Session State

```typescript
interface AgentSessionState {
  id: string;
  version: 2;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  location: Location;
  messages: AgentMessage[];
  goal?: UserGoal;
  actions: AgentActionRecord[];
  observations: AgentObservation[];
  candidates: RestaurantCandidate[];
  pendingQuestion?: PendingQuestion;
}
```

### 4.4 Session Token

客户端只保存：

```typescript
interface ClientSessionRef {
  sessionId: string;
}
```

生产环境不要再把完整 session JSON 放进 token。若必须无服务端存储，也要改为签名 JWS：

```text
agent_state_v2.<base64url(payload)>.<hmac_signature>
```

最低要求：

- HMAC-SHA256 签名。
- payload 包含 `exp`。
- 服务端校验签名和过期时间。
- 不信任客户端传回的 candidates 作为事实来源。

推荐方案：

- 本地开发：内存 Map。
- Cloudflare/Vercel 生产：KV、D1、Upstash Redis 或数据库。
- 客户端只传 `sessionId`。

---

## 五、Agent Loop 设计

### 5.1 Loop 伪代码

```typescript
async function runSearchAgentV3(input: AgentInput, emit: EmitAgentEvent) {
  const session = await sessionStore.loadOrCreate(input);
  const context = buildRuntimeContext(session, input);

  while (context.actions.length < context.maxActions) {
    const action = await supervisor.decide({
      message: input.query,
      goal: context.goal,
      messages: context.messages,
      attempts: summarizeAttempts(context),
      observations: summarizeObservations(context),
      candidates: summarizeCandidates(context),
      preferenceSummary: input.preferenceSummary,
      limits: context.limits,
    });

    const guardedAction = actionGuard(action, context);
    await sessionStore.appendAction(session.id, guardedAction);

    if (guardedAction.type === 'ask_user') {
      await pauseSession(session.id, guardedAction.question);
      emit({ type: 'question', ...guardedAction.question, sessionId: session.id });
      emit({ type: 'session_paused', sessionId: session.id });
      return { paused: true, question: guardedAction.question };
    }

    if (guardedAction.type === 'finish') {
      const result = finalGuardAndAssemble(context, guardedAction);
      emit({ type: 'final', ...result });
      emit({ type: 'done', ...result });
      return result;
    }

    const observation = await executeSearchAction(guardedAction, context);
    await sessionStore.appendObservation(session.id, observation);
    mergeObservation(context, observation);
    emitObservationEvents(observation, emit);

    if (hasEnoughPrimaryCandidates(context)) {
      continue; // 让 Supervisor 输出 finish，保留解释权。
    }
  }

  const fallbackResult = finalGuardAndAssemble(context, {
    type: 'finish',
    explanation: '已达到搜索上限，返回当前通过验证的结果。',
    confidence: 0.6,
  });
  emit({ type: 'final', ...fallbackResult });
  emit({ type: 'done', ...fallbackResult });
  return fallbackResult;
}
```

### 5.2 actionGuard

`actionGuard` 负责保护模型输出：

1. `search.plan.radiusMeters` 不得超过 strict distance。
2. `search.plan.keywords` 不得包含明确排除项。
3. `broadened/fallback` 在 `allowBroaden=false` 时 `allowedForPrimary=false`。
4. `finish.selectedIds` 必须存在于已观察候选中。
5. `finish` 不能把 `failed/unverified` 直接放入主推荐。
6. 达到搜索上限时强制进入 `finish` 或 `ask_user`。

### 5.3 FinalGuard

主推荐准入规则集中到一个模块：

```typescript
function isPrimaryRecommendationAllowed(
  candidate: RestaurantCandidate,
  context: AgentRuntimeContext
): boolean {
  if (candidate.verification.status !== 'passed') return false;
  if (candidate.verification.hardFailures.length > 0) return false;

  const sourceAttempt = context.attempts[candidate.sourceAttempt - 1];
  if (sourceAttempt?.allowedForPrimary === false) return false;

  if (hasRequiredItems(context.goal)) {
    return candidate.verification.itemMatches.length > 0
      || context.goal.allowBroaden === true;
  }

  return true;
}
```

候补规则：

- `unverified` 可进入候补。
- `broadened/fallback` 且未授权可进入候补。
- `failed` 不进入主推荐，也默认不进入候补，除非用于调试事件。

---

## 六、模型调用收敛

### 6.1 推荐分层

保留两个模型调用角色即可：

1. **SearchSupervisorAgent**
   - 输入：goal、历史消息、attempt summary、observation summary。
   - 输出：`AgentAction`。

2. **CandidateVerifier**
   - 输入：goal、plan、餐厅事实字段。
   - 输出：`CandidateVerdict[]`。
   - 可以先沿用当前 EvaluationAgent。

PlanningAgent 建议删除或内联到 Supervisor 的 `search` action 中。原因：

- 搜索计划是 Supervisor 下一步决策的一部分。
- 独立 PlanningAgent 会重复理解 goal。
- 当前 PlanningAgent 输出后仍需要 Runtime taxonomy 修正，收益有限。

### 6.2 降级路径

当 OpenAI 不可用时：

- `SupervisorFallback` 只做最小解析：原始 query、明确距离/预算/排除项、必要追问。
- 不做复杂菜品/菜系语义推断。
- 不自动 broaden。
- 搜索失败时优先返回追问，而不是泛化推荐。

---

## 七、会话与 API 改造

### 7.1 API 保持

保留现有入口：

```text
POST /api/agent/chat
```

请求：

```typescript
interface AgentChatRequest {
  message: string;
  location: Location;
  sessionId?: string;
  preferenceSummary?: UserPreferenceSummary;
  groupPreferenceSummaries?: UserPreferenceSummary[];
}
```

响应仍为 SSE。

### 7.2 新增可选 API

```text
GET /api/agent/session/:id
DELETE /api/agent/session/:id
```

用途：

- 页面刷新后恢复 pending question。
- 用户主动放弃会话。
- 调试时查看 action/observation summary。

### 7.3 SSE 事件

保留现有事件，新增更可观察的事件：

```typescript
type AgentEvent =
  | { type: 'action'; actionId: string; actionType: AgentAction['type']; summary: string }
  | { type: 'observation'; actionId: string; found: number; accepted: number; rejected: number }
  | { type: 'guardrail'; actionId: string; message: string; severity: 'info' | 'warn' }
  | ExistingAgentEvent;
```

前端第一阶段只需要展示：

- 当前搜索关键词。
- 为什么调整策略。
- 为什么追问。
- 未满足约束前三条。
- 候补是否未验证。

---

## 八、搜索与验证策略

### 8.1 Amap 搜索

继续遵守现有规则：

- 多关键词 fan out，不把无关意图合并成一个 `keywords`。
- `types` 由 Runtime taxonomy 生成。
- 单关键词可用窄 type，多关键词优先 broad `050000` 或逐关键词 type。
- 串行请求可保留限流，但可以按 keyword 级别并发，受全局 QPS scheduler 控制。

建议优化：

1. `amapPoiSearch` 返回 provider meta：

```typescript
interface SearchToolOutput {
  restaurants: Restaurant[];
  providerMeta: {
    rawCount: number;
    keywordStats: Array<{
      keyword: string;
      poiType: string;
      pages: number;
      count: number;
    }>;
  };
}
```

2. Observation 记录每个 keyword 的命中情况，供 Supervisor 决策。

### 8.2 候选验证

验证分三层：

1. **HardConstraintGuard**
   - 距离。
   - 明确排除项。
   - 明确停业。
   - 预算字段存在时的强校验。

2. **FactVerifier**
   - 名称、菜系、地址、typecode、搜索关键词。
   - 不判断真实菜单。

3. **SemanticVerifier**
   - 由模型判断语义兼容性。
   - 没有事实证据时只能输出 `unverified`。

`passed` 的含义必须严格：

- 满足硬约束。
- 明确目标有事实或强语义证据。
- 没有类别冲突。

---

## 九、偏好记忆改造

当前前端从历史记录生成 `UserPreferenceSummary` 可以保留，但需要降低污染：

1. 强正向只来自最终选中的主推荐。
2. 候补、未验证、放宽结果只作为弱信号。
3. 被删除餐厅只作为短期负反馈，避免长期惩罚某菜系。
4. 当次明确需求优先级高于历史偏好。

建议在历史记录中新增：

```typescript
interface AgentHistoryMeta {
  sessionId?: string;
  sourceAttempt?: number;
  searchIntent?: SearchIntent;
  verificationStatus?: 'passed' | 'unverified' | 'failed';
  allowedForPrimary?: boolean;
  matchedItems?: string[];
  matchedCategories?: string[];
}
```

---

## 十、迁移计划

### Phase 1：收敛主推荐准入

目标：不大改 API，先修正推荐质量边界。

任务：

- 新增 `finalGuard.ts`，集中主推荐准入。
- `resultAssembler` 只消费 FinalGuard 输出。
- 禁止 `unverified` 和未授权 broaden/fallback 进入主推荐。
- 补充测试：菜品缺证据、严格距离、排除项、fallback 未授权。

验收：

- 明确菜品没有证据时不进入主推荐。
- 严格距离不会被 Planner 或 Supervisor 放宽。
- 候补和主推荐原因能区分。

### Phase 2：会话安全改造

目标：移除客户端完整状态 token。

任务：

- 新增 `AgentSessionStore` 接口。
- 本地实现 `InMemoryAgentSessionStore`。
- 生产实现 KV/Redis/D1 之一。
- 客户端 sessionId 改为 opaque id。
- 如需兼容旧 token，增加一次性迁移解码，但保存后返回新 id。

验收：

- 客户端不能篡改 goal/candidates。
- 页面刷新后 pending question 可恢复。
- 多实例环境不依赖单进程内存。

### Phase 3：Supervisor 控制 loop

目标：让 Supervisor 输出统一 `AgentAction`。

任务：

- 新增 `runSearchAgentV3`。
- 新增 `AgentActionSchema`。
- Supervisor 输入 observation summary。
- PlanningAgent 降级为 fallback 或删除。
- `ask_user/search/finish` 都走 actionGuard。

验收：

- 搜索后结果不足时，Supervisor 可选择追问而不是固定继续搜。
- 已有足够主推荐时，Supervisor 负责输出 finish explanation。
- action log 可复盘每一步为什么发生。

### Phase 4：模型调用成本优化

目标：降低延迟和 token。

任务：

- 合并 PlanningAgent 到 Supervisor。
- EvaluationAgent 只对 top N 或高风险候选调用。
- 对明显通过/失败的候选先走确定性验证。
- Amap 搜索增加 keyword stats 和缓存命中信息。

验收：

- 常规搜索模型调用次数从 3+ 降到 1-2。
- P95 搜索耗时下降。
- 超时率下降。

### Phase 5：前端解释体验

目标：让 Agent 过程对用户可理解。

任务：

- 展示策略变更原因。
- 展示未满足约束。
- 展示候补标签：未验证、放宽、距离外、数据缺失。
- 追问卡片支持选项 effect，但不暴露内部字段。

验收：

- 用户能看懂为什么没有推荐或为什么出现候补。
- “允许放宽”之后结果变化可解释。

---

## 十一、测试方案

### 11.1 单元测试

新增或调整：

- `finalGuard.test.ts`
- `sessionStore.test.ts`
- `runtimeV3.test.ts`
- `supervisorAction.test.ts`

重点用例：

1. `炸鸡薯条` 搜到普通小吃，不能进入主推荐。
2. `楼下500米` 搜到 800m 餐厅，必须 hard reject。
3. `不要火锅` 搜到火锅，必须 hard reject。
4. `日料或韩餐` 两类都应保留搜索意图。
5. `随便吃点` 可追问或使用历史偏好，但不能伪造具体偏好。
6. `允许放宽` 后 broaden/fallback 才能进入主推荐。
7. 客户端篡改 session payload 不生效。

### 11.2 集成测试

- `/api/agent/chat` 新会话。
- `/api/agent/chat` pending question 续跑。
- session 过期。
- sessionId 不存在。
- Amap 失败时错误事件。
- OpenAI 不可用时 fallback 行为。

### 11.3 回归评估集

维护一组固定 query：

| Query | 预期 |
|---|---|
| 想吃炸鸡薯条 | 主推荐必须命中快餐/炸鸡/薯条证据 |
| 下楼吃日料 | 搜索半径不得超过 500m |
| 不吃辣，随便推荐 | 不优先川菜/湘菜/火锅/烧烤 |
| 日料或韩餐 | 两个意图都应被搜索或说明不足 |
| 预算100以内还开门 | 缺失价格/营业字段必须提示不可完全验证 |
| 没有合适就远一点也行 | allowBroaden=true，可扩大范围 |

---

## 十二、风险与取舍

### 12.1 风险

1. Supervisor 控制 loop 后，提示词质量会直接影响搜索行为。
2. 会话存储引入外部依赖，部署复杂度上升。
3. 更严格准入会导致主推荐数量变少。
4. 前端展示更多解释后，文案质量会影响用户信任。

### 12.2 取舍

- 主推荐数量少但可信，优于凑满 8 家。
- 候补可以宽松，但必须标注原因。
- 模型负责决策和解释，Runtime 负责事实和边界。
- 先保证安全和可解释，再优化个性化。

---

## 十三、建议落地顺序

建议按以下顺序执行：

1. **先做 FinalGuard**  
   风险最低，直接提升推荐质量。

2. **再做 SessionStore**  
   修复生产安全和多实例问题。

3. **再做 runtimeV3**  
   把 Supervisor 变成真正 loop controller。

4. **最后优化前端解释和成本**  
   在后端 action/observation 稳定后再展示更多细节。

---

## 十四、完成后的目标状态

完成改造后，Agent 应满足：

- 用户明确要求不会被系统静默泛化。
- 硬约束不会被自动放宽。
- 搜索失败时能解释原因并追问。
- 候补和主推荐边界清楚。
- 会话状态不可被客户端篡改。
- 每一步 action 和 observation 可复盘。
- 常规搜索成本和延迟可控。

最终形态不是“更多 Agent”，而是“一个可信 Supervisor + 少量受控工具 + 强 Runtime guard”。
