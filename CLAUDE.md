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
`docs/Agent-Harness-优化技术方案-2026-08.md`。

- `runtimeV3.ts` - 唯一 loop controller：预算、事件、状态提交
- `policy.ts` - **确定性策略唯一实现**（计划构造、半径、poiType、追问、授权、
  关键词队列）。Runtime 与 Planner 都从这里取，不要在任一侧再写一份
- `supervisor.ts` / `supervisorPlanner.ts` - 目标理解与 action 决策（模型）
- `subagents/evaluationAgent.ts` - 候选语义验证（模型）
- `subagents/keywordExpansionAgent.ts` - 搜索词联想（模型）
- `guards.ts` / `finalGuard.ts` - 确定性硬约束过滤与主推荐准入
- `finishReason.ts` - 结束原因枚举与用户文案映射（不要用字符串匹配生成文案）
- `degraded.ts` - Supervisor 不可用时的降级目标
- `metrics.ts` / `turnLogger.ts` / `tracePersistence.ts` - 观测：模型指标、
  带 sessionId/turnId 的日志、trace 持久化裁剪

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
OPENAI_MODEL_PLANNER=   # action 决策模型（默认继承 OPENAI_MODEL）
OPENAI_MODEL_EVALUATION= # 候选验证模型，调用量最大，可配便宜模型
OPENAI_MODEL_KEYWORD=   # 关键词联想模型（默认继承 OPENAI_MODEL）
AGENT_PARALLEL_SEARCH=  # true 开启一轮内并行搜索（默认 false）
AGENT_SEARCH_CONCURRENCY= # 并行搜索上限（默认 3）
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

## Responsive Breakpoints

- Mobile: <768px (single-column, touch-optimized)
- Tablet: 768-1024px
- Desktop: >1024px (multi-column)
