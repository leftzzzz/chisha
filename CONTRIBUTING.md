# 参与 ChiSha 开发

感谢你参与 ChiSha。提交前请先确认问题属于当前产品边界，并让代码、测试和权威文档在同一
变更中保持一致。

## 报告问题

- 先搜索已有 issue，避免重复。
- Bug 请使用仓库的 Bug 模板，提供最小复现、期望/实际结果和环境。
- Agent 行为问题保留原始查询措辞，但删除或打码位置、Cookie、Key、完整对话和私有 trace。
- 功能建议先描述用户问题与验收结果，不要求提交者判断内部实现层。
- 安全漏洞不要创建公开 issue；按 [SECURITY.md](./SECURITY.md) 使用 GitHub 私密安全通告。

## 开发环境

```bash
git clone https://github.com/leftzzzz/chisha.git
cd chisha
npm install
cp .env.example .env.local
npm run dev
```

推荐 Node.js 20。真实凭证只写入 `.env.local` 或本机的 Cloudflare secret store，不得进入
提交、日志 fixture、截图或 issue。

## 分支与提交

仓库使用 `main` 作为唯一长期分支。请从最新 `main` 创建短生命周期分支：

```bash
git switch main
git pull --ff-only
git switch -c fix/short-description
```

不使用 `develop`、release branch 或 Git Flow。分支前缀可以使用 `feat/`、`fix/`、
`docs/`、`refactor/`、`test/`、`chore/`。

提交信息使用 Conventional Commits，优先沿用近期提交的中文 subject：

```text
feat: 增加候补餐厅筛选
fix: 保留追问选项稳定标识
docs: 整理公开部署说明
```

创建提交前查看近期风格：

```bash
git log -5 --pretty=format:"%s"
```

## 先读哪份文档

| Change | Read first |
| --- | --- |
| 当前工程行为或约束 | [docs/specs/AGENTS.md](./docs/specs/AGENTS.md) |
| 产品目标或验收标准 | [docs/requirements/AGENTS.md](./docs/requirements/AGENTS.md) |
| 架构、方案或理由 | [docs/technical/AGENTS.md](./docs/technical/AGENTS.md) |
| 本地开发、测试或部署 | [docs/README.md](./docs/README.md) |

`docs/archive/` 只用于追溯，不能作为当前实现依据。接受新的 requirement 或 technical
decision 时，必须在同一 PR 更新受影响的 Spec。

## 实现原则

- 先读目标实现、最近调用方、相关测试和适用 Spec。
- 保持最小但完整的改动，避免无关重构和推测性兼容。
- 在不可信输入边界校验与归一化，内部代码使用已确认契约。
- 同一业务定义、默认值、状态语义或字段映射只保留一个权威来源。
- 保留合法零值、缺失、未知、无结果和失败之间的差异。
- 复用仓库现有 TypeScript、React、Zod 和测试模式；不要引入 `any` 或隐藏类型错误。
- 注释解释非直观不变量、业务原因或失败后果，不逐行复述实现。

详细规则见 [通用工程任务规则](./docs/specs/general-engineering-task-rules.md)。

## Agent 相关改动

当前架构是确定性 policy 控制的 multi-model workflow。一次结构化模型调用是 model role，
不是 subagent；Lead Agent/model-tool loop 是已暂缓备选，不是当前 PR 验收项。

修改 `lib/agent/`、`app/api/agent/` 或 `evals/` 前阅读：

- [Restaurant Search Agent Spec](./docs/specs/restaurant-search-agent.md)
- [当前餐厅搜索 Workflow](./docs/technical/current-agent-workflow.md)
- [Public API and Streaming Spec](./docs/specs/public-api-and-streaming.md)

不要通过新增菜名、菜系、品牌或失败 query 词表修复语义问题。Agent 行为变化必须有通用
回归测试，并运行 `npm run eval`。

## 验证

所有 PR 至少运行与改动最近的检查：

```bash
npm run docs:check
npm run test:docs
npm run type-check
npm run lint
npm test
```

根据范围扩大验证：

| Change | Additional checks |
| --- | --- |
| 共享行为或大范围代码 | `npm run test:ci` |
| Agent policy/runtime/model role | 相关 Jest + `npm run eval` |
| Cloudflare binding、DO、migration | `npm run build:cloudflare` + `npm run deploy -- --dry-run` |
| 标准 Next.js 构建行为 | `npm run build` |
| AGENTS/Specs 路由 | agents-spec `audit_agents_md.py --check` |

覆盖率门槛以 `jest.config.js` 为唯一真源，不得通过降低阈值或排除业务代码绕过。

## Pull Request

PR 应包含：

- 要解决的问题和用户/系统影响；
- 实际行为变化与保持不变的外部契约；
- 新增或更新的测试；
- 已执行命令及结果；
- 未执行检查、环境限制和剩余风险；
- Agent eval baseline 变化的原因（适用时）；
- 数据、部署或迁移步骤（适用时）。

不要复制 issue/PR 模板到正文文档，直接填写仓库提供的模板。普通 CI 不应需要生产凭证，
PR 也不得执行远程 D1 migration 或真实部署。

## 文档

- 当前公开指南只保留在 `README.md`、`docs/README.md`、`USER-GUIDE.md`、`TESTING.md`、
  `DEPLOYMENT.md`、`SECURITY.md` 和本文件。
- 当前约束进入 Specs，产品意图进入 Requirements，架构理由进入 Technical。
- 被替代方案进入 `docs/archive/` 并加历史归档标记。
- 移动或新增 Markdown 后运行 `npm run docs:check`，不要提交断链。

## License

提交贡献即表示你同意该贡献按仓库的 [MIT License](./LICENSE) 发布。
