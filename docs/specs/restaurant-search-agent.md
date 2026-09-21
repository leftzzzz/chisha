# Restaurant Search Agent Spec

本 Spec 适用于 `lib/agent/**`、`app/api/agent/**`、`evals/**`、
`__tests__/lib/agent/**` 以及 Restaurant Search Agent 架构文档。

当前生效的架构决策见
[`../technical/current-agent-workflow.md`](../technical/current-agent-workflow.md)，
产品目标和验收标准见
[`../requirements/restaurant-search-agent.md`](../requirements/restaurant-search-agent.md)；
跨功能的输入、转盘和历史规则见
[`../requirements/chisha-product-rules.md`](../requirements/chisha-product-rules.md)。

## 当前实现边界

- `runSearchAgentV3` 的确定性 multi-model workflow 是当前已接受的生产架构，不是等待
  Lead Agent 替换的过渡实现。
- `orchestrator/policy.ts` 决定常规 action；模型只执行目标理解、关键词扩展、候选验证和
  受限 replan 等局部语义任务；Runtime 负责执行、预算、并发、持久化和发布边界。
- 当前架构不要求实现 `RestaurantSearchLeadAgent`、统一模型可见 `Agent` tool、
  model-tool loop 或 subagent lifecycle。此前方案保留为已评估但暂缓的备选架构，不得
  作为当前实现缺口或 PR 验收项。
- 新增行为不得继续扩大菜品、菜系、品牌、地域叫法或失败 query 的语义特判集合。

## 模型角色与调用命名

- 一次强制结构化输出的模型请求是 model role，不是能够自主使用工具和循环执行的
  subagent。当前目标理解、关键词扩展、候选验证和 replan 都属于这种模型角色。
- 单次结构化模型调用的公共名称使用 `callStructuredModel`；一次性角色使用
  `<Purpose>Model`。历史名称可以兼容迁移，但不能据此宣称实现了 Agent 或 subagent。
- 单次调用的日志和指标维度使用 `modelRole` 或 `operationName`，不得用 `agentName` 混淆
  执行形态。
- `RestaurantSearchLeadAgent`、`<Purpose>Subagent` 和 `AgentToolHandler` 只用于描述
  未来经过独立决策重新启用的真正 model-tool loop，不属于当前命名要求。

## Workflow 职责

1. Goal understanding model 把用户表达解析为保留原文和显式约束的 `UserGoal`。
2. Keyword expansion model 产生有限、可追踪的自然语言搜索建议，不拥有最终搜索策略。
3. `policy.ts` 基于目标、授权、观察结果和预算决定常规 action、追问、受限 replan 与结束。
4. Evaluation model 只判断候选证据，不改变目标、授权或搜索关系。
5. Runtime 执行 action，并负责 schema、预算、超时、重试、并发、幂等、会话恢复、取消、
   状态持久化、trace 和 FinalGuard。

固定的 workflow 顺序是当前有意保留的调度机制。正确性来自通用契约、证据边界和覆盖
整个运行轨迹的 eval，而不是来自为某个 query 追加分支。

## Runtime 与 Policy

- `Policy` 是当前架构中的受限 action planner。它可以在明确、有限的策略空间内决定下一
  action，但不得用菜品、菜系、品牌或地域 taxonomy 代替开放世界语义理解。
- Runtime 执行并约束 workflow，不得把模型或 policy 已产生的 action 改写成语义不同的
  “合法动作”。
- 硬距离、明确排除项、停业、安全与用户授权是 Runtime 可执行的确定性边界，任何模型
  角色和 Provider 工具都不能绕过。
- 当前 Runtime 不承担 parent-child task tree、subagent context 或 model-tool loop；只有
  在新的技术决策和对拍 eval 证明收益后，才允许引入这些能力。

## 最终推荐发布边界

- 任何返回主推荐的正常完成、预算耗尽、收敛或部分结果路径，都必须由 Runtime 在
  ResultAssembler 之前显式调用同一个 FinalGuard。不得让装配器反向拥有 Guard。
- FinalGuard 是单调边界：只能删除、降级、分区和保序精确去重，不能自动补位、生成
  替代候选、重新排序、随机打散、品牌折叠或改变 evidence verdict。
- proposal 显式提供 `selectedIds` 时，主推荐只能从这些 id 中产生；过滤不合格 id 后
  不得从其他候选自动补足。保留下来的候选维持 proposal 相对顺序。
- FinalGuard 必须按当前餐厅事实重新计算可确定的距离、预算和营业状态硬约束，不能只
  信任候选已有的 `hardFailures`。明确失败从发布结果删除；严格约束字段未知只能作为候补。
- FinalGuard 核对每个显式目标组：`all_of` 的各项必须全部匹配，`any_of` 至少匹配一项；
  空组或缺项只能降为候补。只消费既有菜品/品类匹配的完整目标名称，不做子串或同义推断；
  搜索范围授权不豁免目标组覆盖要求。匹配覆盖不等于证据来源真实性已验证。
- 显式目标组与非分组必选目标还要求 `targetEvidence`：模型声明完整目标、item/category 类型、
  本店 name/cuisineType 的完整字段引用和 `supported/contradicted/unknown` 逐条件裁决。
  Guard 按同一 schema 校验引用结构，并核对门店 id、
  字段原值、对应匹配声明，以及 observation 在 Provider 返回时复制的最小事实快照；
  证据引用必须同时匹配当前候选和该快照中的同一门店、同一来源、同一字段值。
  缺引用、空引用、错店、错来源、字段变化或旧 observation 缺少事实快照时不能支持目标组。
  旧候选仅有 matchedBy 标签时不得豁免；非法模型引用移除引用资格但保留原裁决和候补机会。
  这是 observation 所有的事实快照引用检查，不是关键词匹配，也不是独立第三方资料源、
  商家更新时间或菜单真实性证明。
  只有 `supported` 计入目标覆盖，`contradicted/unknown` 不计入；缺失或非法裁决可读取但
  不能支持主推荐。非分组必选目标逐项核对完整名称匹配，
  不能以非空数组、重复项或无关匹配替代；
  已归入显式组的目标按组语义判断，可选项不强制匹配。既有已授权宽泛搜索例外保持不变。
  非分组必选目标同样核验对应 item 引用，不能以 category 引用替代；字段引用与模型
  裁决不等于独立验证菜单、配方修饰词或实时供应，不能替代真实服务的证据质量验收。
- `unverified` 只能进入明确标注的不确定候补；`failed`、过期或明确违反硬约束的候选
  不得对外发布。未授权 broaden 满足候补安全条件时只能作为候补。
- Runtime 必须记录 FinalGuard verdict、实际主推荐/候补 id 和结构化 violations，最终
  发布 trace 必须能与该 verdict 对照。
- ResultAssembler 只接收 guarded result，执行字段映射和基于已有事实的展示格式处理；
  不得调用 FinalGuard、推断搜索策略或改变候选集合和顺序。
- guarded result 进入 UI 后的裁剪、地点去重、primary/backup 分区和候补显式加入行为由
  [Application Behavior Spec](./application-behavior.md) 统一约束；本 Spec 不再维护第二份
  reducer 规则。
- 当前 workflow 对不合格 finish proposal 执行上述单调降级，并复用现有追问/安全结束
  逻辑。不得为模拟尚不存在的 model-tool loop 增加伪模型重试。

## 地点搜索契约

当前 workflow 的搜索 action 使用少量、面向任务的高层契约。地点召回以自然语言 query
为主：

```ts
interface SearchPlacesInput {
  query: string;
  location: Location;
  radiusMeters: number;
  relation: 'exact' | 'equivalent' | 'broader' | 'alternative';
  filters?: {
    openNow?: boolean;
    maxAveragePrice?: number;
  };
}
```

- 不得向模型角色或搜索规划层暴露 `lookup_place_categories`、`list_place_categories`、
  `CategoryRegistry`、`categoryRef`、POI typecode 列表或任何
  `natural-language -> provider-code` 步骤。
- `search_places.query` 必须保留上游 action 给出的自然语言，不得通过 taxonomy、子串、别名
  表或 Adapter 静默改写。
- Amap adapter 固定使用 `keywords = query`、`types = 050000`。`050000` 只限定本产品
  搜索餐饮场所，是稳定 Provider 范围配置，不表达菜品、菜系或目标匹配。
- Amap、OSM 等 Provider adapter 只做协议转换、分页、超时和无损字段规整，不做用户
  意图、broaden、搜索方向或候选资格判断。
- Provider adapter 和共享合并层只按 Provider id 或同名同位置身份键去除同一物理门店；
  同品牌不同位置的门店必须保留到候选选择阶段，不能在召回层按品牌折叠。
- 高德分类码表只能把返回的 `typecode` 解释为 Provider 事实，例如
  `050202 -> 日本料理`；不得反向参与搜索 planning，也不能证明餐厅提供寿司。
- 第一次搜索不足时，由受限 replan model 提议、`policy.ts` 接受新的自然语言 action。
  任何 `broader` 或 `alternative` action 都必须显式记录 relation、rationale 和用户授权，
  不能由 Runtime 或 Adapter 自动生成。

每个搜索 action 至少包含：

```ts
interface SearchAction {
  id: string;
  query: string;
  supportsGoalIds: string[];
  relation: 'exact' | 'equivalent' | 'broader' | 'alternative';
  rationale: string;
  authorizationRef?: string;
}
```

- `allowedForPrimary` 不属于模型产生的 `SearchAction`。Runtime 必须根据 action 的
  `relation` 和授权记录派生搜索范围资格，模型不能直接声明或覆盖该结果：

```ts
const primaryScopeAuthorized =
  action.relation === 'exact'
  || action.relation === 'equivalent'
  || authorizationCovers(action.authorizationRef, action);
```

- `authorizationCovers` 必须校验授权引用确实覆盖当前 goal、relation 和 action scope；
  引用缺失、失效或范围不匹配时返回 `false`。
- `primaryScopeAuthorized` 只表示 action 的搜索范围是否可用于主推荐，是候选准入的必要
  非充分条件。候选仍必须通过证据验证、硬约束和 FinalGuard，不能仅凭该派生值进入
  主推荐。
- `SearchAction.id` 是 trace、observation 和授权关联使用的稳定标识；Runtime 接受 action
  时分配并持久化，模型不负责生成技术 id。

## Goal、授权与证据

- UserGoal 必须保留用户原始表达和全部显式约束。派生搜索只能成为新 action，不能
  覆盖 UserGoal；多轮修改生成新版本并记录来源。
- 多轮目标修改必须由结构化 GoalPatch 明确区分追加和替换：`addRequestedItems` /
  `addCategories` 保留已有目标，`replaceRequestedItems` / `replaceCategories` /
  `replacePrimaryKeywords` 才替换已有目标。任一主目标 `replace*` 字段出现时，必须把本次
  补丁视为跨菜品、分类、关键词和备选组的原子目标切换：未在本次补丁中重新声明的旧主目标
  维度必须清空，旧目标的品类放宽、开放兜底和未验证候补授权同时失效；与保留硬距离约束
  对应的距离授权可以继续保留。同一补丁中的 `add*` 和新授权只作用于新目标。处于追问阶段
  本身不能把追加操作改写成替换。
- UserGoal 和 GoalPatch 的目标、分类、关键词、排除项、偏好、授权及约束数组只允许对
  缺失、`null` 或单值转数组做结构修复。数组中任一语义条目或约束字段无效时，必须拒绝
  整次结构化输出并进入 schema repair 或显式失败，不能把整个字段静默变为空数组或
  `undefined` 后继续执行部分目标。追问展示选项等明确声明为可丢弃的非执行字段除外。
- 首轮 `hardConstraints` 与多轮 `addConstraints` 共用硬约束条目校验；条目非法时必须拒绝
  该结构化输入，不能把整组约束解释为空或未提供。未提供追加字段仍表示不修改。
- `broader/alternative` 不能因搜索失败自动获得主推荐资格，必须存在用户预先授权或
  一次显式追问的授权记录。
- 召回 query、Provider category 和目标证据是三个不同概念。搜索命中和 POI category
  只能作为召回或候选事实，不能直接证明菜品供应。
- Evaluation model 只返回 `supported`、`contradicted` 或 `unknown` 及证据来源。
  菜单项、商家页面或其他可追溯资料可以支持菜品结论；仅有“高德归类为日本料理”时，
  “提供寿司”仍为 `unknown`。
- FinalGuard 只能删除、降级或分区，不能把 `unknown/unverified` 提升为 `supported` 或
  主推荐。证据不足的候选只能进入明确标注的不确定候补。
- Observation 和 evidence 必须记录 action id、Provider、原始 query、Provider 参数、
  来源、获取时间和可追溯原始事实。
- 当前 `AgentObservation.fetchedAt` 记录 Runtime 收到搜索结果时的 Unix 毫秒时间，
  不得使用后续模型评估或批次提交时间替代。它不是商家资料的更新时间，也不证明
  菜单时效；旧会话没有该字段时，不得补成当前时间来伪造新鲜度。
- 当前 `AgentObservation.facts` 在 Provider Promise 返回后、模型评估前复制每家门店的
  `id/source/name/cuisineType/rating/distance/address/businessStatus/averagePrice/poiTypeCode/location`。
  它是该次 observation 的只读最小事实快照，不与后续可变候选对象或 Provider 对象共享引用，
  嵌套位置也必须复制。FinalGuard 只接受同时匹配当前候选与该快照的字段引用；旧会话缺少
  `facts` 时不得从候选反填，也不得继续支持主推荐。
- Runtime 生成的 observation 同时记录当前 `goalId/goalVersion/goalSignature`。当当前目标
  已版本化时，FinalGuard 要求 observation、候选验证版本和当前目标三者完全一致；旧
  observation 缺少目标版本、引用其他目标或引用旧版本时，即使门店字段仍相同也不能支持
  主推荐。Runtime 外未版本化的兼容调用不据此伪造版本。
- Runtime 生成的 observation 同时记录当前 `locationSignature`。只有目标 id/version/signature、
  位置签名、原始搜索 attempt 与全部未评估事实都可反查且完全一致的
  `evaluationStopReason=cancelled` observation 才能恢复；恢复只评估原 unevaluated 门店，
  不新增 Provider search action 或重复
  observation。恢复中再次取消必须保留本轮已完成评估批次；`evaluation_failed` 不自动重试。
  恢复完成后必须先交给 policy 判断 finish、ask 或后续 search，不得无条件扩词。
- 会话中存在带未评估事实的 cancelled observation 时，去掉首尾空白后正好是「继续」的自由文本
  是执行控制指令，必须原样重跑当前目标，不得交给 GoalUnderstandingModel 重建目标或清空
  可恢复 observation。除此之外的自由文本仍由 GoalUnderstandingModel 判断语义。
- Runtime 逐计划提交 observation 来源后，才合并候选并计算 `acceptedPrimaryIds`；
  不得在来源尚未进入当前上下文时计算准入。每个计划只保存一次 observation，事件、
  trace 与会话快照使用该次准入结果，不在整批结束时重复追加 observation。
- 显式目标组与非分组必选目标的 `targetEvidence.observationRef` 必须指向本次 Runtime 生成并持久
  的 observation `planId`，且 Provider 与候选来源一致。引用缺失表示旧会话兼容输入，
  可读取但不能支持主推荐；引用不存在或来源不一致时，该目标证据失效，候选只能降级，
  不能因字段快照仍相同而豁免。

## 候选评估与合格后排序

- Runtime 在硬约束过滤后按有界预算选择待评估候选，并按批次渐进调用 Evaluation model。
  达到目标数量、评估预算耗尽、全部评估完成或评估失败时停止；未获得模型或缓存裁决的
  候选必须记录为 `unevaluated`，不得合成 `failed`、`unverified` 或候补资格。
- Observation 必须分别记录 `evaluatedIds`、`unevaluatedIds` 和
  `evaluationStopReason`。旧会话缺少这些字段时可以读取，但不能据此补造评估结论。
- Evaluation model 的置信度只表示目标裁决把握，不参与推荐质量分。通过主推荐准入的
  合格集合由 Policy 使用确定性效用排序：距离、已存在的价格偏好、同一 Provider 内归一化
  的评分以及品牌多样性。评分缺失保持缺失，不把不同 Provider 的原始评分直接当成同一量纲。
- 品牌多样性只改变合格集合的展示顺序，不删除同品牌不同门店。Policy 产生最终
  `selectedIds/candidateIds` 后，FinalGuard、ResultAssembler 和 UI 必须保序，不得再次
  排序、品牌折叠或用候补补位。

## 仍然生效的运行契约

- 模型或候选验证不可用时必须显式失败，不得用本地语义词表静默伪造模型结论。
- 明确目标已有通过 FinalGuard 准入的结果时，扩词失败可显式部分成功，并报告扩词不可用；
  开放探索依赖扩词或没有合格主推荐时仍失败关闭。并发操作必须全部结算后再发布或快照，
  不能在终止之后继续写入结果。
- 渐进评估按成功批次保留原始裁决；一批失败后停止本计划，不整计划重试已成功批次，
  失败及后续未评估门店不获得主推荐或候补资格。已有合格结果时显式部分成功，否则报错。
- 错误码在抛出点使用 `AgentError` 类型化；消费端不得匹配错误 message 猜类型。
- Runtime 失败和取消必须携带最新可恢复快照并记录对应终止类型。取消前已经完成的评估批次
  可以保留，正在取消的 Provider 请求不得伪装成一次搜索失败 attempt，也不得在取消后发布
  `final`。
- 每个模型角色从请求发起时计入 attempt，传输失败和协议降级同样计数。任一 attempt 缺少
  usage 时，整轮精确 token 总量记为 `null`，同时仅以 `known*Tokens` 报告已知小计；
  不得用零表示未知成本。
- 追问选项使用稳定 id：`optionEffects` 的 key 是 `option.id`，前端回传 id，label 只
  用于展示。
- 没有主推荐时，Policy 必须按实际准入失败原因生成追问。候选因
  `UNVERIFIED_EVIDENCE` 或 `REQUIRED_ITEM_UNSUPPORTED` 无法进入主推荐时，应明确说明
  证据不足并让用户调整或补充目标；即使目标同时存在 strict 距离，也不能默认把失败归因
  于距离并只询问扩大范围。

## 禁止的实现方式

- 不得为单个菜品、菜系、品牌、地域叫法或失败 query 新增生产 `if`、正则、别名或
  taxonomy 词条来改变决策、搜索或准入。
- 不得用子串词表做有损语义归一或丢弃未知修饰词。
- 不得把 prompt 中的开放世界语义规则机械搬到 TypeScript 常量。
- 不得把 Provider 分类目录包装成模型可见搜索能力或让模型选择 typecode/ref。
- 不得让 FinalGuard、结果装配器、Runtime 或 Adapter 重新决定用户意图、broaden
  关系、搜索方向或证据状态。
- 不得把固定 action 序列、planner 模型调用为零或单个 golden case 通过当作 workflow
  质量证明；固定调度本身不是被禁止的架构。

允许的确定性逻辑包括 Unicode/空白规整、精确去重、schema 校验、数值边界、安全与
合规、用户明确授权检查、固定的 Provider 产品范围，以及不增加语义结论的过滤。

## Eval 要求

- 模型桩 + fixture eval 用于证明 Runtime/workflow 的搜索步数、调用量、重复评估、事件、
  缓存、持久化和最终分区回归；它不证明真实模型语义质量。
- 评测模式只允许 `offline`、`live-model-fixture-map` 和
  `live-model-live-map`。三者分别表示“桩模型 + fixture 地图”“真实模型 + fixture
  地图”和“真实模型 + 真实高德”，不得接受 `live` 等模糊标签或让模式名称与执行路径分离。
- 任一 live 模式必须在模型或地图调用前完成配置预检并关闭 `AGENT_DETERMINISTIC`。
  真实模型缺 `OPENAI_API_KEY`、真实地图缺 `AMAP_API_KEY` 或缺少显式 Provider 调用确认时，
  必须以 `CONFIG_MISSING` 失败，不能回落到桩、fixture 或确定性模型分支。
- offline baseline 只适用于 `offline`。真实模式不得读取、比较或更新该 baseline；故障注入
  用例若依赖模型桩，必须显式限定为 offline。
- 模型角色 eval 必须检查自然语言 query、relation、授权、证据、停止原因和最终分区；
  模型或 Provider 不可用路径必须显式覆盖。
- 对真实 OpenAI-compatible endpoint 的评测应报告目标保真、证据覆盖、成本、延迟和失败
  率，并单独报告 usage 缺失比例；不要求 Lead-only、subagent 调用或 child lifecycle 指标。
- 必须区分确定性 policy 分支与受限模型角色的质量和成本，避免用其中一侧的指标替代
  整体 workflow 表现。
- 评测集覆盖 typical、edge、adversarial、生产分布和 metamorphic/property cases：
  同义改写、修饰词/排除项追加、工具结果重排、证据删除、未授权 broaden。
- 新增具体菜名 eval 时，生产代码不得同步增加对应语义词条。

## 变更前检查

1. 这是事实/安全/Provider 协议，还是开放世界语义判断？
2. 是否保留用户原始目标、自然语言 query 和全部修饰词？
3. 是否出现分类目录、taxonomy 或 Adapter 对语义的静默改写？
4. 是否有任何 `unknown` 被提升？
5. 下一 action 属于 policy/Runtime 的确定性职责，还是模型角色的语义职责？
6. 模型角色的输入输出是否收敛，且没有引入 query-specific 特判？
7. 测试锁定的是通用不变量还是单个样例？
8. PR 是否把已暂缓的 Lead Agent/model-tool loop 误写成当前验收项？

相关契约改动至少运行适用的 workflow/模型角色单测、`npm run eval` 和文档结构检查。
