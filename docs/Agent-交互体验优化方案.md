# Agent 交互体验优化方案

> ⚠️ **已过期，仅作演进记录。** 本文描述的 Agent 架构已被后续两轮改造取代：
> 当前形态见 `docs/agent-loop-shape-review-2026-08.md` 与
> `docs/Agent-Loop-形态重构技术方案-2026-08.md`。
> SSE 事件契约已变化：并发批次下 searching / search_result 带 planId。

审计日期：2026-06-11
适用范围：前端 Agent 状态展示链路（`LoadingSteps`、`useRestaurantSearch`、`HomePage`）、Agent SSE 事件（`runtimeV3.ts`、`api.ts`）、追问交互（`supervisorPlanner.ts`、`supervisor.ts`）。

## 1. 背景

当前 Agent 已经从简单 LLM 解析演进为 Runtime V3 多轮对话架构。后端的 Agent 能力（目标维护、搜索策略、语义验证、guardrail）已经相当成熟，但前端对 Agent 内部状态的展示仍然停留在"思考中/搜索中/筛选中"三个粗粒度状态，导致：

1. 用户看不到 Agent 在做什么、为什么这么做。
2. 追问选项语义不透明，用户无法做出知情选择。
3. 搜索进度缺乏全局视图，用户不知道何时结束。
4. 技术性术语泄漏到 UI，造成理解障碍。
5. SSE 超时与 Agent 执行时间不匹配，搜索被意外中断。

本方案目标是在不改变 Agent 后端架构的前提下，优化前端对 Agent 状态的展示和交互，提升用户对 Agent 的感知和信任。

## 2. 设计原则

1. **透明但不啰嗦**：展示 Agent 在做什么，但不暴露实现细节（如 guardrail、trace id、action id）。
2. **可理解**：所有面向用户的文案必须是自然语言，不包含技术术语。
3. **可预期**：用户能预估搜索大概需要多久，以及当前处于什么阶段。
4. **可恢复**：追问后有反馈，错误后有明确的恢复路径。
5. **渐进展示**：搜索过程中可以展示部分结果，完成后展示完整结果。

## 3. 问题清单与修复方案

### 3.1 进度消息过于技术化

**问题**：Agent SSE 事件中的消息包含实现细节，直接展示给用户会造成困惑。

**涉及文件**：
- `lib/agent/runtimeV3.ts:186-193` — observation 消息
- `lib/agent/runtimeV3.ts:218-223` — guardrail 消息
- `lib/agent/runtimeV3.ts:765-766` — guard 内部消息
- `hooks/useRestaurantSearch.ts:249-256` — onObservation 回调
- `LoadingSteps.tsx` — 消息展示

**修复方案**：

在 `useRestaurantSearch.ts` 的 SSE 回调中，将技术性消息翻译为用户可理解的消息：

```typescript
// hooks/useRestaurantSearch.ts — 新增消息翻译层
function translateAgentMessage(
  event: AgentEvent,
  progress: SearchProgress
): string | undefined {
  switch (event.type) {
    case 'observation':
      // 原始: "观察到 12 家，5 家可进主推荐，7 家被硬约束过滤"
      // 翻译: "找到 12 家餐厅，其中 5 家符合要求"
      return `找到 ${event.found} 家餐厅，其中 ${event.accepted} 家符合要求`;

    case 'guardrail':
      // 过滤掉所有 guardrail 消息，不展示给用户
      return undefined;

    case 'status':
      // 原始: "SupervisorPlannerAgent 正在维护目标并选择下一步动作..."
      // 翻译: "正在分析您的需求..."
      if (event.message.includes('SupervisorPlanner')) {
        return '正在分析您的需求...';
      }
      if (event.message.includes('KeywordExpansion')) {
        return '正在联想相关搜索词...';
      }
      if (event.message.includes('EvaluationAgent')) {
        return '正在验证推荐结果...';
      }
      return event.message;

    default:
      return undefined;
  }
}
```

在 `runtimeV3.ts` 中，将 `emit({ type: 'guardrail', ... })` 的消息改为内部日志，不再通过 SSE 发送：

```typescript
// lib/agent/runtimeV3.ts — guardrail 消息不发送给前端
function emitGuardrailMessages(
  messages: GuardrailMessage[],
  actionId: string,
  emit: EmitAgentEvent
): void {
  for (const item of messages) {
    // guardrail 消息只记录到 trace，不发送 SSE
    // 用户不需要知道 guard 拦截了什么
    logger.debug('Guardrail decision', {
      actionId,
      message: item.message,
      severity: item.severity,
    });
  }
}
```

**验收标准**：
- 用户在搜索过程中看到的消息都是自然语言，不含"主推荐"、"硬约束"、"Runtime"、"Guard"等术语。
- guardrail 消息不再出现在 `LoadingSteps` 中。

---

### 3.2 追问选项语义不透明

**问题**：追问选项如"允许放宽"、"换个类型"对用户来说含义模糊，用户不知道选择后会发生什么。

**涉及文件**：
- `lib/agent/runtimeV3.ts:1420-1467` — `buildNoPrimaryQuestion`
- `lib/agent/supervisorPlanner.ts:408-456` — `buildFailureQuestionAction`
- `LoadingSteps.tsx:174-224` — 问题展示

**修复方案**：

**方案 A：选项文案优化（后端）**

在 `buildNoPrimaryQuestion` 和 `buildFailureQuestionAction` 中，将选项文案改为描述实际效果：

```typescript
// lib/agent/runtimeV3.ts — 选项文案优化
function buildNoPrimaryQuestion(context: AgentV3Context): PendingQuestion {
  const target = [
    ...context.goal.requestedItems.map((item) => item.name),
    ...context.goal.primaryKeywords,
  ].filter(Boolean).slice(0, 3).join('、');

  const hasStrictDistance = context.goal.hardConstraints.some((constraint) =>
    constraint.kind === 'distance' && constraint.strict
  );

  if (hasStrictDistance) {
    return {
      reason: '当前严格距离范围内没有找到通过主推荐准入的餐厅。',
      question: '当前距离范围内没有找到合适餐厅，要扩大范围再搜吗？',
      // 选项文案描述实际效果
      options: ['搜远一点（5km内）', '换个类型'],
      allowFreeText: true,
      optionEffects: {
        '搜远一点（5km内）': {
          allowBroaden: true,
          setDistanceMaxMeters: 5000,
          addAuthorizations: [{ /* ... */ }],
        },
      },
    };
  }

  return {
    reason: '没有找到通过主推荐准入的餐厅。',
    question: target
      ? `没有找到符合「${target}」的餐厅，要调整需求或允许放宽吗？`
      : '没有找到符合条件的餐厅，要调整需求或允许放宽吗？',
    // 选项文案优化
    options: ['搜更广的品类', '换个类型'],
    allowFreeText: true,
    optionEffects: {
      '搜更广的品类': allowBroadenQuestionEffect(context.goal),
    },
  };
}
```

**方案 B：前端增加选项描述（前端）**

在 `LoadingSteps.tsx` 中，为每个选项增加 tooltip 或描述文字：

```typescript
// LoadingSteps.tsx — 选项增加描述
interface QuestionOption {
  label: string;
  description?: string;
  effect?: ClarificationEffect;
}

// 在按钮下方显示效果描述
{question.options && question.options.length > 0 && (
  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
    {question.options.map((option) => (
      <div key={option} className="relative group">
        <Button
          variant="secondary"
          size="md"
          onClick={() => submitReply(option)}
          disabled={isReplying}
          loading={isReplying}
          className="w-full"
        >
          {option}
        </Button>
        {/* hover 时显示效果描述 */}
        {question.optionEffects?.[option] && (
          <div className="absolute z-10 hidden group-hover:block bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-dark text-white text-xs rounded-lg whitespace-nowrap">
            {describeEffect(question.optionEffects[option])}
          </div>
        )}
      </div>
    ))}
  </div>
)}
```

**方案 C：增加"你推荐"选项**

在追问选项末尾增加一个"你推荐"按钮，让 Agent 自行决策：

```typescript
// LoadingSteps.tsx — 增加"你推荐"选项
{question.allowFreeText && (
  <div className="flex gap-2 mt-2">
    <form
      className="flex gap-2 flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        submitReply(reply);
      }}
    >
      <input
        value={reply}
        onChange={(event) => setReply(event.target.value)}
        disabled={isReplying}
        placeholder="输入其他想法..."
        className="min-w-0 flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
        maxLength={120}
      />
      <Button
        type="submit"
        size="md"
        disabled={!reply.trim() || isReplying}
        loading={isReplying}
      >
        继续
      </Button>
    </form>
    {/* "你推荐"按钮 */}
    <Button
      variant="secondary"
      size="md"
      onClick={() => submitReply('你推荐')}
      disabled={isReplying}
      loading={isReplying}
    >
      你推荐
    </Button>
  </div>
)}
```

然后在 `supervisor.ts` 的 `SYSTEM_PROMPT` 中增加规则：

```
18. 如果用户回复"你推荐"、"你决定"、"随便"、"都行"，表示授权 Agent 自行决策最佳推荐，
    输出 patch.allowBroaden=true，加入"默认多样性"软偏好，不要再追问。
```

**验收标准**：
- 选项文案描述实际效果（如"搜远一点"而非"允许放宽"）。
- hover 选项时能看到效果描述。
- 存在"你推荐"按钮，点击后 Agent 自行决策。

---

### 3.3 多轮搜索缺乏全局进度视图

**问题**：用户只看到"第 X 轮搜索"，不知道总共会搜几轮、当前处于什么阶段。

**涉及文件**：
- `hooks/useRestaurantSearch.ts:27-38` — `SearchProgress` 类型
- `LoadingSteps.tsx:226-255` — 搜索进度展示
- `lib/agent/runtimeV3.ts:163` — `maxActions` 循环

**修复方案**：

扩展 `SearchProgress` 类型，增加全局进度信息：

```typescript
// hooks/useRestaurantSearch.ts — 扩展进度类型
export interface SearchProgress {
  status: 'idle' | 'thinking' | 'searching' | 'filtering' | 'question' | 'done' | 'error';
  message: string;
  currentKeywords?: string[];
  round?: number;
  found?: number;
  total?: number;
  foundRestaurants?: SearchResultRestaurant[];
  question?: AgentQuestion;
  // 新增：全局进度
  maxRounds?: number;           // 总轮数上限
  completedRounds?: number;     // 已完成轮数
  targetCount?: number;         // 目标推荐数
  currentStage?: 'exact' | 'synonym' | 'broadened' | 'fallback'; // 当前搜索策略
}
```

在 `useRestaurantSearch.ts` 的 SSE 回调中填充这些字段：

```typescript
onAction: (summary, actionType) => {
  setProgress(prev => ({
    ...prev,
    status: actionType === 'search' ? 'searching' : prev.status,
    message: summary,
    // 从 action summary 中提取策略阶段
    currentStage: extractStageFromSummary(summary),
  }));
},
onObservation: (found, accepted, rejected) => {
  setProgress(prev => ({
    ...prev,
    status: 'searching',
    message: `找到 ${found} 家餐厅，其中 ${accepted} 家符合要求`,
    found,
    completedRounds: (prev.completedRounds ?? 0) + 1,
  }));
},
```

在 `LoadingSteps.tsx` 中展示全局进度：

```typescript
// LoadingSteps.tsx — 全局进度展示
{(status === 'searching' || status === 'filtering') && (
  <div className="space-y-3 mb-6">
    {/* 当前搜索关键词 */}
    {currentKeywords && currentKeywords.length > 0 && (
      <div className="flex flex-wrap gap-2">
        {currentKeywords.map((keyword, index) => (
          <span
            key={index}
            className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary"
          >
            {keyword}
          </span>
        ))}
      </div>
    )}

    {/* 全局进度 */}
    <div className="flex items-center justify-between text-sm font-medium text-[#76695e]">
      {round && maxRounds && (
        <span>第 {round}/{maxRounds} 轮搜索</span>
      )}
      {round && !maxRounds && (
        <span>第 {round} 轮搜索</span>
      )}
      {total !== undefined && total > 0 && (
        <span className="font-bold text-primary">
          已找到 {total} 家
          {targetCount && ` / 目标 ${targetCount} 家`}
        </span>
      )}
    </div>

    {/* 搜索策略阶段 */}
    {currentStage && (
      <div className="text-xs text-[#9a8d81]">
        {stageLabel[currentStage]}
      </div>
    )}
  </div>
)}

// 策略阶段标签
const stageLabel: Record<string, string> = {
  exact: '精确搜索',
  synonym: '近似搜索',
  broadened: '扩展搜索',
  fallback: '通用搜索',
};
```

**验收标准**：
- 用户能看到"第 2/4 轮搜索"这样的全局进度。
- 用户能看到当前搜索策略（精确/近似/扩展/通用）。
- 用户能看到目标推荐数。

---

### 3.4 SSE 超时与 Agent 执行时间不匹配

**问题**：前端 60 秒超时可能在 Agent 执行完成前中断连接。

**涉及文件**：
- `lib/api.ts:720` — `requestAgentStream` 超时设置
- `lib/agent/runtimeV3.ts:76-79` — Agent 内部配置

**修复方案**：

**方案 A：前端超时与 Agent 执行解耦**

前端超时只针对"没有收到任何 SSE 事件"的情况，而非整个请求：

```typescript
// lib/api.ts — 超时改为心跳检测
async function requestAgentStream(
  endpoint: string,
  body: unknown,
  callbacks?: AgentSearchCallbacks,
  signal?: AbortSignal
): Promise<AgentSearchResult> {
  const controller = new AbortController();
  let lastEventTime = Date.now();
  let timeoutId: ReturnType<typeof setTimeout>;

  // 心跳检测：如果 30 秒内没有收到任何事件，才超时
  const resetTimeout = () => {
    lastEventTime = Date.now();
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      controller.abort();
    }, 30000);
  };

  resetTimeout();

  if (signal) {
    signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    // ... SSE 解析逻辑不变 ...

    // 每收到一个 SSE 事件，重置超时
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        resetTimeout(); // 收到事件，重置超时
        // ... 解析逻辑 ...
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**方案 B：后端增加进度心跳**

在 Agent 执行过程中，定期发送心跳事件：

```typescript
// lib/agent/runtimeV3.ts — 增加心跳
async function runSearchAgentV3(
  input: AgentInput,
  emit: EmitAgentEvent,
  searchPlaces: (plan: SearchPlan) => Promise<Restaurant[]>
): Promise<AgentFinalResult> {
  // 启动心跳
  const heartbeatInterval = setInterval(() => {
    emit({ type: 'status', message: '仍在搜索中，请稍候...' });
  }, 15000);

  try {
    // ... 原有逻辑 ...
  } finally {
    clearInterval(heartbeatInterval);
  }
}
```

**推荐方案 A**，因为：
- 不增加后端复杂度。
- 前端超时逻辑更精确（基于实际事件流而非固定时间）。
- Agent 执行时间不受前端超时限制。

**验收标准**：
- Agent 执行超过 60 秒时，前端不会意外断开（只要有事件在流动）。
- Agent 真正卡死时（30 秒无事件），前端能正确超时。

---

### 3.5 错误恢复粒度太粗

**问题**：Agent 流中任何 error 事件都会终止整个搜索，但有些错误是可恢复的。

**涉及文件**：
- `lib/api.ts:870-872` — error 事件处理
- `lib/api.ts:644-646` — agentSearch error 处理
- `hooks/useRestaurantSearch.ts:328-358` — 错误处理

**修复方案**：

区分可恢复错误和不可恢复错误：

```typescript
// lib/api.ts — 错误分类
interface AgentError {
  message: string;
  code: string;
  recoverable: boolean;
}

function classifyAgentError(message: string): AgentError {
  // 不可恢复错误
  if (message.includes('会话已过期')) {
    return { message, code: 'SESSION_EXPIRED', recoverable: false };
  }
  if (message.includes('OPENAI_API_KEY')) {
    return { message, code: 'CONFIG_ERROR', recoverable: false };
  }

  // 可恢复错误（Agent 可能已经部分完成）
  if (message.includes('搜索超时')) {
    return { message, code: 'SEARCH_TIMEOUT', recoverable: true };
  }
  if (message.includes('EvaluationAgent')) {
    return { message, code: 'EVALUATION_FAILED', recoverable: true };
  }

  return { message, code: 'UNKNOWN_ERROR', recoverable: true };
}
```

在 SSE 解析中，可恢复错误不立即抛出，而是记录并在流结束后处理：

```typescript
// lib/api.ts — 可恢复错误处理
case 'error': {
  const agentError = classifyAgentError(event.message);
  if (agentError.recoverable) {
    // 记录错误，但不终止流
    recoverableErrors.push(agentError);
    callbacks?.onError?.(event.message);
    // 不 throw，继续读取流
  } else {
    // 不可恢复错误，立即终止
    callbacks?.onError?.(event.message);
    throw new APIError(event.message, agentError.code);
  }
  break;
}
```

在流结束后，如果有可恢复错误但没有结果，才抛出错误：

```typescript
// 流结束后检查
if (result.restaurants.length === 0 && recoverableErrors.length > 0) {
  throw new APIError(
    recoverableErrors[recoverableErrors.length - 1].message,
    recoverableErrors[recoverableErrors.length - 1].code
  );
}
```

**验收标准**：
- 单个 POI 搜索失败时，Agent 能继续执行后续策略。
- EvaluationAgent 失败时，Agent 能返回未验证的候补结果。
- 只有真正不可恢复的错误才终止搜索。

---

### 3.6 Agent Explanation 对用户不友好

**问题**：Agent 完成搜索后的 explanation 包含技术术语，显示在结果页面。

**涉及文件**：
- `lib/agent/runtimeV3.ts:202, 235, 609, 624` — explanation 文案
- `HomePage.tsx:454-467` — explanation 展示

**修复方案**：

在 `runtimeV3.ts` 中，将技术性 explanation 替换为用户可理解的文案：

```typescript
// lib/agent/runtimeV3.ts — explanation 文案优化
const EXPLANATION_MAP: Record<string, string> = {
  '已达到搜索上限，返回当前通过验证的推荐。':
    '已为您搜索附近多个方向，以下是精选推荐。',
  '已达到 Agent 动作上限，返回当前通过验证的结果。':
    '已为您完成全面搜索，以下是最佳推荐。',
  'Guard 拒绝继续执行该动作，返回当前通过验证的推荐。':
    '已为您找到合适餐厅，以下是推荐结果。',
  '没有更多可验证搜索策略，返回当前通过验证的推荐。':
    '已为您搜索多个方向，以下是精选推荐。',
  '已达到本轮搜索动作上限，Runtime 强制进入结束或追问。':
    '搜索已完成，以下是推荐结果。',
};

function translateExplanation(rawExplanation: string): string {
  return EXPLANATION_MAP[rawExplanation] ?? rawExplanation;
}
```

在 `finish` 函数中使用翻译后的 explanation：

```typescript
// lib/agent/runtimeV3.ts — finish 函数
function finish(
  context: AgentV3Context,
  action: Extract<AgentAction, { type: 'finish' }>,
  emit: EmitAgentEvent
): AgentFinalResult {
  // ...

  const finalResult = finalizeRecommendations(context, {
    selectedIds: action.selectedIds,
    candidateIds: action.candidateIds,
    explanation: translateExplanation(action.explanation), // 翻译
    confidence: action.confidence,
  });

  // ...
}
```

**验收标准**：
- 结果页面的 explanation 不包含"搜索上限"、"Agent 动作上限"、"Guard"、"Runtime"等术语。
- explanation 是自然语言，用户能理解。

---

### 3.7 追问响应后没有反馈

**问题**：用户回答追问后，直接进入搜索，没有确认 Agent 理解了什么。

**涉及文件**：
- `hooks/useRestaurantSearch.ts:381-393` — `answerQuestion`
- `LoadingSteps.tsx:141-149` — `submitReply`

**修复方案**：

在 `answerQuestion` 被调用后，立即设置一个过渡状态：

```typescript
// hooks/useRestaurantSearch.ts — 追问响应反馈
const answerQuestion = useCallback(
  async (answer: string, onError?: (errorCode: string) => void) => {
    const question = activeQuestionRef.current ?? progress.question ?? state.agentQuestion;
    const location = activeLocationRef.current;

    if (!question || !location) {
      setError('当前没有可继续的 Agent 会话');
      return;
    }

    // 立即设置反馈状态
    setProgress({
      status: 'thinking',
      message: `好的，正在按您的要求「${answer}」继续搜索...`,
    });

    await runChatSearch(answer, location, onError, question.sessionId);
  },
  [progress.question, runChatSearch, setError, state.agentQuestion]
);
```

在 `LoadingSteps.tsx` 中，追问响应后显示确认消息：

```typescript
// LoadingSteps.tsx — 追问响应确认
const submitReply = async (answer: string) => {
  const cleanedAnswer = answer.trim();
  if (!cleanedAnswer || isReplying) {
    return;
  }

  setReply('');
  // 先显示确认消息
  setProgress({
    status: 'thinking',
    message: `好的，正在按您的要求「${cleanedAnswer}」继续搜索...`,
  });
  await onQuestionReply?.(cleanedAnswer);
};
```

**验收标准**：
- 用户回答追问后，立即看到"好的，正在按您的要求「xxx」继续搜索..."的确认消息。
- 确认消息包含用户选择的内容。

---

### 3.8 Agent Trace 未被利用

**问题**：Agent trace 被收集但从未展示给用户，缺少透明度。

**涉及文件**：
- `hooks/useRestaurantSearch.ts:129-131` — `appendAgentTrace`
- `context/AppReducer.ts:176-189` — trace 状态管理
- `HomePage.tsx` — 无 trace 展示

**修复方案**：

在结果页面增加一个可折叠的"搜索过程"面板：

```typescript
// components/restaurant/ResultPanel.tsx — 新增 trace 展示
export const ResultPanel: React.FC<{
  restaurants: Restaurant[];
  explanation?: string;
  agentTrace?: AgentTraceEvent[];
}> = ({ restaurants, explanation, agentTrace }) => {
  const [showTrace, setShowTrace] = useState(false);

  return (
    <div className="space-y-4">
      {/* 原有结果展示 */}

      {/* Agent 搜索过程（可折叠） */}
      {agentTrace && agentTrace.length > 0 && (
        <div className="border-t border-gray-200 pt-4">
          <button
            onClick={() => setShowTrace(!showTrace)}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showTrace ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            查看搜索过程
          </button>

          {showTrace && (
            <div className="mt-3 space-y-2">
              {agentTrace.map((trace, index) => (
                <div
                  key={trace.traceId ?? index}
                  className="flex items-start gap-2 text-xs text-gray-500"
                >
                  <span className="flex-shrink-0 w-4 h-4 rounded-full bg-gray-100 flex items-center justify-center text-[10px]">
                    {index + 1}
                  </span>
                  <span>{trace.message ?? trace.type}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
```

**验收标准**：
- 结果页面有"查看搜索过程"入口。
- 点击后能看到 Agent 的搜索步骤摘要。
- 默认折叠，不干扰主要结果展示。

---

### 3.9 partial_results 未被利用

**问题**：Agent 每轮搜索后发送 partial_results，但前端忽略。

**涉及文件**：
- `lib/api.ts:602-603` — partial_results 处理
- `hooks/useRestaurantSearch.ts` — 无 partial_results 处理

**修复方案**：

在搜索过程中展示部分结果，改善感知速度：

```typescript
// hooks/useRestaurantSearch.ts — 处理 partial_results
onPartialResults?: (restaurants: Restaurant[]) => void;
```

```typescript
// lib/api.ts — partial_results 处理
case 'partial_results':
  callbacks?.onPartialResults?.(event.restaurants);
  break;
```

```typescript
// hooks/useRestaurantSearch.ts — 搜索过程中展示部分结果
const [partialRestaurants, setPartialRestaurants] = useState<Restaurant[]>([]);

// 在搜索回调中
onPartialResults: (restaurants) => {
  setPartialRestaurants(restaurants);
  setProgress(prev => ({
    ...prev,
    foundRestaurants: restaurants.slice(0, 8).map(r => ({
      id: r.id,
      name: r.name,
      cuisineType: r.cuisineType,
      distance: r.distance,
    })),
  }));
},
```

**验收标准**：
- 搜索过程中能看到部分已找到的餐厅列表。
- 部分结果实时更新，改善感知速度。

---

### 3.10 追问可能重复

**问题**：Agent 可能重复提出相同的追问。

**涉及文件**：
- `lib/agent/runtimeV3.ts:700-717` — `guardAskUserAction`
- `lib/agent/supervisor.ts:64-85` — SYSTEM_PROMPT

**修复方案**：

在前端增加追问次数限制：

```typescript
// hooks/useRestaurantSearch.ts — 追问次数限制
const MAX追问次数 = 3;
const 追问计数Ref = useRef(0);

// 在 onQuestion 回调中
onQuestion: (question) => {
  追问计数Ref.current += 1;
  if (追问计数Ref.current > MAX追问次数) {
    // 超过追问上限，自动选择"你推荐"
    setQuestionProgress({
      ...question,
      options: ['你推荐'],
      allowFreeText: false,
    });
  } else {
    setQuestionProgress(question);
  }
},
```

在搜索开始时重置计数：

```typescript
// 搜索开始时重置
追问计数Ref.current = 0;
```

**验收标准**：
- 追问次数超过 3 次时，自动切换为"你推荐"选项。
- 用户不会被反复追问相同的问题。

---

### 3.11 搜索关键词展示不一致

**问题**：guard 可能拦截多关键词计划并重写，导致用户看到的关键词与实际搜索的不一致。

**涉及文件**：
- `LoadingSteps.tsx:230-240` — 关键词展示
- `hooks/useRestaurantSearch.ts:194-201` — onSearching 回调

**修复方案**：

在 `onSearching` 回调中，只展示最终执行的关键词（guard 重写后的）：

```typescript
// hooks/useRestaurantSearch.ts — 关键词展示优化
onSearching: (keywords, round) => {
  // keywords 已经是 guard 重写后的单关键词
  setProgress(prev => ({
    ...prev,
    status: 'searching',
    message: `正在搜索「${keywords.join('、')}」...`,
    currentKeywords: keywords, // 这里已经是最终执行的关键词
    round,
  }));
},
```

**验收标准**：
- 展示的关键词与实际搜索的关键词一致。
- 不会出现"正在搜索「川菜、火锅」"但实际只搜了"川菜"的情况。

---

### 3.12 Agent 搜索策略变化对用户不透明

**问题**：Agent 从 exact → synonym → broadened → fallback 策略切换，但用户只看到"第 X 轮搜索"。

**涉及文件**：
- `lib/agent/runtimeV3.ts:944` — searching 事件
- `hooks/useRestaurantSearch.ts:194-201` — onSearching 回调

**修复方案**：

在 `SearchPlan` 中已经包含 `searchIntent`，在 SSE 事件中传递：

```typescript
// lib/agent/runtimeV3.ts — searching 事件增加策略
emit({
  type: 'searching',
  keywords: plan.keywords,
  round,
  searchIntent: plan.searchIntent, // 新增
});
```

```typescript
// lib/api.ts — 事件类型扩展
| { type: 'searching'; keywords: string[]; round: number; searchIntent?: string }
```

```typescript
// hooks/useRestaurantSearch.ts — 展示策略
onSearching: (keywords, round, searchIntent) => {
  setProgress(prev => ({
    ...prev,
    status: 'searching',
    message: `正在搜索「${keywords.join('、')}」...`,
    currentKeywords: keywords,
    round,
    currentStage: searchIntent as SearchProgress['currentStage'],
  }));
},
```

**验收标准**：
- 用户能看到当前搜索策略（精确/近似/扩展/通用）。
- 策略切换时有明确的视觉提示。

---

### 3.13 Agent 会话恢复后的状态不一致

**问题**：会话恢复时可能遇到过期、损坏或并发操作。

**涉及文件**：
- `hooks/useRestaurantSearch.ts:372-378` — session 复用
- `app/api/agent/chat/route.ts:140-165` — session 加载

**修复方案**：

在前端增加会话有效性检查：

```typescript
// hooks/useRestaurantSearch.ts — 会话恢复检查
const search = useCallback(
  async (query: string, location: Location, onError?: (errorCode: string) => void) => {
    activeQuestionRef.current = null;
    const sessionId = activeSessionIdRef.current ?? state.agentSessionId ?? undefined;

    // 如果有 sessionId，先检查会话是否有效
    if (sessionId) {
      try {
        // 尝试恢复会话
        await runChatSearch(query, location, onError, sessionId);
      } catch (error) {
        if (error instanceof APIError && error.code === 'SESSION_EXPIRED') {
          // 会话过期，清除 sessionId 并重试
          activeSessionIdRef.current = null;
          setAgentSessionId(null);
          await runChatSearch(query, location, onError, undefined);
        } else {
          throw error;
        }
      }
    } else {
      await runChatSearch(query, location, onError, undefined);
    }
  },
  [runChatSearch, state.agentSessionId, setAgentSessionId]
);
```

**验收标准**：
- 会话过期时，自动清除旧 sessionId 并重新开始搜索。
- 用户不会看到"会话已过期"错误后需要手动重试。

---

### 3.14 没有"让我看看 Agent 做了什么"的入口

**问题**：Agent trace 被收集但没有 UI 入口展示。

**修复方案**：见 3.8。

---

### 3.15 追问选项数量和布局受限

**问题**：固定网格布局在选项数量/长度变化时体验不稳定。

**涉及文件**：
- `LoadingSteps.tsx:181` — 固定 `grid-cols-3`

**修复方案**：

根据选项数量动态调整布局：

```typescript
// LoadingSteps.tsx — 动态布局
const getGridCols = (optionCount: number) => {
  if (optionCount <= 2) return 'grid-cols-2';
  if (optionCount <= 3) return 'grid-cols-3';
  return 'grid-cols-2'; // 4+ 个选项用 2 列
};

{question.options && question.options.length > 0 && (
  <div className={`grid gap-2 ${getGridCols(question.options.length)}`}>
    {question.options.map((option) => (
      <Button
        key={option}
        variant="secondary"
        size="md"
        onClick={() => submitReply(option)}
        disabled={isReplying}
        loading={isReplying}
        className="w-full"
      >
        {option}
      </Button>
    ))}
  </div>
)}
```

**验收标准**：
- 2 个选项时用 2 列布局。
- 3 个选项时用 3 列布局。
- 4+ 个选项时用 2 列布局，避免过窄。

---

## 4. 实施计划

### Phase 1：消息翻译与文案优化（1-2 天）

优先级最高，直接改善用户体验。

改动文件：
- `hooks/useRestaurantSearch.ts` — 增加消息翻译层
- `LoadingSteps.tsx` — 展示翻译后的消息
- `lib/agent/runtimeV3.ts` — explanation 文案优化

任务：
1. 实现 `translateAgentMessage` 函数。
2. 实现 `translateExplanation` 函数。
3. 过滤 guardrail 消息。
4. 测试所有搜索场景的消息展示。

验收：
- 所有面向用户的文案都是自然语言。
- 不包含技术术语。

### Phase 2：追问交互优化（1-2 天）

优先级高，直接影响用户决策。

改动文件：
- `lib/agent/runtimeV3.ts` — 选项文案优化
- `lib/agent/supervisorPlanner.ts` — 选项文案优化
- `LoadingSteps.tsx` — 增加"你推荐"按钮、选项描述
- `hooks/useRestaurantSearch.ts` — 追问响应反馈

任务：
1. 优化追问选项文案。
2. 增加"你推荐"按钮。
3. 实现追问响应反馈。
4. 增加追问次数限制。

验收：
- 选项文案描述实际效果。
- 存在"你推荐"按钮。
- 追问响应后有确认消息。

### Phase 3：进度展示优化（1 天）

优先级中等，改善感知速度。

改动文件：
- `hooks/useRestaurantSearch.ts` — 扩展 SearchProgress
- `LoadingSteps.tsx` — 全局进度展示
- `lib/api.ts` — SSE 事件扩展

任务：
1. 扩展 SearchProgress 类型。
2. 在 SSE 回调中填充全局进度。
3. 在 LoadingSteps 中展示全局进度。
4. 实现 partial_results 展示。

验收：
- 用户能看到全局进度（轮数、目标数）。
- 能看到搜索策略阶段。
- 搜索过程中能看到部分结果。

### Phase 4：超时与错误恢复（1 天）

优先级中等，改善稳定性。

改动文件：
- `lib/api.ts` — 超时改为心跳检测
- `lib/agent/runtimeV3.ts` — 错误分类
- `hooks/useRestaurantSearch.ts` — 会话恢复检查

任务：
1. 实现心跳检测超时。
2. 实现错误分类。
3. 实现会话恢复检查。

验收：
- Agent 执行超过 60 秒时不会意外断开。
- 可恢复错误不终止搜索。
- 会话过期时自动重试。

### Phase 5：Trace 可视化（1 天）

优先级低，锦上添花。

改动文件：
- `components/restaurant/ResultPanel.tsx` — trace 展示
- `context/AppReducer.ts` — trace 状态管理

任务：
1. 实现 trace 折叠面板。
2. 展示搜索步骤摘要。

验收：
- 结果页面有"查看搜索过程"入口。
- 默认折叠，不干扰主要结果。

---

## 5. 验收标准

整体完成后，应满足：

1. 所有面向用户的 Agent 消息都是自然语言，不含技术术语。
2. 追问选项描述实际效果，用户能做出知情选择。
3. 存在"你推荐"按钮，用户不想做选择时有出路。
4. 搜索进度有全局视图（轮数、目标数、策略阶段）。
5. 追问响应后有确认消息。
6. SSE 超时基于心跳检测，不会意外中断。
7. 可恢复错误不终止搜索。
8. 会话过期时自动重试。
9. 结果页面有"查看搜索过程"入口。
10. 搜索过程中能看到部分结果。

## 6. 与既有文档关系

本文档聚焦于前端 Agent 交互体验优化，与以下文档互补：

- `docs/Agent优化技术方案.md` — 聚焦后端 Agent 架构优化（trace、版本、授权、session 续跑）。
- `docs/Agent 架构治理与演进技术方案.md` — 聚焦 Agent 架构治理。

本文档不涉及：
- Agent 后端架构变更。
- 新增 Agent 能力。
- 转盘、餐厅卡片或地图交互优化。
