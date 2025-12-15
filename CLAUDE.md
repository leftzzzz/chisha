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
- `app/api/` - API routes (agent/search, search, geocode)
- `components/` - React components organized by feature (input/, turntable/, restaurant/, map/, layout/)
- `hooks/` - Custom hooks (useAppState, useLocation, useRestaurantSearch, useTurntable)
- `lib/` - Services and utilities (llm.ts, amap.ts, osm.ts, storage.ts, api.ts)
- `types/` - TypeScript type definitions

### External Services
- **OpenAI** (`lib/llm.ts`) - NLU for parsing user queries
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
OPENAI_MODEL=           # Model override (default: gpt-4)
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
