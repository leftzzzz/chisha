import { z } from 'zod';
import { PendingQuestionSchema } from './clarification';
import { SearchPlanSchema } from './plan';

export const AgentActionSchema = z.union([
  z.object({
    type: z.literal('search'),
    plan: SearchPlanSchema,
  }),
  z.object({
    type: z.literal('ask_user'),
    question: PendingQuestionSchema,
  }),
  z.object({
    type: z.literal('finish'),
    selectedIds: z.array(z.string()).max(8).optional(),
    candidateIds: z.array(z.string()).max(20).optional(),
    explanation: z.string().min(1).max(500).default('已完成当前推荐。'),
    confidence: z.number().min(0).max(1).default(0.6),
  }),
]);
