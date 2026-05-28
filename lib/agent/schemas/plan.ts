import { z } from 'zod';

export const SearchTargetSchema = z.object({
  label: z.string().min(1).max(40),
  kind: z.enum(['dish', 'cuisine', 'restaurant_type', 'generic']),
  strictness: z.enum(['exact', 'compatible', 'broad']),
});

export const SearchIntentSchema = z.enum(['exact', 'synonym', 'broadened', 'fallback']);

export const PlanningAgentPlanSchema = z.object({
  targets: z.array(SearchTargetSchema).min(1).max(5),
  radiusMeters: z.number().int().min(100).max(50000),
  searchIntent: SearchIntentSchema,
  allowedForPrimary: z.boolean(),
  reason: z.string().min(1).max(240).default('根据用户目标规划搜索。'),
});

export const PlanningAgentOutputSchema = z.object({
  plans: z.array(PlanningAgentPlanSchema).max(5).default([]),
});

export const SearchPlanSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(5),
  radiusMeters: z.number().int().min(300).max(5000),
  poiType: z.string().regex(/^\d{6}(?:\|\d{6})*$/).optional(),
  searchIntent: SearchIntentSchema,
  allowedForPrimary: z.boolean(),
  reason: z.string().min(1).max(240).default('根据用户目标搜索。'),
});
