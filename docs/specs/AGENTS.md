# Specs

`docs/specs/` 是当前可执行行为、约束和工程边界的唯一规则源。修改代码前先阅读适用
Spec；不要从 requirement 或 technical 文档推断当前规则。接受新的产品或技术决策时，
必须在同一变更中同步对应 Spec。

搜索方式：

```bash
rg -n "关键词|组件名|文件路径" docs/specs
```

## Spec Index

- [Restaurant Search Agent](./restaurant-search-agent.md) - Restaurant Search Agent 的
  命名、语义所有权、工具、Provider、证据、Runtime、委派和 eval 强制边界。
