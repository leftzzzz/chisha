## 改了什么

<!-- 一两句话说清楚这个 PR 解决的问题，而不是罗列改了哪些文件 -->

## 类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 破坏性变更
- [ ] 文档 / 重构 / 测试

## 验证方式

<!-- 跑了哪些命令、加了哪些用例、手工验了什么 -->

- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run eval`（**改动 `lib/agent/` 下的 policy / runtime / 缓存时必填**，
      并在下面贴出与基线的 diff）

<details>
<summary>eval 基线 diff</summary>

```
（粘贴 npm run eval 的报告与基线差异；行为没有变化就写"无差异"）
```

</details>

## Checklist

- [ ] 新代码放的层符合 CLAUDE.md 的分层判据（语义→`subagents/`，
      状态选择→`policy.ts`，I/O→`runtime.ts`，确定性规则→规则库）
- [ ] 没有新增"从用户原话里用关键词表抽词"的模型兜底路径
- [ ] 追问选项按 id 走协议，没有在代码里硬编码用户说法
- [ ] 文档（README / CLAUDE.md / AGENTS.md / docs/）与代码同步
