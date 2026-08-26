# 测试与验证指南

ChiSha 使用 Jest、React Testing Library、deterministic Agent eval、文档检查和 Cloudflare
dry-run。测试应证明行为与契约，不依赖伪造的命令输出或过时的文件清单。

## 快速命令

```bash
# 文档结构与检查器回归
npm run docs:check
npm run test:docs

# 快速单测
npm test

# CI 单测、串行执行并采集 coverage
npm run test:ci

# watch / 单独 coverage
npm run test:watch
npm run test:coverage

# TypeScript 与 ESLint
npm run type-check
npm run lint

# Agent workflow 行为评测
npm run eval

# 构建与 Cloudflare 部署包验证
npm run build
npm run build:cloudflare
npm run deploy -- --dry-run
```

## 测试分层

### Jest 单元与集成测试

`__tests__/` 镜像主要源码边界：

- `__tests__/context/` - Reducer 状态、主推荐/候补分区和转盘操作。
- `__tests__/hooks/`、`__tests__/components/` - 客户端搜索和进度展示。
- `__tests__/app/api/` - chat/search/session、geocode、map config 和 Amap proxy。
- `__tests__/lib/agent/` - goal、model roles、policy、runtime、FinalGuard、D1 session 和 trace。
- `__tests__/lib/` - provider scheduler、rate limit、storage、HTTPS 与 provider adapters。

测试环境是 `jsdom`，公共 alias `@/*` 与应用一致。`npm test -- <pattern>` 可以运行最接近
改动的用例，例如：

```bash
npm test -- AppReducer.test.ts
npm test -- chat.test.ts
npm test -- finalGuard.test.ts
```

### Agent deterministic eval

```bash
npm run eval
```

eval 使用桩模型和 `evals/fixtures/amap.json` 驱动真实 Runtime，适合检查：

- 每轮搜索步数、批次和 Provider 调用量；
- 候选评估次数、重复评估和缓存；
- 事件、追问、停止原因和主推荐/候补分区；
- 会话恢复、退化路径和预算行为。

它不证明真实模型能正确理解所有自然语言，也不应产生真实供应商请求。修改 baseline 只能
在行为变化已审查且被接受后执行：

```bash
npm run eval:baseline
```

PR 中应说明 baseline 为什么变化，而不是只提交新快照。

### 文档检查

```bash
npm run docs:check
npm run test:docs
```

`docs:check` 检查本地 Markdown 链接、Requirements/Specs/Technical 索引覆盖、归档状态和
私有 LoopX/Codex 状态 ignore。`test:docs` 使用三个 fixture 验证：

- 普通 Markdown 中的断链会失败；
- fenced code block 中的示例链接是允许例外；
- 相邻非 Markdown 文件不进入检查。

Agent 路由结构还需运行外部 `agents-spec` guard；仓库不复制该工具实现。

### 构建与部署验证

- `npm run build` 检查标准 Next.js build。
- `npm run build:cloudflare` 生成 OpenNext Worker。
- `npm run deploy -- --dry-run` 验证 Worker bundle 和 bindings，不上传 Worker、不迁移远程
  D1。

Cloudflare runtime、binding、migration、HTTPS 或 Provider 调度变化必须运行后两项。

## 覆盖率门槛

唯一真源是 [`jest.config.js`](../jest.config.js)：

| Metric | Current global threshold |
| --- | ---: |
| Branches | 49% |
| Functions | 63% |
| Lines | 57% |
| Statements | 56% |

70% 是长期方向，不是当前门禁。正常变更不得下调阈值、排除可执行代码或用无行为价值的
断言制造覆盖率。提高阈值时先验证 CI 结果稳定，再修改 `jest.config.js` 和
[CI/CD Spec](./specs/ci-cd-quality-gates.md)。

## 模型分支测试

`jest.setup.js` 默认设置：

```ts
process.env.AGENT_DETERMINISTIC = '1';
```

需要覆盖真实模型调用分支的单测必须在用例内：

1. `delete process.env.AGENT_DETERMINISTIC`；
2. mock `@/lib/withTimeout` 的 `fetchWithTimeout`；
3. 返回符合模型 schema 的结构化数据；
4. 在用例结束后恢复环境和 mock。

参考 `__tests__/lib/agent/models/searchReplanModel.test.ts`。单元测试不得依赖公网模型端点。

## 新增用例

### 行为修复

- 先写能复现问题的失败用例，再修复实现。
- 断言外部行为、状态或契约，不锁定无关内部调用顺序。
- 同时覆盖成功、边界和确定失败；保留合法零值、缺失、未知与失败的差异。

### API

- 直接调用 route handler，mock Provider、D1/DO 和 request headers。
- 同时检查请求上限、状态码、`Retry-After`、owner 越权和 abort/cleanup。
- SSE 用例要检查事件分区、终止顺序和 heartbeat，不只检查 HTTP 200。

### Agent workflow

- Policy 测试锁定输入状态到 action 的决定。
- Runtime 测试锁定 I/O、并发、事件、持久化和错误回收。
- 模型角色测试锁定 schema、prompt 输入边界和类型化失败。
- FinalGuard 测试锁定单调删除/降级/保序，不允许自动补位。
- 行为改变除 Jest 外还必须有 `npm run eval` 证据。

### 文档规则

新的确定性规则必须有违反用例、允许例外或明确无例外，以及相邻无关用例。规则无法稳定
自动判断时留在 Spec 和 review，不要加入脚本。

## 手工 API smoke

`npm run test:api` 会请求 `NEXT_PUBLIC_APP_URL`（默认 `http://localhost:3000`），并打印请求
与响应。它需要已经启动的服务和可用凭证，可能消耗真实模型/地图额度，因此：

- 不在 CI 中运行；
- 不使用真实用户查询或位置；
- 不把输出直接提交到 issue、PR 或仓库；
- 失败不替代 route handler 单测的诊断。

## 按改动选择验证

| Change | Minimum validation |
| --- | --- |
| 文档或模板 | `docs:check`, `test:docs`; AGENTS/Specs 变更再跑 agents-spec guard |
| Reducer、storage、UI hook | 对应 Jest + type-check + lint |
| API schema、SSE、session | 对应 API/Jest + type-check + lint |
| Agent policy/runtime/model role | 对应 Jest + `npm run eval` + type-check + lint |
| Cloudflare binding/DO/migration | 相关 Jest + type-check + lint + OpenNext build + dry-run |
| 共享或跨模块契约 | `npm run test:ci`，并扩大到受影响的 eval/build |

## CI

GitHub Actions 使用 Node 20，先运行文档检查，再运行 type-check、lint、`test:ci` 和 eval；
质量 job 成功后才执行 Cloudflare build 与 dry-run。CI 不持有生产凭证，也不证明真实模型
或真实账号配额的线上质量。
