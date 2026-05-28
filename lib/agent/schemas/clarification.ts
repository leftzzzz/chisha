import { z } from 'zod';
import { ClarificationEffectSchema, GoalPatchSchema, UserGoalSchema } from './goal';

export const PendingQuestionSchema = z.object({
  reason: z.string().min(1).max(240).optional(),
  question: z.string().min(1).max(160),
  options: z.array(z.string().min(1).max(32)).min(2).max(4).optional(),
  allowFreeText: z.boolean().optional(),
  optionEffects: z.record(ClarificationEffectSchema).optional(),
});

export const SearchSupervisorOutputSchema = z.object({
  goal: UserGoalSchema.optional(),
  patch: GoalPatchSchema.optional(),
  question: PendingQuestionSchema.optional(),
  nextAction: z.enum(['plan', 'ask_user', 'finish']).optional(),
});
