# Model Provider Routing Spec

本 Spec 适用于当前 Restaurant Search Agent 的一次性结构化模型角色、模型配置、模型传输
参数和模型调用指标。产品验收标准见
[`../requirements/aliyun-model-cost-latency.md`](../requirements/aliyun-model-cost-latency.md)，
技术理由见
[`../technical/aliyun-model-routing-2026-08.md`](../technical/aliyun-model-routing-2026-08.md)。

## 配置权威

- `lib/agent/modelConfig.ts` 是 Base URL、API Key、角色模型默认值和环境变量优先级的唯一
  解析入口。模型角色文件不得各自复制默认模型或配置优先级。
- 模型解析优先级必须是 `OPENAI_MODEL_<ROLE>`、`OPENAI_MODEL`、角色默认值。空白字符串
  视为缺失。
- 当前默认值固定为：supervisor/planner 使用 `qwen3.7-flash`，keyword/evaluation 使用
  `qwen-flash`。
- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` 和现有四个角色变量名称保持兼容。
  默认 Base URL 使用百炼 OpenAI 兼容接口；生产应通过环境变量配置同地域业务空间专属域名。

## 结构化调用契约

- 当前模型角色继续使用强制工具调用和运行时 schema 校验；模型切换不得放宽 schema、证据、
  授权或 FinalGuard。
- Qwen 模型或百炼/DashScope endpoint 上的强制工具调用必须发送
  `enable_thinking=false`。部署变量不得开启与强制 `tool_choice` 不兼容的思考模式。
- 非百炼、非 Qwen 的 OpenAI-compatible endpoint 不得收到供应商专用的
  `enable_thinking` 参数。
- 请求失败保持现有类型化错误语义。不得自动跨模型重试，也不得用本地语义规则静默替代
  模型结论。

## 可观测性

- 每次模型调用必须记录实际 `modelRole`、请求 Model ID、供应商响应 Model ID（如果返回）、
  起始时间、耗时、输入/输出 Token、HTTP 尝试次数、协议模式、截断和成功状态。
- turn 汇总必须区分所有调用耗时之和 `modelMs` 与合并并发区间后的
  `modelWallMs`，并同时提供按角色和按实际 Model ID 的聚合。
- Supervisor 在 RuntimeState 建立前失败时不得写半成品状态；已经取得模型调度租约的调用
  指标必须写入带 session 上下文的错误日志。
- 指标和日志不得包含 API Key、完整 prompt 或完整用户 query。

## 发布边界

- 代码默认值变化不代表线上已经完成模型切流；生产 secret/vars 必须经过真实百炼 A/B 后
  独立更新。已有 `OPENAI_MODEL` 会覆盖全部代码角色默认值，发布清单必须显式处理。
- 真实模型质量不能由桩模型 eval 证明。发布前必须检查 endpoint 工具调用、结构化输出、
  延迟、成本估算和关键业务回归。
- 百炼账号级 RPM/TPM 必须以目标业务空间控制台实际值为准，不能从公开文档值或模型价格
  推导生产容量。
