import { z } from 'zod';

export const ConstraintKindSchema = z.enum([
  'distance',
  'avoid_spicy',
  'exclude_category',
  'budget',
  'open_now',
]);

export const ConstraintSchema = z.object({
  kind: ConstraintKindSchema,
  label: z.string().min(1).default('约束'),
  value: z.union([
    z.string(),
    z.number(),
    z.array(z.string()),
    z.object({
      min: z.number().optional(),
      max: z.number().optional(),
    }),
  ]).optional(),
  strict: z.boolean().optional(),
  maxMeters: z.number().optional(),
  values: z.array(z.string()).optional(),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const PreferenceSchema = z.object({
  name: z.string().min(1),
  weight: z.number().default(1),
  verifiable: z.boolean().default(false),
});

export const RequestedItemSchema = z.object({
  name: z.string().min(1),
  required: z.boolean().default(true),
  aliases: z.array(z.string()).default([]),
});

export const GoalCategorySchema = z.object({
  name: z.string().min(1),
  confidence: z.number().min(0).max(1).default(0.8),
});

export const SearchKeywordTargetSchema = z.object({
  keyword: z.string().min(1).max(30),
  poiTypes: z.array(z.string().regex(/^\d{6}$/)).max(5).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().max(120).optional(),
});

const ClarificationEffectTargetSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' ? name : value;
  }

  return value;
}, z.string().min(1));

const ClarificationEffectTargetListSchema = z.array(ClarificationEffectTargetSchema);

export const AlternativeGroupSchema = z.object({
  mode: z.enum(['any_of', 'all_of']),
  items: z.array(z.string().min(1)),
  minPerGroup: z.number().int().positive().optional(),
});

export const ClarificationEffectSchema = z.object({
  replaceRequestedItems: ClarificationEffectTargetListSchema.optional(),
  replaceCategories: ClarificationEffectTargetListSchema.optional(),
  replacePrimaryKeywords: ClarificationEffectTargetListSchema.optional(),
  addRequestedItems: ClarificationEffectTargetListSchema.optional(),
  addCategories: ClarificationEffectTargetListSchema.optional(),
  addSoftPreferences: z.array(PreferenceSchema).optional(),
  setDistanceMaxMeters: z.number().optional(),
  allowBroaden: z.boolean().optional(),
});

export const ClarificationOptionSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { label: value, value };
  }

  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record.label === 'string' && record.value === undefined) {
      return {
        ...record,
        value: record.label,
      };
    }
  }

  return value;
}, z.object({
  label: z.string().min(1),
  value: z.string().min(1),
  effect: ClarificationEffectSchema.optional(),
}));

const ClarificationOptionListSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  return Array.isArray(value) ? value : undefined;
}, z.array(z.unknown()).optional())
  .transform((items) => {
    if (!items) {
      return undefined;
    }

    const options = items.flatMap((item) => {
      const parsed = ClarificationOptionSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });

    return options.length > 0 ? options : undefined;
  });

export const ClarificationNeedSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { question: value };
  }

  return value;
}, z.object({
  reason: z.string().min(1).default('需要补充信息。'),
  question: z.string().min(1),
  options: ClarificationOptionListSchema,
  allowFreeText: z.boolean().default(true),
}));

const ClarificationNeedListSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [];
}, z.array(z.unknown()).default([]).catch([]))
  .transform((items) =>
    items.flatMap((item) => {
      const parsed = ClarificationNeedSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
  );

export const UserGoalSchema = z.object({
  intent: z.literal('find_restaurants'),
  rawQuery: z.string(),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  requestedItems: z.array(RequestedItemSchema).default([]),
  acceptableCategories: z.array(GoalCategorySchema).default([]),
  alternativeGroups: z.array(AlternativeGroupSchema).default([]),
  primaryKeywords: z.array(z.string()).default([]),
  relatedKeywords: z.array(z.string()).default([]),
  broadenedKeywords: z.array(z.string()).default([]),
  relatedTargets: z.array(SearchKeywordTargetSchema).default([]),
  broadenedTargets: z.array(SearchKeywordTargetSchema).default([]),
  hardConstraints: z.array(ConstraintSchema).default([]),
  softPreferences: z.array(PreferenceSchema).default([]),
  exclusions: z.array(z.string()).default([]),
  ambiguity: z.array(z.string()).default([]),
  clarificationNeeded: ClarificationNeedListSchema,
  allowBroaden: z.boolean().default(false),
});

export const GoalPatchSchema = z.object({
  replaceRequestedItems: z.array(RequestedItemSchema).optional(),
  replaceCategories: z.array(GoalCategorySchema).optional(),
  replacePrimaryKeywords: z.array(z.string()).optional(),
  addRequestedItems: z.array(RequestedItemSchema).optional(),
  addCategories: z.array(GoalCategorySchema).optional(),
  addSoftPreferences: z.array(PreferenceSchema).optional(),
  addConstraints: z.array(ConstraintSchema).optional(),
  removeConstraints: z.array(z.string()).optional(),
  allowBroaden: z.boolean().optional(),
  reason: z.string().min(1).default('SearchSupervisorAgent 更新目标。'),
});

export const AgentGoalDraftSchema = z.object({
  requestedItems: z.array(RequestedItemSchema).default([]),
  acceptableCategories: z.array(GoalCategorySchema).default([]),
  alternativeGroups: z.array(AlternativeGroupSchema).default([]),
  primaryKeywords: z.array(z.string().min(1)).default([]),
  relatedKeywords: z.array(z.string().min(1)).default([]),
  broadenedKeywords: z.array(z.string().min(1)).default([]),
  relatedTargets: z.array(SearchKeywordTargetSchema).default([]),
  broadenedTargets: z.array(SearchKeywordTargetSchema).default([]),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  softPreferences: z.array(PreferenceSchema).default([]),
  ambiguity: z.array(z.string()).default([]),
  clarificationNeeded: ClarificationNeedListSchema,
  allowBroaden: z.boolean().default(false),
});
