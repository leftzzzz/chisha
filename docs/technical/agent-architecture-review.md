# Agent 架构审查与改进技术方案

> 日期：2026-09-17。本文记录对当前 Restaurant Search Agent 的架构审查结论、改进方案和
> 实施顺序。强制边界仍以
> [`../specs/restaurant-search-agent.md`](../specs/restaurant-search-agent.md) 为准。
> 状态：正确性修复部分实施，完整项目尚未验收；下方原始审查基线为 `c78c67b`，
> 不是生产现状证明。新增切片与复查结论见文末实施记录。
> 需求与验收编号见 [Agent 架构改进需求](../requirements/agent-architecture-improvement.md)。

现行架构依据是 [当前餐厅搜索 Workflow 决策](./current-agent-workflow.md)。本文不替代该决策，
也不改变 [最终发布方案](./runtime-final-guard.md)。新增行为被接受时，需在同一变更同步
相关 Spec；只恢复既有不变量的修复不另造一份规则正文。

## 结论

保留 `runSearchAgentV3` 确定性 multi-model workflow，不迁移到 Lead Agent、统一 Agent tool、
model-tool loop 或 subagent lifecycle。当前业务瓶颈不是缺少更自主的 Agent，而是目标保真、
证据语义、Provider 契约、最终准入和评测还不能一致地回答同一个问题：

> 系统找到的是“相关餐厅”，还是“已经验证满足用户目标的餐厅”？

当前架构的方向是合理的：搜索阶段有限、发布边界清楚、供应商和预算可控。但实现与 Spec 存在
多处差距。应先修复正确性契约，再建立真实模型业务评测，最后用数据决定排序、召回和扩展能力。

## 审查范围

本次审查覆盖完整业务链：

```text
用户输入
  -> Goal understanding
  -> Policy / Planning
  -> Amap / OSM 召回
  -> Evaluation
  -> FinalGuard
  -> ResultAssembler
  -> API / UI / 转盘
  -> 偏好反馈
```

同时检查成本、延迟、失败恢复、观测、安全、授权和评测。审查方式包括：

- 阅读当前 requirement、spec、technical 文档；
- 阅读 Agent workflow、模型角色、Provider adapter、API、session、eval 和前端状态；
- 本地运行 71 个 Jest suites（600 tests）、15 个 offline eval cases 和 TypeScript type-check；
- 对归一化、schema 和搜索计划做本地函数探针；排序和发布逻辑通过代码及现有测试审查；
- 阅读 Anthropic Agent、Agent eval、multi-agent 系统与 OWASP prompt injection 公开实践。

审查没有执行真实模型联调、真实地图生产联测、生产日志审计、负载测试或用户转化分析。

## 发现与业务风险

下面的代码机制已通过阅读或探针确认，但由此造成的用户损失规模尚未测量。目标丢失与约束
清空有直接探针证据；排序效果、漏召回、偏好偏移和线上恢复影响属于待实测风险。

### 1. 语义真源冲突，搜索目标被有损改写

`lib/agent/poiTaxonomy.ts` 的 `normalizeKeywordText` 使用固定词表抽取已知餐饮词，其余修饰词
会被丢弃。实际验证结果：

- `羊肉火锅 -> 火锅`
- `无糖柠檬茶 -> 柠檬茶`
- `不辣的川菜 -> 川菜`
- `酸汤牛肉米线 -> 米线`

`lib/agent/orchestrator/policy.ts` 的 `buildSearchPlan` 再把 keyword 转成搜索 action，并可能
携带 Provider 分类码。这与当前 Spec 中“保留自然语言 query、Provider 分类不参与 planning”
的要求冲突。

业务影响：搜索会提前变宽。系统可能返回很多相关餐厅，但没有真正命中复杂需求；`exact`
授权和用户可理解的搜索关系也会失真。这不表示每个具体样例都会失败，但契约已经不能保证
目标保真。

### 2. 硬约束数组存在 fail-open 解析

`lib/agent/schemas/goal.ts` 中 `defaultArray` 对整个数组使用 `.catch([])`。本地探针输入
“一条合法 strict 500m 距离约束 + 一条未知 kind 约束”时，解析成功但 `hardConstraints` 变成
空数组。

业务影响：一条模型输出的坏约束可以删除所有硬约束，后续确定性约束检查没有机会保护用户
要求。这不是普通提示词风险，而是 schema 边界丢失状态差异：格式错误被静默解释成“无约束”。

### 3. 证据能力弱于产品承诺

`lib/agent/models/evaluationModel.ts` 明确说明输入没有菜单，证据主要来自店名、品类、地址、
距离等字段。名称含“柠檬茶”可以支持主营方向，但不能证明无糖、当天供应或完整菜单。

`lib/agent/evaluator.ts` 把模型自由文本和 matchedItems 转成 verification；
`lib/agent/finalGuard.ts` 对必选目标主要检查 `itemMatches.length > 0`，没有逐项核对 all-of
覆盖，也没有独立绑定来源。名称或分类匹配可以是有用证据，但不能承载任意菜品承诺。

业务影响：系统缺少统一的证据分级。要么主推荐过强，要么大量相关店被迫留在候补。增加模型
调用无法补上原本不存在的事实，必须先定义产品承诺和证据来源。

### 4. 评测保护的是现有实现，而不是完整业务契约

`evals/suite.eval.ts` mock 了 understanding、expansion 和 evaluation；
`evals/runner.ts` 的 `runSuite` 即使使用 `live` 标签，也仍然构造 fixture provider。当前 eval
适合保护 workflow 步数、调用次数、缓存和分区回归，但不能证明真实模型理解需求。

现有测试中还存在保护 taxonomy 归一化、Provider 分类推导等行为的用例，因此 600 个测试通过
不等于已符合当前 Spec。真实模型语义质量缺少独立 benchmark、重复运行、人工或独立模型评分。

### 5. 排序混淆合格性与推荐效用

`lib/agent/evaluator.ts` 的 `calculateScore` 主要使用置信度、matchedItems、matchedCategories、
距离和搜索 intent。模型提示又说明 confidence 只表示满足目标的把握，不是餐厅好坏。

业务影响：系统回答的是“更容易判断匹配的店”，不完全是“用户更愿意选择的店”。评分、价格、
用户偏好、多样性和可解释性没有形成稳定的推荐效用模型。

### 6. 候选召回在验证前提前收缩

`lib/amap.ts` 的 `dedupeAmapPois` 会按去掉括号后的品牌名保留第一个 POI；Runtime 又用
`selectRestaurantsForEvaluation` 只评估前 `targetCount + buffer`（默认通常 12）个候选，没有
预算内的渐进补评。

业务影响：品牌折叠发生在约束检查前，固定截断则发生在确定性硬过滤之后、模型评估之前。
两者可能丢失不同的合格门店，不能据此证明“没有合适餐厅”。OSM 路径还忽略 keywords，不能
当作等价关键词搜索。

### 7. 失败诊断和追问语义不够准确

`lib/agent/orchestrator/policy.ts` 在存在 strict distance 且没有主推荐时优先追问扩大距离，
即使真实障碍是证据不足、预算耗尽或品类冲突。候选数量不足也会驱动继续扩展。

业务影响：用户可能等待更久、反复让步，但没有解决实际瓶颈。追问应区分没搜到、硬约束冲突、
证据不足、未授权和系统失败。

### 8. 多轮修改和反馈存在语义偏差

`lib/agent/goal.ts` 的 `normalizePendingAnswerPatch` 会把追问回答中的新增目标改写成替换目标。
该设计避免了旧目标稀释搜索，但也可能把“还想要……”误解释为“只要……”。

`lib/storage.ts` 把随机转盘选中的菜系赋予较高偏好权重。随机结果既受系统推荐影响，也受
随机过程影响，不应等同于用户主动偏好。

业务影响：多轮目标和长期偏好可能偏离用户真实意图。需要区分追加、替换、放宽、曝光、随机
选中、主动接受和显式反馈。

### 9. 增强能力进入关键失败路径

Runtime 把 KeywordExpansionModel 与首批搜索 `Promise.all`。扩词失败会使整轮失败，即使首批
搜索已经有可用结果。分批评估遇到限流后，可能把所有批次串行重跑，已成功批次没有被隔离。

业务影响：增强能力的失败被放大为整体失败，延迟和成本也更容易被重试放大。必需能力和增强
能力应有不同失败边界。

### 10. 持久化与观测还没有覆盖全部失败形态

最终事件发送与会话保存之间存在窗口；取消路径可能不保存当前 runtime state；AgentRunError
之外的取消或失败也可能缺少完整快照。`recordTurnMetrics` 只在 `final` 和 `paused` 记录，
失败轮和部分失败调用缺少统一汇总。

业务影响：断线后可能重复搜索、重复付费，慢请求和失败原因更难定位。当前会话能力是恢复
上下文，不是逐步持久执行或 exactly-once 运行。

## 外部实践

以下官方资料在前一轮审查中读取，部分正文通过公开网页读取代理获取；不是本次文档交付
重新执行的检索。它们提供设计依据，不证明本项目已经达到这些能力。

- [Anthropic: Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)
  优先使用最简单工作流；只有可测量收益能覆盖延迟、成本和失败面时才增加自主性。
- [Anthropic: Demystifying Evals](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents)
  区分任务、运行、grader、trace 和业务结果，不能用叙事替代评测。
- [Anthropic: Multi-agent Research System](https://www.anthropic.com/engineering/multi-agent-research-system)
  多 Agent 适合可并行、广度探索型任务，但会带来上下文、协调和成本复杂度。
- [OWASP: Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/)
  隔离不可信内容、最小权限、结构化输出校验和分层防护；提示词和 RAG 不是完整防御。

这些实践支持本次路线：先修契约和评测，不引入更自主的架构。

## 改进方案

### 阶段 0：契约收敛

1. 以当前 Spec 为准，盘点实现与测试中互相矛盾的规则。
2. 确定 Product Promise：
   - 哪些需求只要“相关”即可；
   - 哪些需求必须“有证据支持”才能进主推荐；
   - unknown 如何展示和准入。
3. 定义目标、action、证据、授权和 trace 的统一术语。
4. 在改代码前保存真实模型评测基线；若外部配置或授权不足，记录缺口，先保留确定性样本，
   不以缺少生产数据阻塞已知正确性修复。

退出条件：完成契约差异表、责任归属和基线记录；后续阶段负责让实现满足契约。本阶段不声称
代码已修复，也不默许改变主推荐的既有证据门槛。

### 阶段 1：正确性修复

1. 移除硬约束整组 `.catch([])`；单条约束失败进入结构化修复、追问或显式失败。
2. 搜索 planning 保留自然语言目标；Provider 分类码只作为返回事实解释，不反向进入 planning。
3. action relation 与目标语义对齐；改写后的 query 必须可追踪并受授权约束。
4. 补充硬约束保留、query 保真、relation 和授权的回归测试。
5. 追问自由文本使用明确的追加、替换、删除和放宽操作；稳定选项 id 继续走既有确定性通道。
   不因处于追问阶段就把所有追加操作改成替换。

退出条件：P1 schema/query 契约测试通过；现有 taxonomy 或 Provider 分类测试不再保护违反
Spec 的行为。

### 阶段 2：证据与发布边界

1. Evidence 增加来源、获取时间和字段边界；名称、分类、菜单或商家资料不能合并成单一置信度。
2. 逐条件证据采用 Spec 的 `supported / contradicted / unknown`；候选状态仍是汇总结果。
   若外部契约需要旧状态，在一个映射点由规范化裁决派生，不能让两套字段独立写入。
3. all-of 必选目标在 FinalGuard 逐项核对；unknown 不提升，失败候选不进入主推荐。
4. UI 明确展示支持、未知、冲突和候补原因。

退出条件：证据删除、来源缺失和未授权放宽都会被降级；trace 可解释每个 FinalGuard verdict。

### 阶段 3：业务评测与观测

1. 建立真实模型 benchmark，覆盖 typical、edge、adversarial、生产分布和 metamorphic cases。
2. 每个用例报告目标保真、硬约束违背、证据覆盖、主/候补分区、追问质量、延迟和成本。
3. 指标覆盖成功、追问、取消和失败；区分模型失败、Provider 失败、schema 失败、预算耗尽和
   FinalGuard 拒绝。
4. 保存可审查 trace，避免在公开仓库中提交真实用户位置、对话、Provider 响应或凭证。

退出条件：fixture eval 与真实模型评测各司其职，报告不再互相替代。

### 阶段 4：体验与运行质量

1. 合格候选排序增加明确效用、多样性和可解释因素。
2. 先保留门店事实，再做约束过滤、渐进评估、品牌多样性和展示数量控制。
3. 追问基于真实失败原因。扩词仅在明确目标且不再依赖它时可作为增强能力；评估始终必需，
   只保留成功批次并针对失败批次处理，不省略验证。
4. 按生产故障率决定是否增强取消快照、部分保存或持久执行。
5. 只用显式反馈或可靠选择信号更新长期偏好。

该阶段的优先级应使用阶段 3 的数据决定。

## 责任点与数据契约

下表是拟实施设计，不是声明新增接口已经存在。优先扩展现有责任点，仅在出现独立不变量
时提取模块；不按表格行数创建新的 Agent 或服务。

| 需求 | 现有责任点 | 拟实施边界 | 直接验证 |
| --- | --- | --- | --- |
| R01、R02、R06 | `schemas/goal.ts`、`goal.ts`、理解模型、`orchestrator/policy.ts` | 目标更新完整校验后原子应用；失败保留上一有效版本；检索改写不覆盖目标 | 合法与非法约束混合、多轮追加/替换、位置与目标变化 |
| R01、R05 | `searchAction.ts`、`lib/amap.ts`、`lib/osm.ts`、聊天路由 | Action query 无损传递；高德固定餐饮范围；OSM 明示能力限制 | Provider 参数、门店身份、无关键词检索能力路径 |
| R03 | `types.ts`、`schemas/verdict.ts`、评估模型、`constraintEvaluator.ts`、`finalGuard.ts` | 逐条件证据与确定性约束合并准入，保留 Guard 单调性 | all-of/any-of、未知字段、证据删除、过期和未授权 |
| R04、R09 | `evals/`、`modelClient.ts`、`metrics.ts`、Runtime | 明确运行模式；调用开始/终止成对记录；未知 usage 不填零 | 模型桩与实调隔离、取消/失败及缺 usage |
| R05、R08 | Runtime、`evaluationCache.ts`、`evaluator.ts` | 候选渐进评估；成功批次复用；仅合格集合参与排序 | 批次部分失败、剩余候选、缓存失效 |
| R07、R09 | `lib/storage.ts`、session store、聊天路由及相关 UI | 偏好来源分离，恢复和最终发布状态显式区分 | 随机结果不变强偏好、落库失败、重连不重复发布 |

### 目标与证据

目标保留原文、版本及来源消息；每个待判断条件具有稳定的条件标识和所属逻辑组。
all-of 要求全部条件支持；any-of 至少一个选项支持。逻辑组之外的硬约束始终共同生效。
已有目标结构能表达时直接复用，不复制另一套目标模型。

证据记录至少包含门店身份、action id、Provider、查询、已去除凭证的请求参数、获取时间、
事实字段或资料引用。来源明确声明的更新时间与本系统获取时间分开；取回时间不代表资料
刚刚更新。模型返回条件 id、裁决和输入证据 id，不能自行创造来源。时间戳和引用可核对
不等于事实一定真实；语义支持仍需模型与独立评测判断，不能用关键词规则替代。

缺失字段记 unknown，不填业务默认值；零价格、零距离等合法值与缺失分开。无法支持菜品
供应时保留候补，不为增加主推荐数量编造菜单。新增外部资料源需另行评审数据授权、成本、
时效和失败策略，本项目首期不承诺接入未选择的数据供应商。

FinalGuard 校验证据引用存在、门店和目标版本对应、必需条件覆盖及既有准入不变量；它不
成为第二个语义模型，不自行推导新证据，也不提升模型 verdict。缓存应绑定目标版本、
门店事实版本或摘要、裁决策略版本；目标或证据变化后不得复用旧资格。

### 候选、预算与局部失败

Adapter 仅对同一物理门店精确去重；上游选择器在合格集合内处理效用与多样性。
每批评估后依据已验证数量、剩余未评估候选及剩余预算决定补评或停止。达到预算时记录
“未评估”及停止原因，不能把未检查候选计为失败，也不能追求无上限召回。

评分、价格等缺失时不伪造值，不把不同供应商评分直接视为同一量纲。排序权重与停止阈值
先经离线对拍，再由业务基线决定；FinalGuard 与 ResultAssembler 不参与重排。

已有调用数量和供应商容量限制继续生效。整轮 deadline 统一约束搜索、等待与重试；新一轮
请求仅在剩余时间和预算允许时发起。token 用量未知时记录 unknown，不能假称可精确执行
货币成本硬上限。新增配置需在实施时同步 `.env.example`，本文不写一套独立默认值。

扩词部分失败只允许在明确目标、已有通过同一 FinalGuard 的结果时按批准策略返回，并记录
失败角色与停止原因；没有可用结果时继续显式失败。开放探索依赖扩词时仍是必需步骤。
评估限流只对可重试的失败批次进行有界重试，保留成功批次；重试不提升资格。

### 发布、恢复与兼容

优先在聊天路由统一最终发布责任：Runtime 生成 guarded result 和快照，路由完成必要落库后
再发出一次终态事件；过程 status 仍可流式发送。实施前需核对 SSE 消费者，保持现有事件字段
与次序契约，避免 Runtime 和路由双重发布。保存失败显式报错，不能报告可恢复完成。

取消时尽力记录最新已完成阶段与终止原因；请求结束后不承诺 Worker 一定继续写入。
使用稳定 turn/action 标识辨认恢复进度，但外部请求已发出而结果未保存时仍可能重复计费，
不宣称 exactly-once。更重的后台持久执行只有实测证明必要后才另行设计。

旧 session 缺少新版证据时不得补造来源或自动继承主推荐资格；在恢复边界失效相关裁决并
重新验证，保留用户原始目标。新增字段和存储版本的迁移需与读写两端及回归测试同批交付，
具体是否需要 D1 migration 取决于最终 schema，不在本次文档中假称已确定。

旧历史的随机选中记录保留展示用途，不反向补造“用户确认”事件。API/UI 必须区分随机
选中、用户确认和候补主动加入；后者改变用户转盘选择，不改变后端证据裁决。

### 安全与隐私

保留现有 owner 隔离、租约、输入校验和取消机制。不可信 Provider 内容只作为事实输入，
不得修改目标、授权或工具权限；结构化输出还需校验 id、引用、范围和完整性。FinalGuard
不是提示注入识别器，本次没有证明任何提示注入绕过。安全验证采用合成边界数据和防御性
契约测试，不把关键词黑名单作为主要防线。

日志默认不记录原始坐标、对话和凭证；受控诊断数据的访问、脱敏、保留期限和删除办法
应在观测上线前确认。不向公开 fixtures 或仓库提交生产响应。业务反馈采集需单独确定
告知与选择机制，不能为测接受率而默认上传本地历史。

## 评测与交付门禁

业务指标定义只维护在配套需求文档；本方案负责采集与验证方式。
至少分离三种真实含义明确的运行模式：模型桩与地图 fixture、真实模型与固定地图 fixture、
真实模型与真实 Provider。最后一种另行授权运行并设置预算，任何模式缺配置都显式失败。
改变模式名称或标签不能被算作实调成功。

真实模型对拍固定任务集、模型参数和数据快照，记录模型、提示词与评分器版本，并重复试验
报告波动。硬约束和引用完整性用确定性 grader，语义支持使用独立标注和抽样人工复核；
不能让被测模型的自报置信度成为唯一评分。发布闸门以需求中的回归不变量为先，线上质量
另行报告分母、未知比例与样本限制。

| 行为切片 | 最低验证 | 交付条件 |
| --- | --- | --- |
| 目标与检索契约 | Schema、goal、policy、Provider 及调用方测试；`npm run eval`；类型检查 | query/relation/约束在端到端边界保持，旧错误测试已替换 |
| 证据与发布 | Evaluation、Guard、装配器、reducer 与会话兼容测试；完整单测和 eval | 每条主推荐可追溯，候补不自动补位，旧状态不提升 |
| 评测与观测 | 模式隔离、失败/取消计量、日志脱敏回归；获准的实模基线 | fixture 与实调报告分离，无未知成本冒充零值 |
| 运行与体验 | 对应 Runtime、storage、UI 测试；跨模块时扩大到完整检查 | 部分成功、重连和偏好语义与批准的 Spec 一致 |

各行为切片在直接验证通过后独立提交；不能把多个完成阶段长期积压。涉及 Cloudflare
运行时、binding 或持久化时，另按现有质量门禁运行 OpenNext build 和部署 dry-run。
每次交付同步受影响的当前 Spec，不以本文未批准建议直接替换已生效规则。

先用固定样本对拍，再经批准逐步发布并观察资格变化、错误和成本。主推荐减少本身不作为
放松证据标准的理由；协议不兼容、合格候选被错误删除或失败率异常时回滚相应实现，保留
已修复的正确性不变量。未指定生产流量比例和回滚数值阈值，需基于阶段 0/3 数据批准。

## 验证策略

短期回归：

- 约束 schema 的非法单条约束、合法多条约束、非数组输入；
- 自然语言 query、relation、授权和 trace 保真；
- 必选目标逐项覆盖、unknown 降级和证据删除；
- FinalGuard 拒绝、候补分区和 UI 不自动补位；
- 扩词失败、评估失败和 Provider 失败的部分可用性；
- 指标在成功、追问、取消和失败路径的完整性。

业务验收指标：

- 硬约束违背率；
- 必选目标覆盖率；
- unknown 误报为主推荐的比例；
- 未经授权放宽率；
- FinalGuard 拒绝率与原因分布；
- 用户接受率、追问放弃率；
- 首个可用结果时间；
- 每次成功决策成本。

## 风险与边界

- 高德或 OSM POI 数据不能证明任意餐厅的实时完整菜单；需要外部资料时必须逐步接入并记录
  来源。
- 更换模型或 Provider 后，fixture 全绿不能说明语义质量保持，必须重跑真实模型 eval。
- 收紧 FinalGuard 后主推荐数量可能下降，这是边界生效的预期信号，不应通过自动补位回滚。
- 保留确定性 workflow 不是最终架构承诺。若出现已有 technical decision 列出的重新评估条件，
  仍需形成新的 requirement、technical decision、Spec 和对拍报告。

## 实施与本地验收记录

### 1. 仓库调查范围

2026-09-17 对 `8a30372`、`fa12ae3`、`74171af` 及直接调用方做防御性对抗审查，
并以 `a3d2cc9` 修复审查发现的多轮约束遗漏。本记录不是第二次全仓审计，也未重新执行
互联网最佳实践检索。测试只使用本地合成输入和 fixture，不触达第三方攻击面。

### 2. 项目目标和当前方案

目标是用户表达不被静默改写、约束不丢失、缺证据的餐厅不被说成已满足。
保留当前 multi-model workflow，在 schema、Policy 和 FinalGuard 原有责任点修复。
显式目标组按完整名称对照既有匹配，不新增菜品词表或语义推断。

### 3. 尚未确认的关键信息

未做真实模型/地图联调、生产日志或用户转化分析；没有证据证明推荐质量、延迟或成本改善。
2026-09-17 早期切片中，LoopX bootstrap 曾返回没有可选身份的选择 gate；后续已修复状态投影，
当前目标由 registry 中的 `architecture-implementer` lane 继续执行。该变化只证明本地调度
恢复，不是产品功能、真实服务或生产环境验收证据。

### 4. 当前方案的关键假设

目标组 item 使用目标的完整名称，模型匹配字段仍是现有契约的输入。
分类与具体菜品分开：明确列入 requestedItems 的目标不能仅凭同名 categoryMatches 满足。
覆盖检查不证明模型证据真实；旧证据结构尚不足以独立核对来源。

### 5. 方案层问题

完整需求横跨 query、证据、恢复和评测，单改一个函数不能完成它。已修复单个计划 query
不等于高德请求保真；已核对目标组不等于来源绑定或完整逐条件裁决已交付。
因此 R01、R03 维持部分实施，不能以当前本地测试通过为上线承诺。

### 6. 替代方案及取舍

继续收敛现有边界可以复用授权、版本、测试和会话机制。重写成自主多 Agent 不能补上缺失
的餐厅事实，还会新增调度与恢复成本，本轮不采纳。外部菜单来源需单独评审授权与时效。

### 7. 路线结论

**调整当前方案**：保留确定性 workflow，继续修复目标与证据契约，不进行 Agent 形态重写。

### 8. 实现层问题

| 问题与证据 | 等级/置信度 | 触发与影响 | 处置 |
| --- | --- | --- | --- |
| 已确认缺陷：`schemas/goal.ts` 的 GoalPatchSchema.addConstraints 原先使用 optionalArray.catch | 高/高 | 一条非法追加约束使合法 500m 约束也消失，用户新增限制未生效；根因是解析将错误变成未提供 | 失败测试先复现，`a3d2cc9` 改为共用硬约束校验；保留缺省、null、单对象、空数组兼容 |
| 已确认缺陷：`lib/amap.ts` 的 amapPoiSearch 原先 normalizeSearchKeywords 并推导分类码 | 高/高 | 五个合成查询的修饰词在 Provider 请求前丢失；根因是 Adapter 越权做语义改写 | 五个请求参数测试先失败后通过；改为只做空白规整和精确去重、固定 050000；旧分类参数保留调用兼容但不再生效 |
| 已确认缺陷：Policy 的 buildPlanBatch 原先用归一化结果去重 | 中/高 | 两组合成修饰词只保留第一个；根因是规划层语义真源分散 | 两组失败测试先复现后通过；改为原始关键词空白规整后保序精确去重，policy 38 项通过 |
| 已确认缺陷：buildSearchPlan 原先附加 target、taxonomy 或 goal 的 POI 分类码 | 高/高 | 分类码反向参与 planning，缩小召回范围；根因是 Provider 事实被当作搜索意图 | 3 个反向规划测试先失败后通过；计划不再设置 poiType，旧兼容入口固定返回 undefined，policy 文件 36 项通过 |
| 已确认契约缺口：旧 buildCandidate 把自由文本 matchedItems 转为匹配；Guard 无证据引用核验 | 高/高 | 模型自报匹配仍缺少可核验来源，覆盖完整也不能证明供应；根因是证据数据契约缺失 | 显式组已增加字段快照引用核验；独立 observation、时间、非分组目标和完整逐条件证据仍缺失，见后续切片记录 |
| 已确认契约缺口：`evals/runner.ts` 的 runSuite 接收 live 标签但固定 createFixtureSearchPlaces | 中/高 | 调用者可能把固定地图评测误读为实调；根因是模式标签与执行路径未绑定 | live 标签先显式拒绝 fixture 执行；真实模型/地图模式待独立实现 |

显式组的缺项、重复匹配充数、无关匹配、空组、证据删除、搜索授权豁免和分类冒充菜品
均有合成回归测试。分类冒充用例同时放入无关菜品匹配，避免测试仅被旧的空数组检查拦住。
FinalGuard 不补位、不重排、不修改原候选 verdict。未发现本次切片内其他已证实的回归，
不据此声称无漏洞或完整 R03 已实现。

### 9. 最优先处理的三件事

1. 闭合 R01 的规划到 Provider 请求契约，移除语义改写和反向分类码规划。
2. 闭合 R03 的逐条件证据引用、获取时间、目标版本及旧会话兼容。
3. 分离 R04 的桩、真实模型、真实 Provider 运行模式；缺配置明确拒绝。

### 10. 可以暂时接受的剩余风险

本地开发可暂不接入真实菜单和生产观测，不能因此放宽主推荐承诺。排序权重、偏好反馈和
部分成功策略继续按原文的评审与数据门槛推进。R01/R03 正确性缺口不是可接受的整体完成条件。

本地验证记录：

- `74171af`：完整 `npm run test:ci` 为 71 suites / 615 tests 通过，覆盖率门禁通过。
- `a3d2cc9`：schema、goal、Runtime 聚焦测试 3 suites / 44 tests 通过；混合非法追加输入
  测试先失败（未抛错），修复后通过；缺省与单对象兼容同时验证。
- 高德请求边界：5 个修饰词/整句测试先失败后通过，完整 Adapter 测试 12 项通过；
  断言请求 query、固定 types 和 500 米 radius，不依赖真实供应商响应。
- 规划层边界：3 个分类码反向规划测试先失败后通过；2 组修饰词误去重测试先失败后通过；
  policy 文件最终 38 项通过，offline eval 15 项通过。
- 完整收敛检查：首次完整 `npm test` 发现 2 个旧分类码契约测试；替换为查询保真和
  不缩窄召回断言后，71 suites / 624 tests 通过。
- 两个切片的 `npm run eval` 均为 15 个 offline cases 通过，与既有基线无变化。
- type-check、lint、docs:check、test:docs 通过；最后一次 schema 修复后另跑 docs:check。
- 未执行浏览器人工验收、真实模型/地图、Next build、Cloudflare build/dry-run 或部署。
  本轮未修改 Worker、binding、migration、UI 或依赖。测试工具提示浏览器兼容数据过期，
  不影响命令退出状态；未混入依赖升级。
- 曾将单测名称过滤器错误传给 eval，导致全部跳过；该运行不计为通过证据，后续已完整重跑 eval。

### 11. 是否值得继续下一轮审查

值得，但应在下一切片实现后对照具体契约继续，不重复全仓扫描或无改动全量测试。
完整需求未完成，本记录仅验收上述局部行为，不是上线批准或项目结项。

### 后续切片：R04 评测模式保护

范围只绑定 `runSuite` 的模式标签与执行路径；不实现真实模型/地图，不改 workflow 或 UI。
新增回归先证明 `live` 标签会错误执行 fixture 地图，修复后该标签显式抛出
`CONFIG_MISSING`。offline 模式和 15 个基线用例不变。

本地验收：模式回归通过；完整 `npm test -- --runInBand --silent` 为 72 suites /
640 tests 通过；`npm run type-check`、`npm run lint`、`npm run docs:check` 和
`npm run eval` 通过，eval 基线无变化。未调用真实模型或地图；真实模型/地图模式
仍未实现。LoopX 身份修复不是架构项目完成；后续切片已恢复自动调度，但不能替代功能验收。

### 后续切片：显式目标组的字段引用

范围：模型输出 schema、EvaluationModel、evaluator、Runtime 候选回传和 FinalGuard；
不改搜索、排序、外部数据源或 UI。路线继续为**调整当前方案**。

- 新增 `targetEvidence`，模型引用当前餐厅的 id、name/cuisineType 字段和完整值。
  evaluator 只保留引用，不用子串推导匹配。Guard 复用引用 schema，核对完整目标、
  item/category 声明及当前字段值；不改变原 verdict、不补位、不重排。
- 旧模型输出与旧会话没有引用仍可读取，但不能支持显式目标组。格式错误的模型引用
  移除引用资格，保留候选原裁决；不能因引用畸形连不确定候补也丢掉。
- 对抗性回归先复现了无引用的 name/llm_semantic 标签仍通过准入。修复后覆盖缺失、
  空引用、错店、字段变化、非法字段/值、目标不符、匹配声明缺失和品类冒充菜品。
  增加 schema → evaluator → JSON 会话恢复 → Guard 的贯通回归；JSON 往返不代表
  已验证数据库落库或浏览器端到端流程。
- 实现审查确认：字段引用一致仅是来源检查的一部分。模型仍可给出语义上不相关的真实
  引用；当前 prompt 对名称证据的旧规则与严格菜品供应规范仍有差距。缺少独立 observation
  id、获取时间、完整目标/事实/裁决策略缓存版本，以及非分组目标的引用检查。
  这些是高置信度契约缺口，不宣称本次消除了模型误判或完成 R03。

- 字段快照的权威来源仍是候选携带的 restaurant；本轮不把它包装成独立可信资料库。
  在完成上述来源记录和语义验收前，不能据本次结果批准上线。

本地验收：两条无引用准入测试先失败后通过；最终 `npm run test:ci -- --silent`
为 71 suites / 639 tests 通过，覆盖率门禁通过。`npm run eval` 为 15 个 offline cases
通过、基线无变化；type-check、lint、docs:check、test:docs 和 diff 空白检查通过。
离线 eval 尚未覆盖新的引用输入，新增契约由上述专门回归覆盖，不把基线无变化当作
真实模型已适配的证明。未执行 Next/Cloudflare build、浏览器验收、数据库落库验收、
真实模型/地图或部署；未重复互联网检索。LoopX 身份选择 gate 未解除。

### 失败切片：非分组目标引用的一次性启用

- 尝试直接把非分组必选目标加入 `targetEvidence` 校验。新增“缺引用、空引用、错店、
  字段变化、未声明匹配、目标不符”回归先失败后通过，但全量验证暴露 4 个测试套件
  /13 条测试失败，离线 eval 变为 8 通过 / 7 失败。
- 根因是桩与契约不齐：离线评估桩把计划关键词和用户目标合并成 `matchedItems`，
  但不输出 `targetEvidence`；收紧后仅命中扩词的候选被误判为无目标证据。测试与
  eval 中也还没有为菜系目标提供可接受的独立证据形状。
- 已回滚本切片代码，恢复到提交 `60f7985` 的绿色基线：72 suites / 645 tests 通过。
  不把这次失败交付为 R03 进展；保留结论作为下一切片的前置条件：先对齐评估输出
  与目标语义的证据形状，再启用非分组引用检查。

### 后续切片：非分组必选目标逐项覆盖

- 对抗性回归先复现“用户要求柠檬茶、模型只声明奶茶”仍进入主推荐；旧逻辑只检查
  匹配数组非空。
- FinalGuard 现在逐项核对非分组必选目标，重复项或无关匹配不能替代；已归入显式组的
  目标仍按组语义判断，可选项不强制匹配，既有授权放宽例外不变。同步更新 Spec。
- 本地验收：新增回归先失败后通过；`npm test -- --runInBand --silent` 通过
  72 suites / 645 tests；`npm run type-check`、`npm run lint` 通过；`npm run eval`
  15 cases 通过。5 个 eval 用例主推荐数量低于历史基线。桩把计划关键词与用户目标
  混合输出为 matchedItems；旧逻辑可接受仅匹配扩词的候选，新逻辑要求覆盖必选目标。
  未修改桩或历史基线以追平数量；具体候选语义仍需真实模型独立验收。
- 仍缺非分组目标字段引用检查、独立 observation 来源与时间及完整逐条件裁决；
  名称匹配不证明菜品供应。本切片不是 R03 整体验收，也不是上线批准。

### 后续切片：非分组必选目标字段引用

- 无引用的非分组必选目标回归先失败，证实仅有 itemMatches 会进入主推荐。
- FinalGuard 复用显式组的字段快照核验集合，要求非分组必选项也有对应 item 引用；
  已授权宽泛搜索例外、显式组语义及可选项行为不变，不生成新的语义结论。
- 同步评估提示词、离线桩与 Runtime 测试桩的引用契约。离线桩只为实际目标命中生成
  引用，不给纯检索扩词伪造目标引用；其字符串判断不代表真实模型质量。
- 对抗性回归覆盖缺引用、空引用、错店、字段变化、品类冒充菜品；保留候补和原裁决，
  正向引用仍可通过，过滤后的主推荐顺序不变。
- 直接验证：5 suites / 87 tests 通过，offline eval 15/15；全量 72 suites / 651 tests
  通过，随后新增无引用降级保序场景后 FinalGuard 55/55 通过。type-check、lint、
  docs:check 和 diff 空白检查通过。
- 剩余：字段引用不证明模型语义正确，独立 observation 来源/时间、完整逐条件证据仍未
  实现。未调用真实模型或地图服务，未进行浏览器或生产验收，不能关闭 R03 或整个项目。

### 后续切片：Observation 获取时间

- `f19bf6c` 新增 `fetchedAt` 后，针对本切片的对抗性检查发现它记录的是评估后的
  提交时间。新增模拟评估耗时 500 毫秒的回归先失败，证明时间戳被延后。
- 时间戳现于搜索 Promise 返回后采集，通过 `SearchPlanResult` 传到 observation，
  评估与批次提交不再重置它。JSON 往返验证保留该时间，不代表数据库持久化验收。
- 全量测试 73 suites / 654 tests 通过；offline eval 15/15，type-check、lint、
  docs:check 通过。旧 eval 基线的五项主推荐数量差异仍存在，未修改历史基线。
- 剩余风险：时间表示 Runtime 获取数据，不是商家更新或菜单有效时间。Provider 仍从
  返回餐厅推断，空结果默认 amap、混合来源缺少逐事实绑定；独立来源、时间准入与逐条件
  裁决未闭合，R03 不能结项。未执行真实服务、浏览器、数据库或部署验收。

### 后续切片：Observation 来源引用

- 对抗性检查发现 fetchedAt 只挂在 observation 上，候选证据没有绑定到这次数据获取，
  Guard 也无法确认引用真实存在。新增 `targetEvidence.observationRef` 后，Runtime 使用
  本次 `plan.planId` 填充，FinalGuard 核对 observation 存在、Provider 与餐厅来源一致，
  并且 fetchedAt 已记录。
- 对抗用例先复现“引用指向缺失 observation，但字段快照仍匹配”仍进入主推荐；修复后该
  候选降为候补。旧会话无引用仍可读取，但不能支持非分组必选目标。
- 全量验证 73 suites / 656 tests 通过；offline eval 15/15，type-check、lint、
  docs:check 通过。真实模型/地图、浏览器、数据库和部署验收仍未执行；逐条件裁决
  未实现，R03 不能结项。

### Observation 提交顺序回归修复

- 复查上一切片发现：`commitSearchPlanResult` 在 observation 尚未保存到上下文时，
  就执行候选合并和准入统计。最终发布可接受的候选，其 `acceptedPrimaryIds` 却为空，
  导致搜索统计与最终结果不一致，并影响合并时的来源资格比较。
- 回归测试先复现空列表，再将来源保存移动到同一计划的合并与准入之前；批次完成时
  只发事件，不再次追加。没有放宽 FinalGuard 或改变模型证据结论。
- 验证：73 suites / 656 tests、offline eval 15/15、type-check、lint 通过；补充断言
  核对事件、trace、JSON 会话快照和 observation 唯一性。该切片只修复提交顺序。
- 后续审查仍发现 `!observationRef` 兼容分支允许缺引用的字段证据，与 Spec 的失败关闭
  要求不一致；现有正向测试也依赖该分支。必须先补来源缺失回归并迁移测试来源，不能
  以本次全绿宣称来源契约闭合。完整逐条件裁决、真实服务与浏览器验收仍未完成。

### 缺失 Observation 引用失败关闭

- 删除缺少 `observationRef` 时放行的兼容分支；显式组与非分组必选项共用失败关闭边界。
  旧会话仍可读取，候选原始 verdict 不变，只失去该证据支持主推荐的资格。
- 以旧分支重跑新增回归，分组、非分组和 JSON 恢复后的缺引用场景均失败；修复后通过。
  同时覆盖 observation 缺失、Provider 不符、时间缺失以及合法来源正向路径。
- 迁移正向 fixture，并保留错店、空引用、字段变化等测试的有效来源，使每个反例只破坏
  自己要验证的条件。贯通 schema、evaluator、JSON 恢复和 Guard 的正向回归也已迁移。
- 本地验证：`test:ci` 73 suites / 663 tests 和覆盖率门禁通过，offline eval 15/15，
  type-check、test:docs、docs:check、diff 空白检查通过；lint 的参数化测试换行问题修正后重跑通过。
- 本切片不是完整逐条件裁决，不证明名称或分类能验证实时菜单；未运行真实模型/地图、
  浏览器、数据库落库、Next/Cloudflare 构建或部署验收。下一步继续 R03 逐条件裁决。

### 逐条件裁决失败关闭

- `TargetEvidence` 新增 `verdict`，EvaluationModel 的结构化输出要求每条引用声明
  `supported/contradicted/unknown`；FinalGuard 只有 `supported` 且同时通过声明匹配、
  字段快照和 observation 来源检查时，才让该证据计入显式目标组或非分组必选目标。
  `contradicted/unknown` 不计入，缺失或非法裁决保持旧输入可读但不支持主推荐。
- 对抗回归覆盖非分组必选项的 unknown/contradicted/missing/invalid、JSON 恢复不变性、
  item/category 两条目标组路径，以及 any-of 从 unknown 不可入、一项 supported 可入、
  all-of 两项 supported 才可入的状态迁移；正向样例和离线桩全部迁移到显式裁决。
- 本地验证：`test:ci` 73 suites / 669 tests 和覆盖率门禁通过，offline eval 15/15，
  type-check、lint、`git diff --check` 通过；新增回归在旧实现下未知裁决可入主推荐，
  修复后降为候补。真实模型/地图、浏览器、数据库落库、Next/Cloudflare 构建与部署
  验收仍未执行；本切片不关闭 R03 或项目整体验收。

### Observation 最小事实快照

- 继续审查发现，字段引用虽然绑定了 observation id、Provider 和获取时间，但字段原值仍只
  与当前 `candidate.restaurant` 比较。Provider 返回对象若在模型评估或会话处理期间被改写，
  引用和值可以一起变化，Guard 无法证明该字段确实属于搜索返回瞬间。
- Runtime 现在在搜索 Promise 返回后、模型评估前复制每家门店的
  `id/source/name/cuisineType`，随同一次 observation 持久化。快照不共享 Provider 或候选
  对象引用；FinalGuard 要求引用同时匹配当前候选和该 observation 的同店、同来源、同字段值。
- 对抗回归覆盖快照缺失、错门店、字段变化、来源不符和正向路径，并验证评估阶段修改原
  Provider 对象不会回写已经复制的 observation。旧会话缺少 `facts` 时保持可读取，但不得
  从当前候选反填或支持主推荐。
- 本地验证：73 suites / 677 tests、offline eval 15/15、type-check、lint、docs:check 和
  `git diff --check` 通过。eval 仍报告五个既有用例的主推荐数量低于 2026-08-17 基线，
  未修改桩或历史基线追平数量。
- 该快照的事实来源仍是同一次地图搜索结果，只解决“引用属于哪次 observation、哪家门店、
  哪个原始字段”的本地可核对性，不是独立第三方菜单资料、商家更新时间或供应真实性证明。
  真实模型/地图、浏览器、数据库落库、Next/Cloudflare 构建与部署验收仍未执行；R03 和
  项目整体验收继续保持未关闭。

### Observation 目标版本绑定

- 继续对抗审查发现，候选本身已有 `goalId/verifiedAgainstGoalVersion/goalSignature`，
  但 observation 只绑定计划、Provider、时间和门店事实。若恢复数据被错误拼接，只要
  门店字段相同，当前候选仍可能引用另一目标或旧目标的 observation。
- Runtime 现在把当前 `goalId/goalVersion/goalSignature` 写入 observation。版本化目标下，
  FinalGuard 要求当前目标、候选验证版本和 observation 三者完全一致；缺版本、错目标、
  旧版本或错签名均失败关闭并保留候补机会。
- 对抗回归覆盖四种失败形状和正向路径，Runtime 回归核对目标引用经 JSON 快照保留。
  未版本化兼容调用不自动补造版本；真实 Runtime 会先补齐当前目标版本，因此旧会话缺少
  observation 版本时不能凭当前候选字段继续支持主推荐。
- 本地验证：73 suites / 682 tests、offline eval 15/15、type-check、lint、docs:check 和
  `git diff --check` 通过；既有五个 eval 用例的主推荐数量基线差异保持不变。

### 核心目标字段失败关闭

- R02 字段级复查确认：`defaultArray` 和 `optionalArray` 会把包含合法项与非法项的目标数组
  整体改成空数组或 `undefined`。例如一个损坏的 requested item 会同时抹掉合法菜品，
  一个非法排除项会清空全部 exclusions；GoalPatch 还可能继续应用同一输出中的距离约束，
  形成部分目标更新。
- Goal schema 现在只修复缺失、`null` 和合法单值转数组；requested items、categories、
  keywords、exclusions、preferences、authorizations 及补丁数组中任一成员无效时，整次
  结构化输出失败。硬约束中的数字、布尔和字符串数组字段也不再把非法值静默改成
  `undefined`。可执行的追问 option effects 同样失败关闭，避免保留看似可点但没有目标
  更新效果的选项。模型入口会按既有 `callStructuredModel` 契约执行一次 schema repair，
  修复后仍非法则显式返回 `MODEL_INVALID_OUTPUT`，不会应用不完整目标。
- 对抗回归先证明四类输入不会抛错：混合合法/非法目标、混合合法/非法目标补丁、非法
  距离或排除字段，以及被静默删除的非法 option effects；修复后全部失败关闭。合法标量
  数组输入、缺失字段、`null` 和既有默认值回归保持通过。追问纯展示项继续使用专门的
  逐项过滤契约，不与可执行目标数组混用。
- 本地验证：73 suites / 686 tests、offline eval 15/15、type-check、lint、docs:check 和
  `git diff --check` 通过。既有五个 eval 用例的主推荐数量仍低于 2026-08-17 基线，
  未修改 fixture 或历史基线掩盖差异。
- 本切片闭合 R02 的本地 schema 契约，不证明真实模型输出分布、提示词质量或真实服务
  可用性；这些仍需在 live eval 中单独报告。

### R04 三种评测模式隔离

- 评测入口收敛为三个精确模式：`offline` 使用桩模型与地图 fixture；
  `live-model-fixture-map` 使用真实模型与同一地图 fixture；
  `live-model-live-map` 使用真实模型与真实高德。旧的 `live` 模糊标签继续拒绝，模式名称
  不能再与实际执行路径分离。
- 配置预检先于 Runtime、模型和高德模块的动态导入。两个 live 模式缺
  `OPENAI_API_KEY` 时失败；真实地图模式还要求 `AMAP_API_KEY` 和
  `EVAL_ALLOW_LIVE_PROVIDER=1`。这些缺口统一返回 `CONFIG_MISSING`，不会调用模型、
  高德或回落到 fixture。
- Jest 的三个模型替身现在由同一 harness 模式路由：只有 offline 使用桩；live 模式调用
  真实 GoalUnderstanding、KeywordExpansion 和 Evaluation 实现，并在模块导入前删除
  `AGENT_DETERMINISTIC`。SearchReplan 同样因此走真实模型分支。地图调用量和并发统计移到
  fixture/真实 Provider 共用包装层。
- offline 专用故障注入用例显式声明运行模式。真实模式不使用桩错误冒充供应商故障，
  不读取、不比较也不能更新 offline baseline；`eval:baseline` 明确固定为 offline。
- 本地验证已确认模式单测、类型检查和 offline eval 15/15 通过；五个既有用例的主推荐
  数量仍低于 2026-08-17 baseline，未修改历史快照。缺模型 key 的真实模型模式、缺高德
  key/授权的真实地图模式均在任何外部请求前失败关闭。
- 当前本地环境没有可用于本项目验收的真实模型和高德凭证，因此没有运行付费或公网实调，
  也不宣称模型语义、地图数据、延迟、成本或成功率已经通过。R04 的本地模式隔离完成，
  真实服务验收仍是开放项。

### 最终对抗性审查与本地验收（2026-09-18）

审查实现范围为 `c78c67b..e2fd77d`。复查重点包括目标与 Provider query 保真、核心目标
schema 失败关闭、逐条件证据到 observation 事实快照和目标版本的绑定、Runtime 提交顺序、
三种 eval 模式与 baseline 隔离、会话 JSON 恢复边界以及 Cloudflare 构建绑定。没有发现该
范围内新的、可复现的阻断缺陷；这表示已实现切片的本地门禁通过，不表示整个改进项目无风险。

本地验证结果：

- `npm run test:ci -- --silent` 通过：73 suites / 692 tests，覆盖率门禁通过。
- `npm run eval` 通过：offline 15/15；五个既有用例的主推荐数量仍低于
  2026-08-17 baseline，没有修改 fixture 或历史快照掩盖差异。
- `npm run type-check`、`npm run lint`、`npm run docs:check`、`npm run test:docs`
  和 `git diff --check` 通过。
- `npm run build`、`npm run build:cloudflare` 和 `npm run deploy -- --dry-run` 通过。
  Wrangler dry-run 识别 Durable Object、D1、Rate Limit 和 Assets 绑定；没有部署、
  上传凭证或执行远端 migration。

本地运行验收使用 `http://127.0.0.1:3100`，显式清空模型和地图凭证，并设置本地
Provider scheduler 与仅本机使用的 session owner secret。首页和 `/history` 返回 200，
首页主要功能区与空历史状态可见；缺少 location 的 Agent 请求返回 400，
`/api/map/config` 返回 `configured:false`。首次 Agent 请求因本地 D1 未迁移返回 503；
只执行 `npm run db:migrate:local` 后，SSE 返回 200 和 `text/event-stream`，发出
thinking/status，随后以 `CONFIG_MISSING`、`recoverable:false` 结束，证明无模型凭证时在
外部模型或地图请求前失败关闭。没有把这条失败路径当成成功搜索验收。

`next dev` 对生产 Durable Object 导出给出本地运行限制提示；本次验收通过
`PROVIDER_SCHEDULER_MODE=local` 避开该能力，Cloudflare build/dry-run 只证明产物和绑定可被
静态识别，不证明真实 Durable Object 调度已经运行。390px 移动视口下首页灵感 chips 右侧
存在既有裁切/横向溢出；该问题不在本次 Agent 架构 diff 中，作为范围外 UI 残余保留，
没有混入当前提交。

本轮可以确认 R01-R04 已批准切片的本地实现与失败关闭边界，但不能关闭完整项目：

- 未使用真实模型、真实高德或真实菜单/商家资料，模型语义和事实质量未验收；
- 未验收生产 D1、生产 Durable Object、真实会话恢复、负载、延迟、成本或线上成功率；
- 未完成带真实服务的浏览器成功搜索、主推荐/候补展示和转盘端到端验收；
- R05-R09 仍未实施，文档中待评审的排序、召回、反馈、局部失败和持久化决策不得上线。

因此本次结论是“已实现切片通过本地验收，完整项目继续开放”，不是上线批准、部署批准或
项目结项。

### R05 召回、渐进评估与合格后排序（本地回归通过）

- 高德 Adapter 与共享餐厅合并层删除品牌级去重，只按 Provider id 或同名同位置身份键
  合并同一物理门店。同品牌不同位置的门店继续进入硬约束、模型评估与上游选择。
- Runtime 把候选验证改为有界渐进批次：达到目标数量即可停止，预算外和提前停止后的
  候选记录为 `unevaluated`，Observation、trace、SSE 事件与会话摘要同时暴露停止原因；
  未评估候选不生成失败 verdict，也不获得候补资格。
- Evaluation model 不再通过置信度或局部分批 `selectedIds` 决定推荐质量。Evaluator 只
  计算距离和已有价格偏好的确定性效用；Policy 在通过准入的集合中加入同 Provider 评分
  归一和品牌多样性，形成最终顺序。FinalGuard 与 UI 继续保序且不按品牌折叠。
- 对抗回归复现并修复了“模型自报通过但缺证据仍导致提前停止”：现在用 Provider 返回时
  的事实快照和当前目标版本构造只读准入上下文，复用 FinalGuard，不另造准入规则。
  前九家缺证据、后面三家有效的用例会继续评估并保留有效结果。旧会话未知未评估数返回
  `null`；共享合并层的旧身份别名不会因反复替换而丢失。
- `npm run test:ci -- --silent --coverageReporters=json-summary`：73 套件 / 700 测试通过；
  `npm run eval`：15/15 通过，原有五项相对 2026-08-17 baseline 的主推荐数量差异保留，
  没有重写基线。类型检查、lint、文档检查和 `git diff --check` 通过。
- 本阶段没有重新验证构建或真实服务。评分权重只是已批准的确定性实现，不宣称转化或
  推荐满意度提升；真实模型、高德与浏览器成功路径仍需单独验收。
  本切片不触碰生产 D1 或 Durable Object。

### R08 显式部分成功（本地回归通过）

- 明确目标的首搜和扩词全部结算后再收尾。扩词失败时，仅在已有严格合格主推荐的情况下
  返回部分成功，附用户警告及 trace；开放探索或仅有缺证据候补时仍失败。
- 每个成功评估批次立即进入本轮裁决集合和缓存。后续批次失败不会丢掉成功结果，也不会
  重新评估已成功批次；失败批次和剩余候选保持未评估状态。
- 定向测试覆盖慢首搜/快扩词失败、开放探索失败、证据缺失、第二批失败和终止后无迟到
  发布。全量 74 套件 / 704 测试通过；offline eval 15/15、类型/lint/文档检查通过。
  offline 评估故障用例重复评估由 5 降为 0；未据此声称真实费用、延迟或成功率改善。

### R09 恢复、取消与观测（本地回归通过）

- Runtime 对理解、搜索、评估阶段的失败和取消统一生成带类型化错误码的
  `AgentRunError`，快照保留失败前的 goal、attempt、candidate、observation 和 trace。
  取消发生在渐进评估中时，已完成批次仍写入 observation，停止原因为 `cancelled`；
  Provider 取消不再追加“搜索失败” attempt 或 `SEARCH_PROVIDER_FAILED` trace。
- 模型请求从每次 HTTP attempt 发起时计数，包括传输失败、tool/function 协议降级和
  schema/truncation 重试。只有所有 attempt 都返回完整 usage 时才报告精确 token 总量；
  否则总量为 `null`，已知部分保留在 `knownPromptTokens/knownCompletionTokens`。
- 聊天路由暂存 Runtime `final`，先保存 runtime state 和助手消息，再发布一次终态及
  `session_updated`。保存失败返回 `SESSION_PERSIST_FAILED`，取消或断流后不补发迟到的
  `final/done`；失败与取消快照在租约仍有效时尽力保存。
- 对抗回归覆盖理解阶段失败、传输失败无 usage、部分重试 usage、渐进评估取消、Provider
  取消、失败 trace 持久化、保存失败和终态顺序。全量 74 套件 / 713 测试通过；
  offline eval 15/15、类型检查、lint、文档检查和 `git diff --check` 通过。
- 本阶段没有触碰生产 D1/DO。真实模型 usage 分布、真实高德中断和真实浏览器取消/重连
  仍需在获准的非生产环境单独验收，不能由本地桩测试代替。

### R06 多轮目标语义与真实原因追问（本地回归通过）

- 删除追问态把所有 `addRequestedItems/addCategories` 强制改写成 `replace*` 的兼容逻辑。
  GoalUnderstandingModel 提示和 JSON schema 继续要求结构化 patch，明确“再加/还要/以及”
  使用追加字段，“换成/改成/不要原来的”使用替换字段；目标代数只执行该声明，不根据
  `pendingQuestion` 状态猜测用户意图。
- 确定性 option effect 遵守同一契约：显式 `add*` 保留旧目标，显式 `replace*` 才清除
  旧目标。替换仍会清空旧的派生扩词与 Provider 分类，追加会形成新目标版本并使旧候选按
  既有上下文失效规则重新验证。
- Policy 复用 FinalGuard 的单一准入原因。存在 `UNVERIFIED_EVIDENCE` 或
  `REQUIRED_ITEM_UNSUPPORTED` 时，追问明确说明证据不足并允许用户补充或更换目标；strict
  距离仍存在时也不再把该失败伪装为“范围太小”。真实零召回且没有更具体失败原因时，
  既有扩大距离选项保持不变。
- 回归覆盖追问 option 的追加/替换、自由文本模型 patch 的 add/replace 保真、严格距离与
  证据缺口并存，以及 FinalGuard/Runtime 既有行为。全量 74 套件 / 717 测试、offline
  eval 15/15、类型检查、lint、文档检查和 `git diff --check` 通过。真实模型对自然语言
  关系的判断仍需在非生产 live eval 中单独验收，不能由提示词和桩响应代替。

### R07 随机结果与显式偏好分离（本地回归通过）

- `TurntableRecord.selected` 继续记录随机赢家，供历史详情、搜索和“抽中次数”展示使用；
  历史统计不再把随机赢家称为“最常去”或“最喜欢”。
- 偏好摘要对同一转盘候选集合使用相同的弱曝光权重，不再因随机赢家变化写入餐厅名、距离、
  价格或更高菜系权重。旧历史没有显式反馈字段时也不会反向补造确认事件。
- 已有 `userFeedback` 契约中的 `like/dislike` 分别产生显式正向或负向信号，手动移除继续
  产生负向信号。当前阶段没有新增完整反馈 UI，也没有上传本地历史或改变服务端证据裁决。
- 回归覆盖同候选集合不同赢家摘要完全相同、随机赢家不生成距离/价格/餐厅强偏好，以及
  显式反馈和手动移除的正负信号。全量 74 套件 / 718 测试、offline eval 15/15、
  类型检查、lint、文档检查和 `git diff --check` 通过。真实浏览器历史写入与后续搜索
  传递仍需单独验收。

### 对抗性审查修复：跨计划渐进评估早停

- 已确认中等级别、高置信度缺陷：`hasEnoughEvaluatedPrimaries` 的只读预览原先用当前计划
  的新候选替换 `context.candidates`。当先前计划已经提交 5 家合格主推荐、后续计划首批再
  验证 3 家时，真实总数已经达到 8 家，但预览只看到新 3 家，继续额外调用两个评估批次。
  该缺陷主要增加模型成本和完成延迟，不会把未验证候选提升为主推荐。
- 新回归先在旧实现下稳定失败：期望第二轮只评估一批 3 家，实际评估批次为
  `[3, 3, 3]`。修复后预览先复制已提交候选，再通过现有 `mergeCandidates` 语义合并当前
  评估结果，最后仍由同一个 FinalGuard 判断是否达到目标；真实上下文不被预览修改。
- 定向回归通过；完整 `npm run test:ci -- --silent --coverageReporters=json-summary`
  为 74 套件 / 719 测试通过，offline eval 15/15，type-check 和 lint 通过。该修复不改变
  资格、排序、预算上限或用户可见契约，只让已经达到目标的路径及时停止评估。

### 批准阶段最终验收收口（2026-09-18）

本次收口覆盖已批准顺序 R05、R08、R09、R06、R07 及其最终对抗性修复，对应本地提交为
`4b74fda`、`f2e7963`、`04ac747`、`b84fcd1`、`2450ad5`、`2ad0b60`。这些提交均为独立
阶段提交，没有推送、合并或部署。

完整本地质量门禁结果：

- `npm run test:ci -- --silent --coverageReporters=json-summary` 通过：74 suites /
  719 tests，覆盖率门禁通过；
- `npm run eval` 通过：offline 15/15；没有改写历史 baseline 掩盖既有主推荐数量差异；
- `npm run type-check`、`npm run lint`、`npm run docs:check` 通过；
- `npm run build`、`npm run build:cloudflare`、`npm run deploy -- --dry-run` 通过；
  dry-run 没有部署，也没有执行远端 D1 migration。

最终对抗性审查发现并修复一项中等级别问题：渐进评估早停预览只读取当前计划的新候选，
遗漏先前计划已经提交的主推荐，导致总数已经达到目标时仍多调用两个模型批次。回归先在
旧实现下稳定得到 `[3, 3, 3]`，修复后只评估首批 `[3]`。审查未发现其余可复现的阻断
缺陷，但这只证明当前本地实现和测试覆盖下没有已知阻断，不等于真实模型或地图质量已经
通过。

非生产浏览器验收使用 `http://127.0.0.1:3100`、本地 Provider scheduler 和临时生成的
session owner secret。没有连接生产 D1 或 Durable Object。验收结果如下：

- Chrome 自动定位返回上海测试坐标。缺少高德凭证时反向地理编码返回 503，页面仍保留
  坐标，没有把位置状态清空；
- Agent 请求返回 HTTP 200 和 `text/event-stream`，先发送 `thinking/status`，再以
  `CONFIG_MISSING`、`recoverable:false` 结束。页面显示配置错误，没有发布主推荐、候补、
  转盘或伪成功终态；
- 点击错误页“返回”后，原查询“想吃寿司，步行 15 分钟内”和坐标仍保留，用户可修复配置
  后重试；
- `/history` 显示 0 条记录和明确空态，失败搜索没有生成转盘历史；
- 1280x720 桌面视口及 390x844 移动视口下，首页和历史空态均未发现横向溢出。失败请求
  后控制台仅出现与缺失高德/模型配置对应的 503 和 Agent 错误；重新加载的首页与历史页
  没有额外 warning 或 error。

真实服务验收仍未通过。当前安全运行环境只暴露变量名检查结果，没有
`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`AMAP_API_KEY` 或
`EVAL_ALLOW_LIVE_PROVIDER`。`live-model-fixture-map` 和 `live-model-live-map` 入口因此
在任何外部调用前分别拒绝执行；没有读取私有文件，也没有输出或提交凭证值。

因此当前可以确认：

- R05、R08、R09、R06、R07 的已批准本地实现、阶段提交、全量回归、离线评测、构建、
  Cloudflare dry-run、浏览器失败关闭与恢复路径均已完成；
- 真实模型语义、真实高德数据、真实 usage/延迟、成功搜索后的主推荐与候补分区、转盘、
  多轮追问、取消和重连仍未实证；
- 生产 D1/DO、推送、合并和部署始终未获授权且未执行。

完整项目继续保持开放。下一次可执行验收需要在启动评测和本地服务的同一安全运行环境中
注入上述模型与高德配置，再依次运行真实模型固定地图评测、真实模型真实地图评测和浏览器
成功路径；在这些证据产生前，不得把当前结论表述为真实服务验收通过或上线批准。
