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
`docs/Agent-Loop-形态重构技术方案-2026-08.md`。

**模型只在三处介入**：理解目标、联想搜索词、验证候选。常规轮次的"下一步做
什么"完全由 `policy.ts` 决定——不要把动作决策重新交回模型。

- `runtimeV3.ts` - 唯一 loop controller：预算、事件、状态提交，执行 policy 的决策
- `policy.ts` - **唯一 planner**：`decideNextAction` / `planSearchBatch` 以及
  计划构造、半径、poiType、追问、授权、关键词队列。阈值集中在 `POLICY_LIMITS`
- `supervisor.ts` - 目标理解与 GoalPatch（模型）
- `supervisorPlanner.ts` - 只剩两件事：转发目标理解、`runSearchReplan`
  （确定性关键词全部试完仍无主推荐时重新构思方向，一轮最多一次）
- `subagents/evaluationAgent.ts` - 候选语义验证（模型，调用量最大）
- `subagents/keywordExpansionAgent.ts` - 搜索词联想（模型）
- `evaluationCache.ts` - 一轮内的候选裁决缓存，避免重叠 POI 反复送评估。
  只复用 passed 且镜头不更宽的裁决
- `guards.ts` - `validateSearchPlan` 只校验不改写（计划由 policy 生成，
  违规即 bug）+ 确定性硬约束过滤
- `finalGuard.ts` - 主推荐准入
- `finishReason.ts` - 结束原因枚举与用户文案映射（不要用字符串匹配生成文案）
- `degraded.ts` - Supervisor 不可用时的降级目标
- `metrics.ts` / `turnLogger.ts` / `tracePersistence.ts` - 观测：模型指标
  （含 `serialModelSteps`）、带 sessionId/turnId 的日志、trace 持久化裁剪

错误码在**抛出点**用 `AgentError` 指定，不要在消费端对 message 做正则匹配。

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
OPENAI_MODEL=           # Model override (default: gpt-4o)
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
`__tests__/lib/agent/supervisorPlanner.test.ts`。

改动 agent loop 行为时，单测之外还要跑 `npm run eval`——单测锁的是分支，
eval 锁的是"这一轮总共搜了几步、评了几次"。

## Responsive Breakpoints

- Mobile: <768px (single-column, touch-optimized)
- Tablet: 768-1024px
- Desktop: >1024px (multi-column)
