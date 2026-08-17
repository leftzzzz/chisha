import { z } from 'zod';
import { SearchActionSchema } from './searchAction';

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

export const SearchPlanSchema = z.object({
  // 一次搜索只表达一个餐饮意图（见 AGENTS.md 的高德 POI 搜索规则）。
  // 约束前移到 schema，Runtime 不再事后拆词。
  keywords: requiredArray(z.string().min(1)).pipe(z.array(z.string().min(1)).length(1)),
  radiusMeters: intNumberSchema(300, 5000),
  poiType: z.string().regex(/^\d{6}(?:\|\d{6})*$/).optional(),
  searchIntent: SearchIntentSchema,
  allowedForPrimary: BooleanSchema,
  reason: reasonWithDefault('根据用户目标搜索。'),
  planId: z.string().optional(),
  searchAction: SearchActionSchema.optional(),
});
