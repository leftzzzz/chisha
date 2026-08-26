# Documentation and Repository Hygiene Spec

本 Spec 约束公开仓库中的 Markdown、文档索引、示例配置、归档材料、GitHub 模板和本地
控制面状态。文档结构理由见
[应用架构](../technical/application-architecture.md)。

## 权威与入口

- 根 `README.md` 是面向使用者和贡献者的公开入口；`docs/README.md` 是完整人类文档导航。
- 根 `AGENTS.md` 只提供跨 Agent 启动地图、文档路由、常用命令和最小仓库地图，不复制
  详细工程契约。
- `docs/specs/` 是当前实现约束的唯一规范源，`docs/requirements/` 记录产品意图，
  `docs/technical/` 记录架构理由与取舍；三个目录都必须有真实 `AGENTS.md` 导航并索引
  目录中的每一份当前文档。
- 同一规则只保留一个可独立修改的正文。README、目录索引、贡献指南和模板只能概述并
  链接权威来源。
- `.env.example` 是公开环境变量名称、用途和默认关系的单一真源；部署文档不得复制一套
  可独立漂移的完整变量表。
- `package.json`、`jest.config.js`、`wrangler.jsonc` 和 CI workflow 分别是命令、覆盖率、
  Cloudflare binding/migration 与自动化步骤的代码级真源。

## 当前文档与历史材料

- `docs/` 根目录只保留 `README.md`、`DEPLOYMENT.md`、`TESTING.md` 和 `USER-GUIDE.md`。
  当前 Requirements、Specs、Technical 文档分别进入对应目录。
- 已被接受决策替代的方案、复盘、阶段报告、早期接口或立项材料必须位于
  `docs/archive/`，不得留在当前文档搜索入口中。
- 除归档目录自身的 README 外，每份归档 Markdown 必须在文件开头声明
  `状态：历史归档`，并明确其不再是当前实现依据。
- 归档保留历史原文和必要链接修复，不把旧方案重新润色成当前决策；当前事实只能在现行
  Requirements、Specs、Technical 文档中修改。

## 公开边界

- 不得提交 API Key、Cookie、签名、真实用户位置/对话、真实 Provider 响应、私有 trace、
  个人机器绝对路径或控制面运行记录。
- `.loopx/` 和 `.codex/goals/` 是本地私有状态，必须被 Git 忽略。文档可以描述工具工作流，
  但不得发布这些目录的实际状态内容。
- `.env.example` 只使用明显占位值；测试 fixture 必须是手工构造数据，不得复制真实高德
  或模型响应。
- 安全问题只能通过 `SECURITY.md` 指定的私密渠道报告；issue 和 PR 模板必须提醒用户对
  key、坐标、对话和 trace 打码。

## 确定性检查

- `npm run docs:check` 必须检查本地 Markdown 文件链接、三个文档域的索引覆盖、`docs/`
  根目录允许集合、归档状态标记，以及本地私有状态的 ignore 规则。
- 链接检查忽略 fenced code block 中的示例链接和非 Markdown 文件；这两个例外必须有
  回归 fixture。普通 Markdown 正文中的本地目标仍必须存在，包括归档文件。
- 新增文档规则的实现必须覆盖违反用例、明确允许的例外和相邻无关文件，防止检查器把
  示例代码或其他文件类型误判为文档链接。
- `npm run test:docs` 运行检查器自身回归测试；GitHub CI 必须在应用测试前运行两条文档
  命令。不得以 warning 或 `continue-on-error` 代替失败门禁。
- Agent 文档结构还必须通过 `agents-spec` 的 `audit_agents_md.py --check`；仓库脚本不复制
  该外部结构守卫的实现。

## 变更要求

- 修改行为、产品决策或技术决策时，在同一变更中更新对应权威文档；不要只改 README。
- 移动文档时修复所有受影响的本地链接，并在交付前运行 `npm run docs:check`。
- 文档中的命令、路由、变量、覆盖率和平台能力必须能追溯到当前代码或配置；无法确认的
  外部配额和平台状态必须明确标为部署者待核验信息。
