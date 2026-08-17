# Requirements

`docs/requirements/` 记录产品要解决的问题、用户需求、验收标准和已接受的产品决策。
实现新功能前先检索相关 requirement，再阅读 `docs/technical/` 的方案和 `docs/specs/` 的
当前强制边界。Requirement 不替代 Spec。

搜索方式：

```bash
rg -n "用户场景|能力|验收条件" docs/requirements docs/立项文档 \
  --glob '*.md'
```

## Current Requirements

- [Restaurant Search Agent](./restaurant-search-agent.md) - 自然语言搜索、范围授权、证据
  分区和 Agent 行为的当前产品要求。
- [最终推荐发布边界](./final-recommendation-publication.md) - 主推荐最终准入、候补分区、
  顺序保真和禁止下游自动补位的产品要求。

历史需求仍保留在 `docs/` 和 `docs/立项文档/`，用于追溯已有产品决策，不自动覆盖当前
Spec。
