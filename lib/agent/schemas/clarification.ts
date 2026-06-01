import { z } from 'zod';
import { ClarificationEffectSchema, GoalPatchSchema, UserGoalSchema } from './goal';

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
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean()).optional().catch(undefined);

const OptionEffectsSchema = z.preprocess((value) => {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}, z.record(ClarificationEffectSchema)).optional().catch(undefined);

export const PendingQuestionSchema = z.object({
  reason: z.string().min(1).max(240).optional(),
  question: z.string().min(1).max(160),
  options: PendingQuestionOptionsSchema,
  allowFreeText: OptionalBooleanSchema,
  optionEffects: OptionEffectsSchema,
});

export const SearchSupervisorOutputSchema = z.object({
  goal: UserGoalSchema.optional(),
  patch: GoalPatchSchema.optional(),
  question: PendingQuestionSchema.optional(),
  nextAction: z.enum(['plan', 'ask_user', 'finish']).optional(),
});
