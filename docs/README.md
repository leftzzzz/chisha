# ChiSha Documentation

这里是 ChiSha 的公开文档入口。先根据任务选择当前文档；只有需要追溯历史决策时才进入
archive。

## 使用与维护

- [用户指南](./USER-GUIDE.md) - 定位、自然语言搜索、追问、候补、转盘、分享与本地历史。
- [本地开发与测试](./TESTING.md) - 测试分层、命令、覆盖率真源和新增用例要求。
- [Cloudflare 部署](./DEPLOYMENT.md) - D1、Durable Object、secrets、构建、dry-run 和发布验证。
- [安全说明](../SECURITY.md) - 私密漏洞报告、自建部署风险、会话数据与凭证边界。
- [贡献指南](../CONTRIBUTING.md) - main-based PR 流程、文档路由和验证矩阵。

## 权威文档

| Domain | Entrypoint | Responsibility |
| --- | --- | --- |
| Engineering Specs | [specs/AGENTS.md](./specs/AGENTS.md) | 当前必须满足的行为、契约、策略和不变量 |
| Product Requirements | [requirements/AGENTS.md](./requirements/AGENTS.md) | 用户需求、产品目标、验收标准和产品决策 |
| Technical Decisions | [technical/AGENTS.md](./technical/AGENTS.md) | 架构、实现方法、技术理由和权衡 |

遇到冲突时，当前工程行为以 Spec 为准；产品或技术决策改变后，必须在同一变更中更新
受影响的 Spec。README 和操作指南不是第二套规范正文。

## 常用路径

- Agent 当前架构：[当前餐厅搜索 Workflow](./technical/current-agent-workflow.md)
- Agent 强制边界：[Restaurant Search Agent Spec](./specs/restaurant-search-agent.md)
- 应用与转盘：[Application Behavior Spec](./specs/application-behavior.md)
- API 与 SSE：[Public API and Streaming Spec](./specs/public-api-and-streaming.md)
- 公网保护：[Public Runtime Protection Spec](./specs/public-runtime-protection.md)
- CI/CD：[CI/CD Quality Gates](./specs/ci-cd-quality-gates.md)
- 文档治理：[Documentation and Repository Hygiene](./specs/documentation-and-repository-hygiene.md)

## 历史材料

[docs/archive/](./archive/README.md) 保存早期立项、阶段报告、被替代的 Agent 方案和实施复盘。
这些文件必须带有“历史归档”标记，不能覆盖当前 Requirements、Specs 或 Technical
decisions。

## 文档检查

```bash
npm run docs:check
npm run test:docs
```

前者检查本地链接、索引覆盖、归档位置/状态和私有控制面 ignore；后者验证检查器的违反
用例、code-fence 例外和相邻非 Markdown 文件。
