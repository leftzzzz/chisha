import { z } from 'zod';
import { ClarificationEffectSchema, GoalPatchSchema, UserGoalSchema } from './goal';
import { modelClarificationOptionId } from '../clarificationOptions';

const DEFAULT_PENDING_QUESTION = '你想找哪类餐厅，或具体想吃什么？';

const PendingQuestionTextSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return DEFAULT_PENDING_QUESTION;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_PENDING_QUESTION;
}, z.string().min(1).max(160)).catch(DEFAULT_PENDING_QUESTION);

const PendingQuestionReasonSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().min(1).max(240)).optional().catch(undefined);

const PendingQuestionOptionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(32),
});

/**
 * 上限取 5 而不是 4。
 *
 * 线上实测模型会给「火锅/日料/川菜/西餐/随便你推荐」这样 5 个选项，
 * 而"随便你推荐"恰恰排在最后——按 4 截断会把最有用的出口截掉。
 */
const MAX_CLARIFICATION_OPTIONS = 5;

const PendingQuestionOptionsSchema = z
  .array(PendingQuestionOptionSchema)
  .min(2)
  .max(MAX_CLARIFICATION_OPTIONS)
  .optional()
  .catch(undefined);

const OptionalBooleanSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean()).default(true).catch(true);

const OptionEffectsSchema = z.preprocess((value) => {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}, z.record(ClarificationEffectSchema)).optional();

interface NormalizedOption {
  id: string;
  label: string;
  /** 归一化之前该选项在 optionEffects 里的 key（label 或 value）。 */
  sourceKey?: string;
}

/**
 * 把任意来源的选项归一化成 `{id,label}`。
 *
 * 三种来源都走这里：
 * - 模型输出（`options: string[]` + 以文案为 key 的 optionEffects）
 * - 旧会话反序列化出来的字符串数组
 * - policy 构造的、已经带 id 的对象
 *
 * 没有 id 的一律由后端按序号分配，**绝不让模型自己编 id**——模型给的 id
 * 跨轮次不稳定，等于把协议的稳定性交回给模型。
 */
function normalizeOptions(value: unknown): NormalizedOption[] {
  if (value === undefined || value === null) {
    return [];
  }

  const items = Array.isArray(value) ? value : [value];

  return items.flatMap((item, index): NormalizedOption[] => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? [{ id: modelClarificationOptionId(index), label, sourceKey: label }] : [];
    }

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const label = typeof record.label === 'string' && record.label.trim()
        ? record.label.trim()
        : typeof record.value === 'string' ? record.value.trim() : '';

      if (!label) {
        return [];
      }

      const id = typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : modelClarificationOptionId(index);
      const sourceKey = typeof record.value === 'string' && record.value.trim()
        ? record.value.trim()
        : label;

      return [{ id, label, sourceKey }];
    }

    return [];
  });
}

/**
 * 把 optionEffects 的 key 从原始文案改写成选项 id。
 *
 * 旧会话与模型输出都以文案为 key；协议改成 id 之后必须在入口一次性搬迁，
 * 否则 `optionEffects[optionId]` 永远查不到。
 */
function remapOptionEffects(
  effects: Record<string, unknown> | undefined,
  options: NormalizedOption[]
): Record<string, unknown> | undefined {
  if (!effects) {
    return undefined;
  }

  const remapped: Record<string, unknown> = {};

  for (const option of options) {
    if (Object.prototype.hasOwnProperty.call(effects, option.id)) {
      remapped[option.id] = effects[option.id];
      continue;
    }

    if (option.sourceKey && Object.prototype.hasOwnProperty.call(effects, option.sourceKey)) {
      remapped[option.id] = effects[option.sourceKey];
    }
  }

  // 没有对应选项的 effect（脏数据 / 选项被裁剪）直接丢弃：留着也永远查不到。
  return Object.keys(remapped).length > 0 ? remapped : undefined;
}

export const PendingQuestionSchema = z.preprocess((value) => {
  const raw = typeof value === 'string' ? { question: value } : value;
  if (!raw || typeof raw !== 'object') {
    return raw;
  }

  const record = raw as Record<string, unknown>;
  const options = normalizeOptions(record.options);
  const usableOptions = options.length >= 2
    ? options.slice(0, MAX_CLARIFICATION_OPTIONS)
    : [];

  return {
    ...record,
    options: usableOptions.length > 0
      ? usableOptions.map((option) => ({ id: option.id, label: option.label }))
      : undefined,
    optionEffects: remapOptionEffects(
      record.optionEffects as Record<string, unknown> | undefined,
      usableOptions
    ),
  };
}, z.object({
  reason: PendingQuestionReasonSchema,
  question: PendingQuestionTextSchema,
  options: PendingQuestionOptionsSchema,
  allowFreeText: OptionalBooleanSchema,
  optionEffects: OptionEffectsSchema,
}).transform((question) => ({
  ...(question.reason ? { reason: question.reason } : {}),
  question: question.question,
  ...(question.options ? { options: question.options } : {}),
  allowFreeText: question.allowFreeText,
  ...(question.optionEffects ? { optionEffects: question.optionEffects } : {}),
})));

/**
 * 会话反序列化时的追问归一化。
 *
 * 旧会话（version 3）存的是 `options: string[]` 与以文案为 key 的
 * optionEffects，读出来必须先升级成 id 协议再使用。
 *
 * @deprecated 仅为兼容 version 3 会话，TTL（30 分钟）过后可随 version 4
 * 全量生效一并删除。
 */
export function normalizeStoredPendingQuestion(value: unknown): unknown {
  if (!value) {
    return undefined;
  }

  const parsed = PendingQuestionSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/**
 * GoalUnderstandingModel 的输出。
 *
 * 刻意不含 `nextAction`：下一步做什么由 orchestrator/policy 决定，
 * 模型角色 说了不算。历史上它输出过该字段，但全仓没有任何消费点。
 */
export const GoalUnderstandingOutputSchema = z.object({
  goal: UserGoalSchema.optional(),
  patch: GoalPatchSchema.optional(),
  question: PendingQuestionSchema.optional(),
  conversationMode: z.enum([
    'continue_current_goal',
    'patch_current_goal',
    'start_new_goal',
  ]).optional(),
});
