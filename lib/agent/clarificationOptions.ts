/**
 * 追问选项的协议层。
 *
 * 这里只放 id 与展示文案的对应关系，不放任何 effect 构造逻辑（那属于
 * policy.ts）。拆开的原因：id 是前后端共享的协议，改文案不能影响语义。
 *
 * 历史教训：选项语义曾经绑定在中文 label 上——前端硬编码「你推荐」、
 * 后端 policy 写「随便推荐」，`optionEffects[用户输入]` 精确匹配恒 miss，
 * 于是每次点击都回落到模型，模型一挂就变成死循环。
 */

import type { PendingQuestionOption } from './types';

export const CLARIFICATION_OPTION = {
  /** 授权开放推荐：兜底餐饮候选可进主推荐 */
  AUTHORIZE_FALLBACK_PRIMARY: 'authorize_fallback_primary',
  /** 授权放宽到相邻品类 */
  AUTHORIZE_CATEGORY_BROADEN: 'authorize_category_broaden',
  /** 扩大距离范围 */
  EXPAND_DISTANCE: 'expand_distance',
  /** 换个类型：无 effect，等待用户用自由文本描述新需求 */
  CHANGE_TARGET: 'change_target',
  /** 原样重跑本轮：不修改 goal，不改变会话模式 */
  RETRY_TURN: 'retry_turn',
} as const;

export type ClarificationOptionId =
  (typeof CLARIFICATION_OPTION)[keyof typeof CLARIFICATION_OPTION];

const CLARIFICATION_OPTION_LABEL: Record<ClarificationOptionId, string> = {
  [CLARIFICATION_OPTION.AUTHORIZE_FALLBACK_PRIMARY]: '随便推荐',
  [CLARIFICATION_OPTION.AUTHORIZE_CATEGORY_BROADEN]: '搜更广的品类',
  [CLARIFICATION_OPTION.EXPAND_DISTANCE]: '扩大范围',
  [CLARIFICATION_OPTION.CHANGE_TARGET]: '换个类型',
  [CLARIFICATION_OPTION.RETRY_TURN]: '重试',
};

/** 构造一个内置选项。label 仅用于展示，任何判断都必须走 id。 */
export function clarificationOption(id: ClarificationOptionId): PendingQuestionOption {
  return { id, label: CLARIFICATION_OPTION_LABEL[id] };
}

/**
 * 模型自行生成的选项 id。
 *
 * 由后端按顺序分配而不是让模型输出：模型编的 id 跨轮次不稳定，
 * 等于把协议的稳定性交回给模型。
 */
export function modelClarificationOptionId(index: number): string {
  return `opt_${index + 1}`;
}

/**
 * 追问指纹：用于判断"这一轮问的是不是上一轮那个问题"。
 *
 * 只取问题正文与选项 id 集合——label 改写不应该被当成"换了个问题"。
 */
export function buildQuestionFingerprint(question: {
  question: string;
  options?: PendingQuestionOption[];
}): string {
  const normalizedQuestion = question.question.replace(/\s+/g, '').trim();
  const optionIds = (question.options ?? [])
    .map((option) => option.id)
    .sort()
    .join(',');

  return `${normalizedQuestion}|${optionIds}`;
}
