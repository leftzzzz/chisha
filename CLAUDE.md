# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ChiSha (今天吃啥) is a Next.js 16 restaurant recommendation app with AI-powered natural language understanding and an interactive turntable selection interface.

**Tech Stack**: Next.js 16 + React 18 + TypeScript + Tailwind CSS + OpenAI API + Amap (高德地图)

## Common Commands

```bash
# Development
npm run dev              # Start dev server at localhost:3000

# Build & Deploy
npm run build            # Build for production
npm run build:cloudflare # Build for Cloudflare Workers
npm run deploy           # Deploy to Cloudflare Workers

# Code Quality
npm run type-check       # TypeScript type checking
npm run lint             # ESLint checks

# Testing
npm test                 # Run all tests
npm run test:watch       # Tests in watch mode
npm run test:coverage    # Generate coverage report
npm run test:api         # Test API endpoints

# Agent 评测（loop 行为回归，非单测）
npm run eval             # 跑 evals/cases 下的 golden query，输出报告与基线 diff
npm run eval:baseline    # 同上并更新 evals/baseline.json
```

## Architecture

### State Management
Uses Context API + Reducer pattern. Application state flows through steps:
`INPUT → UNDERSTANDING → SEARCHING → READY → SPINNING → RESULT`

Core state files:
- `context/AppContext.tsx` - Provider with state and dispatch
- `context/AppReducer.ts` - State reducer logic

### Key Directories
- `app/api/` - API routes (agent/chat 为主链路，agent/search 为兼容入口)
- `components/` - React components organized by feature (input/, turntable/, restaurant/, map/, layout/)
- `hooks/` - Custom hooks (useAppState, useLocation, useRestaurantSearch, useTurntable)
- `lib/` - Services and utilities (agent/, amap.ts, osm.ts, storage.ts, api.ts)
- `types/` - TypeScript type definitions

### Agent Harness (`lib/agent/`)
主链路：`/api/agent/chat` → `runSearchAgentV3`。职责边界见
`docs/Agent-职责边界重构-技术方案-2026-08.md`。

**编排者是代码，不是模型。** 没有"主 Agent 模型"这种东西——`orchestrator/`
决定一切流程，四个子 Agent 各做一件独立任务。

#### 分层判据（新代码放哪儿，用这条判）

| 特征 | 归属 |
|---|---|
| 需要理解自然语言或语义 | `subagents/` |
| 需要枚举状态做选择 | `orchestrator/policy.ts` |
| 需要发请求、发事件、改状态 | `orchestrator/runtime.ts` |
| 同样输入永远同样输出且不含语义 | 规则库（`lib/agent/*.ts`） |

依赖方向只允许三条：编排层→子 Agent、编排层→规则库、子 Agent→规则库。
**这条约束由 `__tests__/lib/agent/layering.test.ts` 强制**，违反即测试红。

#### 编排层 `orchestrator/`
- `policy.ts` - **唯一决策者**，纯函数、无 I/O、无模型。`decideTurnEntry` /
  `decideContextReset` / `decideScouting` / `decideNextAction` /
  `decideAskOrConverge` / `planSearchBatch` / `partitionPlansByValidity`。
  阈值集中在 `POLICY_LIMITS`
- `runtime.ts` - **只执行**：按决策发起调用、发 SSE、提交状态与 trace。
  不要在这里写"下一步做什么"的 if

#### 子 Agent `subagents/`（模型只在这四处介入）
- `goalUnderstandingAgent.ts` - 口语 → UserGoal / GoalPatch / 追问
- `keywordExpansionAgent.ts` - 目标 → 联想词与探索方向
- `evaluationAgent.ts` - 餐厅事实 → **逐家**裁决（调用量最大）。它不选择、
  不排序——那是 finalGuard 的事
- `replanAgent.ts` - 确定性关键词试完仍无主推荐时重新构思方向，一轮最多一次

子 Agent 的输入必须能用一句话描述**而不提到 loop**。`authorizations`、
`attempts`、`allowBroaden`、`goalVersion` 这类编排状态一律不得传入——
由 `__tests__/lib/agent/subagents/subagentContracts.test.ts` 强制。

#### 规则库（确定性，两边复用）
- `goal.ts` - 目标代数：合并、打补丁、追问选项应用
- `searchAttempts.ts` - 搜索历史的只读查询
- `guards.ts` - `validateSearchPlan` 只校验不改写（计划由 policy 生成，
  违规即 bug）+ 确定性硬约束过滤
- `finalGuard.ts` - 主推荐准入与候选排序。严格准入要求 `passed`；凑不满
  `targetCount` 时用 `isCategoryCompatiblePrimaryAllowed` 把**品类兼容但菜单
  未验证**的 `unverified` 候选补位（POI 事实字段里没有菜单，菜品级目标除非
  店名写着否则永远验证不出来，严格线在这类目标上构造性不可达）。补位只放宽
  "菜品有没有验证到"，排除项/停业/距离/搜索授权一条都不放。
  **`policy.hasPrimaryCandidates` 必须与这里同口径**（`isPrimaryRecommendationEligible`），
  否则策略层判定无结果去追问、装配层其实能给出结果
- `evaluationCache.ts` - 一轮内的候选裁决缓存，避免重叠 POI 反复送评估。
  只复用 passed 且镜头不更宽的裁决
- `finishReason.ts` - 结束原因枚举与用户文案映射（不要用字符串匹配生成文案）
- `clarificationOptions.ts` - 追问选项的 id 协议（id 是契约，label 只是文案）
- `nearbyCategories.ts` - 把真实 POI 聚成追问选项
- `metrics.ts` / `turnLogger.ts` / `tracePersistence.ts` - 观测：模型指标
  （含 `serialModelSteps`）、带 sessionId/turnId 的日志、trace 持久化裁剪

错误码在**抛出点**用 `AgentError` 指定，不要在消费端对 message 做正则匹配。

**三条不可违反的约定**（见 `docs/模型不可用与追问契约-技术方案-2026-08.md`）：

1. **模型不可用就报错，不降级**。不要新增任何"用关键词表从用户原话里抽词"
   的兜底路径——那是拿硬编码语义冒充模型判断，也是历史上追问死循环的燃料。
   验证失败同理：不合成 unverified 候选。
   注意区分：同义词归一（火锅→涮锅）这类**无语义推断的确定性规则**可以留，
   删的是"无依据地替模型选方向"的隐式替身。
   也要区分"**合成**裁决"与"**怎么用**模型给出的裁决"：`finalGuard` 的品类
   兼容补位用的是模型自己判的 `unverified`，不凭空造裁决，因此不违反本条。
2. **用户意图只由 GoalUnderstandingAgent 判断**。「你推荐」「随便」这类说法
   一个字都不该进代码常量；prompt 里写规则，代码里不做关键词匹配。
3. **追问选项按 id 走协议**。`optionEffects` 的 key 只能是 option.id，前端回传
   id、不回传文案，也不许自己造选项。

### Agent 评测 (`evals/`)
`npm run eval` 用桩模型 + fixture 高德驱动真实 loop，度量的是**行为**：
串行搜索步数、评估调用数、重复评估数、追问率、主推荐数。改动 policy /
runtime / 缓存后必须跑，并在 PR 里附基线 diff。

### External Services
- **OpenAI 兼容接口** (`lib/agent/modelClient.ts`) - 所有 Agent 的模型调用入口
- **Amap** (`lib/amap.ts`) - Primary POI search for China
- **OpenStreetMap** (`lib/osm.ts`) - Global fallback

### Data Flow
1. User inputs natural language query
2. LLM parses intent and extracts search parameters
3. Multi-source restaurant search (Amap primary, OSM fallback)
4. Results displayed on interactive turntable
5. Selection saved to LocalStorage history

## Environment Variables

Required in `.env.local`:
```
OPENAI_API_KEY=         # OpenAI API key
AMAP_API_KEY=           # 高德地图 API key
```

Optional:
```
OPENAI_BASE_URL=        # Custom OpenAI endpoint
OPENAI_MODEL=           # Model override (default: deepseek-v4-flash-0731)
OPENAI_MODEL_SUPERVISOR= # 目标理解模型（默认继承 OPENAI_MODEL）
OPENAI_MODEL_PLANNER=   # replan 模型（默认继承 OPENAI_MODEL）
OPENAI_MODEL_EVALUATION= # 候选验证模型，调用量最大，可配便宜模型
OPENAI_MODEL_KEYWORD=   # 关键词联想模型（默认继承 OPENAI_MODEL）
AGENT_PARALLEL_SEARCH=  # false 关闭一轮内并行搜索（默认开启）
AGENT_SEARCH_CONCURRENCY= # 一批最多铺开几个搜索计划（默认 3）
AGENT_CONCURRENT_FIRST_SEARCH= # false 关闭"首搜与联想词并发"（默认开启）
AGENT_HEARTBEAT_MS=     # SSE 心跳间隔（默认 10000）
AGENT_DETERMINISTIC=    # 1 时强制走确定性分支，测试默认开启
AMAP_SECURITY_CODE=     # Amap digital signature
```

## Code Conventions

- **Imports**: Use `@/*` path alias for absolute imports
- **TypeScript**: Strict mode enabled, avoid `any` types
- **Components**: PascalCase naming, JSDoc for public APIs
- **Commits**: Conventional Commits format (feat:, fix:, docs:)

## Testing

Jest + React Testing Library. Test files in `__tests__/` mirror source structure.
Coverage threshold: 70% across all metrics.

模型决策路径默认被 `AGENT_DETERMINISTIC=1`（`jest.setup.js`）关掉。要覆盖模型
分支的用例，在用例内 `delete process.env.AGENT_DETERMINISTIC` 并 mock
`@/lib/withTimeout` 的 `fetchWithTimeout`，参考
`__tests__/lib/agent/subagents/replanAgent.test.ts`。

改动 agent loop 行为时，单测之外还要跑 `npm run eval`——单测锁的是分支，
eval 锁的是"这一轮总共搜了几步、评了几次"。

## Responsive Breakpoints

- Mobile: <768px (single-column, touch-optimized)
- Tablet: 768-1024px
- Desktop: >1024px (multi-column)
