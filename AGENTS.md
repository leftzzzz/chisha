# AGENTS.md

ChiSha（今天吃啥）是一个 Next.js 16 餐厅推荐应用：用户用自然语言表达需求，当前
multi-model workflow 搜索并验证附近餐厅，前端再通过转盘完成选择。

技术栈：Next.js 16、React 18、TypeScript、Tailwind CSS、OpenAI-compatible API、
高德地图、Cloudflare Workers/D1/Durable Objects。

## Documentation Navigation

| Need | Read or search first |
| --- | --- |
| Read or search current engineering behavior, standards, contracts, constraints, or boundaries | [`docs/specs/AGENTS.md`](docs/specs/AGENTS.md) |
| Common task execution and engineering rules | [`docs/specs/general-engineering-task-rules.md`](docs/specs/general-engineering-task-rules.md) |
| Read or search product intent, user needs, or acceptance criteria | [`docs/requirements/AGENTS.md`](docs/requirements/AGENTS.md) |
| Read or search architecture, implementation approach, or technical rationale | [`docs/technical/AGENTS.md`](docs/technical/AGENTS.md) |
| Public setup, deployment, testing, and usage guides | [`docs/README.md`](docs/README.md) |

- For existing engineering behavior, inspect the applicable Specs before changing code.
- Read the general engineering task rules for every code, configuration, script, or review task.
- For a new feature, inspect relevant requirement and technical documents, then reconcile the
  applicable Specs before implementation.
- After accepting a requirement or technical decision, update affected Specs in the same change.
- Search requirement or technical documents for rationale; do not infer rationale from Specs.
- Documents under `docs/archive/` are historical evidence and never override a current Spec.

## Common Commands

```bash
npm run dev
npm run type-check
npm run lint
npm test
npm run test:ci
npm run eval
npm run docs:check
npm run build
npm run build:cloudflare
npm run deploy -- --dry-run
```

Run the checks closest to the change. Agent workflow changes also require `npm run eval`;
Cloudflare runtime or binding changes require the OpenNext build and Wrangler dry-run. The exact
quality-gate contract is indexed from `docs/specs/AGENTS.md`.

## Repository Map

- `app/` - pages and API routes; `/api/agent/chat` is the primary search stream.
- `components/`, `context/`, `hooks/` - client UI and application state.
- `lib/agent/` - current search workflow, model roles, policy, runtime, evidence, and sessions.
- `lib/` - provider adapters, storage, rate limiting, and shared utilities.
- `__tests__/` - Jest and React Testing Library coverage.
- `evals/` - deterministic workflow behavior evaluations.
- `migrations/`, `worker.ts`, `wrangler.jsonc` - Cloudflare production runtime.

Use `@/*` imports, keep TypeScript strict, preserve existing public contracts, and do not commit
credentials, real user data, real provider responses, or local control-plane state.
