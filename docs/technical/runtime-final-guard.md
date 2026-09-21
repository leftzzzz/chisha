# Runtime FinalGuard 与结果装配技术方案

## 适用范围

本文落实
[`../requirements/final-recommendation-publication.md`](../requirements/final-recommendation-publication.md)
的发布边界。当前生效架构是 `runSearchAgentV3` 确定性 workflow；本文描述其终止边界，
不依赖未来 model-tool loop。

当前强制约束以
[`../specs/restaurant-search-agent.md`](../specs/restaurant-search-agent.md) 为准。

## 问题

现有依赖方向是：

```text
Runtime
  -> finalizeRecommendations
       -> applyFinalGuard
       -> 排序、随机打散、品牌折叠、unverified 补位、解释生成
  -> API/UI
       -> reducer 再用候补补足转盘
```

这带来四个问题：

1. FinalGuard 是否执行取决于是否经过某个装配器，而不是 Runtime 的完成契约。
2. Guard 在校验之后继续选择和补位，最终输出与上游 finish proposal 不一致。
3. ResultAssembler 根据 attempts 推断搜索策略，成为第二个语义决策点。
4. 前端把候补自动提升进转盘，绕过后端主推荐分区。

## 决策

采用显式、不可绕过的 Runtime 终止分支：

```text
finish proposal
  -> Runtime.applyFinalGuard
       -> accepted / filtered / rejected
       -> structured violations + guarded partitions
  -> Runtime trace
  -> ResultAssembler
       -> AgentFinalResult
  -> API/UI projection
```

依赖方向固定为：

```text
Runtime -> FinalGuard -> FinalGuardResult -> ResultAssembler
```

`ResultAssembler` 不得反向导入或调用 `FinalGuard`。

## FinalGuard 契约

### 输入

- 当前不可变目标与位置上下文；
- 已观察候选和各自来源 attempt；
- finish proposal 的 `selectedIds`、`candidateIds`、explanation 和 unmet constraints。

### 输出

```ts
interface FinalGuardResult {
  verdict: 'accepted' | 'filtered' | 'rejected';
  primaryCandidates: RestaurantCandidate[];
  backupCandidates: RestaurantCandidate[];
  unmetConstraints: string[];
  violations: FinalGuardViolation[];
}
```

- `accepted`：提议的主推荐都通过准入。
- `filtered`：至少一个提议主推荐被降为候补或删除，但仍有合法主推荐。
- `rejected`：提议包含主推荐，但没有任何候选能进入主推荐。

### 单调性

FinalGuard 可以：

- 删除不存在、失败、过期或违反硬约束的候选；
- 把证据不足、未获主推荐授权或不满足主推荐准入的候选降为候补；
- 对完全相同的地点做保序去重；
- 生成结构化 violation 和不满足约束事实。

FinalGuard 不可以：

- 从 proposal 之外选择替代主推荐；
- 把 `unverified` 提升为 `passed`；
- 改写 goal、relation、authorization 或 evidence；
- 按 score、distance、brand 或随机种子重新排序；
- 自动调用搜索或验证能力。

### 顺序和去重

当 proposal 显式提供 `selectedIds` 时，主推荐只从这些 id 中产生，并保留其顺序。被拒
候选进入候补时也保留相对顺序。proposal 未提供列表的当前 workflow 兼容路径保留
Runtime candidate order。

去重只保留第一次出现的同一候选或同一物理地点，不进行品牌级折叠，不根据分数选择
另一个重复项。

### 主推荐与候补

主推荐继续复用唯一的严格准入谓词：

```text
fresh
AND verification.status == passed
AND verification.primaryEligible
AND no recorded hard failures
AND current deterministic hard constraints pass
AND source attempt exists
AND scope authorized for primary
AND required item evidence satisfied when applicable
```

候补至少满足：候选新鲜、没有硬约束失败、verification 不是 `failed`。未授权放宽和
`unverified` 可以进入候补并带明确 warning；过期或硬约束失败候选直接删除。

FinalGuard 使用当前餐厅事实重新执行 `distance`、`budget` 和 `open_now` 等确定性硬约束。
明确失败时从两个分区删除；严格约束因字段缺失而无法验证时，不得进入主推荐，但仍可
作为明确标注的不确定候补。这样最终边界不依赖上游是否正确填充 `hardFailures`。

## Runtime 完成协议

当前 workflow 的 `finish()` 和 `buildPausedResult()` 必须显式执行：

1. 构造 finish proposal；
2. 调用 `applyFinalGuard`；
3. 记录 `guard_decision` trace，包括 verdict、保留 id、候补 id 和 violations；
4. 若正常 finish 没有主推荐，复用现有追问/防重复收敛逻辑；
5. 调用 `assembleRecommendations`；
6. 发送 final 或 paused result。

当前 workflow 没有 Lead Agent loop，因此不新增伪 observation 重试。FinalGuard 拒绝后
复用既有追问或安全结束路径。若未来通过新技术决策启用其他 Agent 架构，必须重新定义
拒绝回填、重试上限和预算契约，不能把该能力视为当前待办。

## ResultAssembler 边界

`assembleRecommendations` 只接收 `FinalGuardResult`：

- 把 primary/backup candidate 映射为 `Restaurant`；
- 保留 Runtime 或 Agent 已提供的 explanation；
- 从候选已有 verification、warning 和授权事实生成机械性展示字段；
- 不读取 attempts 推断“扩搜”“兜底”“随机推荐”等策略；
- 不改变候选集合和顺序。

没有 explanation 时只使用中性的固定缺省文案，不根据运行历史重新解释决策。

## UI 发布边界

`restaurants` 与 `candidates` 是后端已经确定的两个分区。Reducer 可以做物理地点去重和
最大展示数量裁剪，但不能：

- 用候补补足 `MIN_TURNTABLE_OPTIONS`；
- 按品牌折叠不同门店；
- 改变 primary/backup 身份，包括把超出 UI 展示上限的 primary 重标为 backup。

候补加入转盘必须来自显式用户动作。

## 可观测性

每次对外返回主推荐或部分主推荐前记录 FinalGuard trace：

```ts
{
  type: 'guard_decision',
  input: { kind: 'final', selectedIds, candidateIds },
  output: {
    verdict,
    primaryIds,
    backupIds,
    violations
  }
}
```

该节点属于跨轮需要保留的决策 trace。最终 trace 继续记录实际发布 id，二者可以直接
比对，发现任何下游重新选择。

## 测试策略

### 单元测试

- `unverified` 永不进入 primary；
- proposed order 在过滤后保持；
- 未观察 id、重复 id、过期、硬失败、未授权 scope 的 verdict；
- proposal 之外的合法候选不自动补位；
- ResultAssembler 不导入 FinalGuard，不改变 guarded order；
- reducer 不用候补补足转盘，也不做品牌级折叠。

### Runtime 回归

- 正常完成、预算耗尽、clarification stalled 和 paused partial 都产生 guard trace；
- 没有主推荐时继续遵守追问和防重复逻辑；
- evaluation failure 仍显式失败或只返回已验证结果。

### 对抗性与变形测试

- 删除 evidence 后只能降级；
- 打乱 provider/candidate 输入，不改变显式 proposal 的相对顺序；
- 注入不存在 id，不能越权选择其他候选；
- 同品牌不同门店不被展示层静默合并；
- 未授权 broaden 和过期 goal version 不能进入主推荐。
- 清空候选已有 `hardFailures` 后，超出当前严格距离的餐厅仍被最终边界拒绝；严格约束
  缺少事实字段时只能进入候补。

## 发布与回滚

- 先运行 Agent 单测、完整测试、`npm run eval`、类型检查、lint 和生产构建。
- 生产验收检查 API 返回分区、FinalGuard trace、候补区和转盘行为。
- 若生产出现主推荐数量下降，这是严格边界生效的预期信号；不得以恢复自动补位作为
  回滚。只有出现合法 `passed` 候选被错误拒绝、运行失败或协议不兼容时才回滚代码。
