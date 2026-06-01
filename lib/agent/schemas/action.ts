import { z } from 'zod';
import { PendingQuestionSchema } from './clarification';
import { SearchPlanSchema } from './plan';

const OptionalStringArraySchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}, z.array(z.string())).optional().catch(undefined);

const ConfidenceSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}, z.coerce.number().min(0).max(1)).default(0.6).catch(0.6);

const ExplanationSchema = z.preprocess((value) => {
  return typeof value === 'string' ? value : undefined;
}, z.string().min(1).max(500).default('已完成当前推荐。').catch('已完成当前推荐。'));

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
    selectedIds: OptionalStringArraySchema.pipe(z.array(z.string()).max(8).optional()),
    candidateIds: OptionalStringArraySchema.pipe(z.array(z.string()).max(20).optional()),
    explanation: ExplanationSchema,
    confidence: ConfidenceSchema,
  }),
]);
