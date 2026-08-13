/**
 * Finish 原因与用户文案的唯一映射。
 *
 * Runtime / Planner 内部只传枚举，用户可见文案在出口一次性生成，
 * 避免用中文字符串做 map key 时出现漏映射（内部术语泄漏到 UI）。
 */

export type FinishReason =
  /** 模型自主决定结束，使用模型给出的 explanation */
  | 'MODEL_DECIDED'
  /** 已有足够通过准入的主推荐 */
  | 'ENOUGH_PRIMARY'
  /** 本轮搜索次数耗尽 */
  | 'SEARCH_BUDGET_EXHAUSTED'
  /** 本轮 action 次数耗尽 */
  | 'ACTION_BUDGET_EXHAUSTED'
  /** Guard 拒绝继续执行动作 */
  | 'GUARD_REJECTED'
  /** 没有更多可尝试的搜索策略 */
  | 'NO_MORE_STRATEGY'
  /** 用户授权放宽后，把上一轮候补提升为主推荐 */
  | 'BROADEN_PROMOTION';

const FINISH_TEXT: Record<FinishReason, string> = {
  MODEL_DECIDED: '',
  ENOUGH_PRIMARY: '已为您找到合适的餐厅，以下是推荐结果。',
  SEARCH_BUDGET_EXHAUSTED: '已为您搜索附近多个方向，以下是精选推荐。',
  ACTION_BUDGET_EXHAUSTED: '已为您完成全面搜索，以下是最佳推荐。',
  GUARD_REJECTED: '已为您找到合适餐厅，以下是推荐结果。',
  NO_MORE_STRATEGY: '已为您搜索多个方向，以下是精选推荐。',
  BROADEN_PROMOTION: '已根据您的要求扩大搜索范围，以下是推荐结果。',
};

/**
 * 内部构造 finish 时写入 explanation 的技术说明。
 *
 * 这些文本只用于 trace / 日志排障，不会展示给用户。
 */
const FINISH_INTERNAL_NOTE: Record<FinishReason, string> = {
  MODEL_DECIDED: 'Model decided to finish.',
  ENOUGH_PRIMARY: 'Enough primary candidates passed admission.',
  SEARCH_BUDGET_EXHAUSTED: 'Search budget exhausted.',
  ACTION_BUDGET_EXHAUSTED: 'Action budget exhausted.',
  GUARD_REJECTED: 'Guard rejected the next action.',
  NO_MORE_STRATEGY: 'No further verifiable search strategy.',
  BROADEN_PROMOTION: 'Promoted broadened candidates after user authorization.',
};

/**
 * 生成用户可见的结束说明。
 *
 * @param reason - 结束原因，缺省按 MODEL_DECIDED 处理
 * @param modelExplanation - 模型给出的自然语言说明，仅 MODEL_DECIDED 时使用
 */
export function describeFinish(
  reason: FinishReason | undefined,
  modelExplanation?: string
): string {
  const preset = FINISH_TEXT[reason ?? 'MODEL_DECIDED'];
  if (preset) {
    return preset;
  }

  const trimmed = modelExplanation?.trim();
  return trimmed || FINISH_TEXT.ENOUGH_PRIMARY;
}

/**
 * 内部 finish 的 explanation 文案（进 trace，不进 UI）。
 */
export function internalFinishNote(reason: FinishReason): string {
  return FINISH_INTERNAL_NOTE[reason];
}

export const FINISH_REASONS = Object.keys(FINISH_TEXT) as FinishReason[];
