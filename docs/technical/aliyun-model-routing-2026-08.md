# 百炼模型角色分流与迁移技术方案（2026-08）

## 状态

接受并实施。产品目标与验收标准见
[`../requirements/aliyun-model-cost-latency.md`](../requirements/aliyun-model-cost-latency.md)，
当前工程契约见
[`../specs/model-provider-routing.md`](../specs/model-provider-routing.md)。

## 迁移前现状

当前主链路仍是确定性 workflow。四个模型角色分别负责：

| 角色 | 工作 | 调用特征 |
| --- | --- | --- |
| `GoalUnderstandingModel` | 自然语言目标、补丁、追问 | 每轮入口，语义风险最高 |
| `KeywordExpansionModel` | 搜索词扩展 | 与首搜并发，输出短 |
| `EvaluationModel` | 逐家候选裁决 | 调用量和 Token 量最大 |
| `SearchReplanModel` | 搜索耗尽后的有限重规划 | 低频，语义风险较高 |

迁移前，四个文件分别读取 Base URL、API Key 和模型变量，默认都落到
`deepseek-v4-flash-0731`。这既复制配置规则，也让高频、低复杂度角色承担了不必要的模型
成本。现有 `callStructuredModel` 使用 OpenAI-compatible Chat Completions、强制
`tool_choice`、schema 校验和类型化错误，迁移无需替换传输协议。

## 外部能力核验

截至 2026-08-19，百炼[模型价格页](https://help.aliyun.com/zh/model-studio/model-pricing)
列出的华北 2（北京）原价为：

| 模型 | 适用首档 | 输入 / 输出（元/百万 Token） | 用途判断 |
| --- | --- | --- | --- |
| `deepseek-v4-flash-0731` | 峰谷定价 | 忙时 3 / 9，闲时 1.5 / 4.5 | 当前基线 |
| `qwen3.7-flash` | 输入不超过 32K | 0.2 / 0.8 | 高语义角色首选 |
| `qwen-flash` | 输入不超过 128K | 0.15 / 1.5 | 高频角色首选 |
| `qwen3.5-flash` | 输入不超过 128K | 0.2 / 2 | 配置回滚候选 |
| `qwen-plus` | 非思考、输入不超过 128K | 0.8 / 2 | 质量优先候选 |

价格页展示原价，活动价只能从控制台确认，不能进入代码决策。百炼
[限流文档](https://help.aliyun.com/zh/model-studio/rate-limit)说明稳定别名通常拥有更高的
RPM/TPM，并且同一主账号下的业务空间和 API Key 共享相应模型限额；因此默认使用稳定别名，
不固定日期快照。

百炼的 [OpenAI 兼容 Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions)
支持工具调用和强制 `tool_choice`，但思考模式不支持强制调用指定工具。业务空间专属域名是
生产首选；通用 `https://dashscope.aliyuncs.com/compatible-mode/v1` 只作为开箱可用默认值。

官方资料没有提供 DeepSeek V4 Flash 与各个 Qwen Flash 在本项目 prompt 上的统一 P50/P95，
所以“更快”是需要真实 A/B 验证的假设，不是本文宣称的既成事实。

## 架构决策

### 单一配置责任点

新增 `lib/agent/modelConfig.ts`，它是当前结构化模型配置的唯一解析入口，负责：

- Base URL 和 API Key；
- 每个模型角色对应的覆盖变量；
- 全局覆盖与角色默认值的优先级；
- 空白值归一化和 Base URL 尾部 `/` 规整。

优先级固定为：

```text
OPENAI_MODEL_<ROLE> > OPENAI_MODEL > role default
```

保持 `OPENAI_*` 名称是部署兼容选择，不表示系统依赖 OpenAI 供应商。

### 角色默认值

```text
supervisor -> qwen3.7-flash
planner    -> qwen3.7-flash
keyword    -> qwen-flash
evaluation -> qwen-flash
```

目标理解和重规划处理开放世界语义、授权和上下文关系，使用能力较新的
`qwen3.7-flash`。关键词扩展输出很短，候选验证已有受限事实输入、严格 schema 和下游 guard，
使用更便宜且限流更宽裕的 `qwen-flash`。这不是降低证据门槛：模型结果仍必须经过现有 schema、
`applyVerdictGuard` 和 FinalGuard。

### 非思考强制工具调用

当前四个角色都强制指定函数。对 Qwen 模型或百炼/DashScope endpoint，传输层无条件加入：

```json
{ "enable_thinking": false }
```

不再允许 `QWEN_ENABLE_THINKING=true` 覆盖这一行为。若未来需要思考模式，必须另建不强制
`tool_choice` 的明确调用契约，不能复用当前结构化调用器。

### 不做请求内模型回退

首期不在 429、5xx、超时或 schema 错误后自动切换另一模型：

- 它会把一次失败扩成第二次完整请求，直接伤害 P95；
- 首次请求可能已经计费，重复调用会让成本不可预测；
- 不同模型在同一轮给出的目标或裁决可能不一致；
- 当前错误契约要求模型不可用时显式失败，不能静默掩盖。

回滚通过 `OPENAI_MODEL` 或单角色变量完成。需要线上自动回退时，应单独设计错误分类、总
deadline、幂等、账单上限和 trace 契约。

### 指标口径

保留逐调用 `modelCallMetrics`，turn 汇总增加：

- `modelWallMs`：合并重叠模型调用区间后，各区间时长之和；表示模型实际占用的用户墙钟
  时间，不把并发调用重复累计；
- `responseModel`：在供应商返回 `model` 时记录解析后的模型标识；`model` 保留请求时的稳定
  别名。稳定别名升级后，两者可以帮助定位 A/B 使用的实际版本，但供应商不返回具体快照时
  仍不能凭空推断；
- `byModel`：按 `responseModel ?? model` 汇总 calls、ms、tokens 和 failures；
- 现有 `modelMs` 继续表示所有调用耗时之和，用于容量和成本分析，不能误作用户等待时间。

这些字段进入现有 `model_call` trace 和 turn 完成日志，不记录 API Key、完整用户 query 或
prompt 内容。若 Supervisor 在 RuntimeState 建立前失败，系统仍不写半成品状态，但会把同一
汇总指标写入带 session 上下文的错误日志。

## 发布步骤

1. 先合入配置解析、默认值、请求契约、指标和单测，不在 PR 中修改线上 secret。
2. 在同一百炼地域用固定请求集运行迁移前后 A/B，记录 requirement 规定的指标和测试时刻；
   稳定别名可能升级，必须同时保留请求模型与供应商响应模型。
3. 生产 Base URL 改为对应 WorkspaceId 的北京业务空间专属域名。
4. 清点生产中的 `OPENAI_MODEL` 和四个角色变量。已有全局变量会覆盖代码默认值，不能仅合并
   代码就宣称已经切流。
5. 清理角色变量后先把 `OPENAI_MODEL=qwen3.7-flash` 灰度到全角色，隔离“模型版本差异”和
   “角色分流差异”。
6. 基线通过后，设置 `OPENAI_MODEL_KEYWORD=qwen-flash` 和
   `OPENAI_MODEL_EVALUATION=qwen-flash`，再次检查结构化输出和推荐回归。
7. 根据百炼控制台实际限额配置 `MODEL_RPM_LIMIT`、`MODEL_TPM_LIMIT`；不得照抄公开上限。

## 回滚

- 结构化输出或语义质量回归：单角色切到 `qwen3.5-flash`、`qwen3.7-flash` 或
  `qwen-plus`。
- 全局问题：设置 `OPENAI_MODEL` 回到已验证模型，角色变量必须同步清理或覆盖，否则单角色
  变量仍具有更高优先级。
- 百炼 endpoint 故障：保持类型化错误和用户可重试状态，不在本期切换其他供应商。

## 验证矩阵

- 配置单测：默认组合、全局覆盖、角色覆盖、空白值、尾斜杠。
- 传输单测：百炼/Qwen 强制非思考，非百炼模型不附加供应商参数。
- 指标单测：并发区间合并、空闲间隔、请求/响应模型、按角色和按模型聚合、失败计数。
- 回归：模型角色契约测试、Runtime metrics 测试、全量 Jest、type-check、lint、eval。
- 真实 endpoint：强制工具调用、schema 修复率、P50/P95、429/5xx 和控制台账单抽样。

## 后续但不属于本期

- 利用百炼上下文缓存复用稳定 system prompt；需要先量化缓存命中和隐私边界。
- 按角色缩小 `maxTokens`；需要真实输出分布证明不会增加截断重试。
- 自动模型回退或多供应商路由；需要独立 deadline、成本和一致性设计。
