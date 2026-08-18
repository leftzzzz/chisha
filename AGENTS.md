# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

ChiSha (今天吃啥) is a Next.js 16 restaurant recommendation app with AI-powered natural language understanding and an interactive turntable selection interface.

**Tech Stack**: Next.js 16 + React 18 + TypeScript + Tailwind CSS + OpenAI API + Amap (高德地图)

## Documentation Navigation

| Need | Read or search first |
| --- | --- |
| Current behavior, constraints, rules, or boundaries | [`docs/specs/AGENTS.md`](docs/specs/AGENTS.md) |
| Common task execution and engineering rules | [`docs/specs/general-engineering-task-rules.md`](docs/specs/general-engineering-task-rules.md) |
| Product intent, user needs, or acceptance criteria | [`docs/requirements/AGENTS.md`](docs/requirements/AGENTS.md) |
| Architecture, implementation approach, or technical rationale | [`docs/technical/AGENTS.md`](docs/technical/AGENTS.md) |

- Read or search [`docs/specs/AGENTS.md`](docs/specs/AGENTS.md) for current behavior, constraints,
  rules, and boundaries before changing code.
- Read [`docs/specs/general-engineering-task-rules.md`](docs/specs/general-engineering-task-rules.md)
  for every code, configuration, script, or review task.
- Read or search [`docs/requirements/AGENTS.md`](docs/requirements/AGENTS.md) for product intent,
  user needs, and acceptance criteria.
- Read or search [`docs/technical/AGENTS.md`](docs/technical/AGENTS.md) for architecture,
  implementation approach, rationale, and tradeoffs.
- For a new feature, reconcile the applicable requirement and technical documents with the current
  Specs before implementation.
- After accepting a requirement or technical decision, update affected Specs in the same change.
- Search requirement or technical documents for rationale; do not infer rationale from Specs.

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

主链路是 `/api/agent/chat` → `runSearchAgentV3`。

**当前实现事实**：常规 action 由 `orchestrator/policy.ts` 的确定性策略控制，模型只
执行目标理解、关键词扩展、候选验证和受限 replan；因此当前形态是 multi-model
workflow，而不是模型主控的 Agent loop。不要把目标架构写成已经实现。

修改 Agent 代码、评测或架构文档前，必须阅读
[`docs/specs/restaurant-search-agent.md`](docs/specs/restaurant-search-agent.md)。目标架构、
技术理由和迁移顺序见
[`docs/technical/agent-architecture-root-decision-2026-08.md`](docs/technical/agent-architecture-root-decision-2026-08.md)。

### Agent 评测 (`evals/`)

`npm run eval` 当前使用桩模型 + fixture 高德，适合度量 Runtime/workflow 的搜索步数、
调用量、重复评估和事件行为；它不证明真实模型的 Agent 决策质量。Agent 语义改动还需
覆盖真实模型或可审查 trace 中的工具选择、参数、目标关系、授权、证据和停止原因。

### External Services
- **OpenAI 兼容接口** (`lib/agent/modelClient.ts`) - 模型请求入口；当前主要是单次结构化调用
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
`__tests__/lib/agent/models/searchReplanModel.test.ts`。

改动 agent loop 行为时，单测之外还要跑 `npm run eval`——单测锁的是分支，
eval 锁的是"这一轮总共搜了几步、评了几次"。

## Responsive Breakpoints

- Mobile: <768px (single-column, touch-optimized)
- Tablet: 768-1024px
- Desktop: >1024px (multi-column)
