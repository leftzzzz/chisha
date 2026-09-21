# ChiSha 今天吃啥

ChiSha 是一个开源餐厅推荐应用。用户用自然语言描述想吃什么，系统结合当前位置搜索并
验证附近餐厅，再把合格推荐放进可编辑转盘，帮助完成最后的选择。

[![CI](https://github.com/leftzzzz/chisha/actions/workflows/ci.yml/badge.svg)](https://github.com/leftzzzz/chisha/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> 项目仍在快速迭代。公开部署会消耗部署者自己的模型和地图额度，请先阅读
> [安全说明](./SECURITY.md) 与 [部署指南](./docs/DEPLOYMENT.md)。

## 功能

- 自然语言表达菜品、菜系、预算、距离、营业状态和排除项。
- 浏览器定位或手动输入地址，基于附近真实 POI 搜索。
- 流式展示理解、搜索、验证、追问和推荐进度。
- 主推荐与证据不足的候补分区展示，候补只由用户显式加入转盘。
- 3 至 8 个餐厅或自定义文字选项组成转盘。
- 地图查看、结果海报和压缩分享链接。
- 浏览器本地历史、搜索、统计、导入导出和再次使用。
- Cloudflare D1 匿名多轮会话、Durable Object Provider 容量协调和入口限流。

## 快速开始

### 前置条件

- Node.js 22
- npm
- OpenAI-compatible API Key
- 高德 Web 服务 API Key
- 需要显示地图时：高德 Web 端 JS API Key 与安全密钥

### 安装

```bash
git clone https://github.com/leftzzzz/chisha.git
cd chisha
npm install
cp .env.example .env.local
```

编辑 `.env.local`，至少配置：

```env
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# 不设置 OPENAI_MODEL 时：目标理解/重规划使用 qwen3.7-flash，关键词/候选验证使用 qwen-flash
# OPENAI_MODEL=qwen3.7-flash
# 兼容旧 OpenAI-compatible 端点时可选
# OPENAI_TOOL_CALL_MODE=functions

AMAP_API_KEY=your-amap-web-service-key
NEXT_PUBLIC_AMAP_KEY=your-amap-js-api-key
AMAP_SECURITY_CODE=your-amap-security-code
```

环境变量的完整名称、默认关系和公网保护项以 [.env.example](./.env.example) 为准。不要
把真实 `.env.local`、`.dev.vars` 或 Key 提交到仓库。

### 启动

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。首次使用时允许浏览器定位，或者输入
地址完成地理编码。

## 使用流程

1. 选择当前位置或输入地址。
2. 输入自然语言需求，例如“附近 2 公里，人均 80 以内，不辣的川菜”。
3. 系统可能询问范围或偏好；点击选项按稳定 id 续跑，也可以自由输入补充。
4. 查看主推荐、未满足约束和候补，按需管理转盘选项。
5. 至少保留 3 个、最多 8 个选项后转动转盘。
6. 结果会保存到本地历史，可以再次转动、生成海报或复制分享链接。

完整操作说明见 [用户指南](./docs/USER-GUIDE.md)。

## 当前架构

当前生产实现是**确定性策略控制的 multi-model workflow**，不是模型主控的 Agent loop：

- `orchestrator/policy.ts` 根据目标、授权、证据和预算决定常规 action。
- Goal understanding、keyword expansion、candidate evaluation 和受限 replan 是局部模型角色。
- Runtime 执行 I/O、并发、会话、trace、取消和预算。
- FinalGuard 在所有完成路径上统一决定主推荐与候补，ResultAssembler 只做字段装配。
- Amap/OSM adapter 只返回地点事实，不替代用户意图或候选证据判断。

这套 workflow 是当前已接受架构，不是等待 Lead Agent 替换的临时版本。完整技术决策见
[当前餐厅搜索 Workflow](./docs/technical/current-agent-workflow.md)，强制边界见
[Restaurant Search Agent Spec](./docs/specs/restaurant-search-agent.md)。Lead Agent 方案仅以
[暂缓备选技术决策](./docs/technical/agent-architecture-root-decision-2026-08.md)保留，不是当前
实现清单。

```text
Browser
  -> /api/agent/chat (SSE)
  -> goal understanding
  -> deterministic policy + bounded model roles
  -> Amap / OSM
  -> evidence evaluation + FinalGuard
  -> primary recommendations + candidates
  -> editable turntable
```

## 数据与隐私

- 转盘历史保存在当前浏览器的 `localStorage`，最多 100 条。
- Agent 多轮会话在 Cloudflare 生产环境保存到 D1，包含位置、对话和 runtime state，并由
  签名匿名 owner Cookie 限制访问。
- 分享链接包含查询、餐厅和自定义选项，不包含位置、Cookie、Agent session 或 trace。
- `evals/fixtures/amap.json` 是手工构造数据；请勿提交真实高德响应或真实用户数据。

自建公开服务前必须决定数据告知、保留期限、供应商条款和 API 账单责任。

## 开发命令

```bash
# 静态检查
npm run type-check
npm run lint

# 文档
npm run docs:check
npm run test:docs

# 单测与覆盖率
npm test
npm run test:ci
npm run test:coverage

# Agent workflow 行为评测（桩模型 + fixture）
npm run eval

# 构建与 Cloudflare dry-run
npm run build
npm run build:cloudflare
npm run deploy -- --dry-run
```

当前覆盖率门槛以 [jest.config.js](./jest.config.js) 为唯一真源。deterministic eval 证明
workflow 调用量、搜索步数和事件行为没有意外漂移，但不证明真实模型的语义质量。

详细测试策略见 [测试指南](./docs/TESTING.md)。

## Cloudflare 部署

公开生产拓扑使用：

- OpenNext Cloudflare Worker
- D1 `CHISHA_DB` 保存 Agent session
- Durable Object `PROVIDER_SCHEDULER` 做跨实例容量与会话互斥
- Cloudflare Rate Limiting bindings 保护公开入口
- Worker secrets 保存模型、高德和会话签名凭证

首次部署需要在自己的 Cloudflare 账号创建 D1、替换 `wrangler.jsonc` 中的
`database_id`、配置 secrets，然后运行：

```bash
npm run build:cloudflare
npm run deploy -- --dry-run
npm run deploy
```

`npm run deploy` 会先应用远程 D1 migration；dry-run 不会修改远程数据库。Vercel 或普通
Node 部署缺少当前 D1、Durable Object 和 Rate Limiting 边界，不能直接视为等价的公开
生产部署。完整步骤见 [Cloudflare 部署指南](./docs/DEPLOYMENT.md)。

## 文档

- [文档总览](./docs/README.md)
- [用户指南](./docs/USER-GUIDE.md)
- [部署指南](./docs/DEPLOYMENT.md)
- [测试指南](./docs/TESTING.md)
- [Engineering Specs](./docs/specs/AGENTS.md)
- [Product Requirements](./docs/requirements/AGENTS.md)
- [Technical Decisions](./docs/technical/AGENTS.md)
- [历史归档](./docs/archive/README.md)

## 贡献与安全

提交 PR 前阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)，并运行与改动最接近的检查。Agent
workflow 变更必须附带 `npm run eval` 结果；Cloudflare binding 或 runtime 变更必须通过
OpenNext build 和 Wrangler dry-run。

不要用公开 issue 报告漏洞。安全问题请按 [SECURITY.md](./SECURITY.md) 使用 GitHub 私密
安全通告。

## License

[MIT](./LICENSE)
