import { z } from 'zod';
import { ClarificationEffectSchema, GoalPatchSchema, UserGoalSchema } from './goal';

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

const PendingQuestionOptionsSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  const options = values.flatMap((item) => {
    if (typeof item === 'string') {
      return [item];
    }

    if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      if (typeof record.label === 'string') {
        return [record.label];
      }
      if (typeof record.value === 'string') {
        return [record.value];
      }
    }

    return [];
  });

  return options.length >= 2 ? options : undefined;
}, z.array(z.string().min(1).max(32)).min(2).max(4)).optional().catch(undefined);

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
}, z.record(ClarificationEffectSchema)).optional().catch(undefined);

export const PendingQuestionSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { question: value };
  }

  return value;
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

export const SearchSupervisorOutputSchema = z.object({
  goal: UserGoalSchema.optional(),
  patch: GoalPatchSchema.optional(),
  question: PendingQuestionSchema.optional(),
  conversationMode: z.enum([
    'continue_current_goal',
    'patch_current_goal',
    'start_new_goal',
  ]).optional(),
  nextAction: z.enum(['plan', 'ask_user', 'finish']).optional(),
});
