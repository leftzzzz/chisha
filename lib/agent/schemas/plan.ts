import { z } from 'zod';

function defaultArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }, z.array(schema).default([]).catch([]));
}

function requiredArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    return Array.isArray(value) ? value : [value];
  }, z.array(schema));
}

const BooleanSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean());

function intNumberSchema(min: number, max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return value;
  }, z.coerce.number().int().min(min).max(max));
}

function reasonWithDefault(defaultValue: string) {
  return z.preprocess((value) => {
    return typeof value === 'string' ? value : undefined;
  }, z.string().min(1).max(240).default(defaultValue).catch(defaultValue));
}

export const SearchTargetSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return {
      label: value,
      kind: 'generic',
      strictness: 'exact',
    };
  }

  return value;
}, z.object({
  label: z.string().min(1).max(40),
  kind: z.enum(['dish', 'cuisine', 'restaurant_type', 'generic']),
  strictness: z.enum(['exact', 'compatible', 'broad']),
}));

export const SearchIntentSchema = z.enum(['exact', 'synonym', 'broadened', 'fallback']);

export const PlanningAgentPlanSchema = z.object({
  targets: requiredArray(SearchTargetSchema).pipe(z.array(SearchTargetSchema).min(1).max(5)),
  radiusMeters: intNumberSchema(100, 50000),
  searchIntent: SearchIntentSchema,
  allowedForPrimary: BooleanSchema,
  reason: reasonWithDefault('根据用户目标规划搜索。'),
});

export const PlanningAgentOutputSchema = z.object({
  plans: defaultArray(PlanningAgentPlanSchema).pipe(z.array(PlanningAgentPlanSchema).max(5)),
});

export const SearchPlanSchema = z.object({
  keywords: requiredArray(z.string().min(1)).pipe(z.array(z.string().min(1)).min(1).max(5)),
  radiusMeters: intNumberSchema(300, 5000),
  poiType: z.string().regex(/^\d{6}(?:\|\d{6})*$/).optional(),
  searchIntent: SearchIntentSchema,
  allowedForPrimary: BooleanSchema,
  reason: reasonWithDefault('根据用户目标搜索。'),
});
