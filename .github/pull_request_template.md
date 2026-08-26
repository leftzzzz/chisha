## 问题与结果

<!-- 说明要解决的问题、用户/系统影响，以及改动后的可观察结果。 -->

## 行为与边界

<!-- 列出改变的外部行为，以及明确保持不变的 API、数据或部署契约。 -->

## 验证

<!-- 只勾选实际运行并通过的命令；未运行的检查请说明原因。 -->

- [ ] `npm run docs:check`
- [ ] `npm run test:docs`
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm test` 或相关 Jest 用例
- [ ] `npm run test:ci`
- [ ] `npm run eval`（Agent policy/runtime/model role 行为变化时必需）
- [ ] `npm run build:cloudflare`
- [ ] `npm run deploy -- --dry-run`

## Checklist

- [ ] 修复包含能复现问题的回归测试，或说明不适合自动测试的原因。
- [ ] 没有提交 API Key、Cookie、真实坐标、完整对话、真实 Provider 数据或私有 trace。
- [ ] 当前行为、产品决策或技术决策变化已同步到对应 Specs/Requirements/Technical 文档。
- [ ] 没有把 model role 误称为 subagent，也没有把暂缓的 Lead Agent 方案写成当前目标。
- [ ] 没有新增按菜名、菜系、品牌、地域叫法或失败 query 分支的语义兜底。
- [ ] 追问选项按稳定 id 传输，展示 label 不承担协议语义。
- [ ] Cloudflare 变更没有让 PR 检查执行远程 D1 migration 或真实部署。

## 剩余风险

<!-- 包括未执行检查、环境限制、迁移/回滚要求、eval baseline 差异。没有则写“无”。 -->
