import { z } from 'zod';

const NumericConfidenceSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}, z.coerce.number().min(0).max(1).default(0.5).catch(0.5));

const BooleanDefaultFalseSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean().default(false).catch(false));

const StringArraySchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return [];
  }

  if (typeof value === 'string') {
    return [value];
  }

  return value;
}, z.array(z.string()).default([]).catch([]));

export const TargetEvidenceSchema = z.object({
  target: z.string().trim().min(1),
  kind: z.enum(['item', 'category']),
  references: z.array(z.object({
    restaurantId: z.string().min(1),
    field: z.enum(['name', 'cuisineType']),
    value: z.string().min(1),
  })).min(1),
  observationRef: z.string().min(1).optional().catch(undefined),
});

export const CandidateVerdictSchema = z.preprocess((value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (record.restaurantId === undefined && typeof record.id === 'string') {
      return {
        ...record,
        restaurantId: record.id,
      };
    }
  }

  return value;
}, z.object({
  restaurantId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'unverified']).default('unverified').catch('unverified'),
  primaryEligible: BooleanDefaultFalseSchema,
  confidence: NumericConfidenceSchema,
  matchedItems: StringArraySchema,
  matchedCategories: StringArraySchema,
  targetEvidence: z.array(TargetEvidenceSchema).optional().catch(undefined),
  conflicts: StringArraySchema,
  evidence: StringArraySchema,
  warnings: StringArraySchema,
}));

const VerdictListSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return [];
  }

  return value;
}, z.array(z.unknown()).default([]).catch([]))
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = CandidateVerdictSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );

const ExplanationSchema = z.preprocess((value) => {
  return typeof value === 'string' ? value : undefined;
}, z.string().min(1).max(500).default('已完成候选评估。').catch('已完成候选评估。'));

export const EvaluationModelOutputSchema = z.object({
  verdicts: VerdictListSchema,
  selectedIds: StringArraySchema,
  candidateIds: StringArraySchema,
  explanation: ExplanationSchema,
  unmetConstraints: StringArraySchema,
  source: z.enum(['model', 'cache', 'error']).optional(),
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }).optional(),
});
