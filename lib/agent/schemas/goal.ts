import { z } from 'zod';

export const ConstraintKindSchema = z.enum([
  'distance',
  'avoid_spicy',
  'exclude_category',
  'budget',
  'open_now',
]);

export const SearchIntentSchema = z.enum(['exact', 'synonym', 'broadened', 'fallback']);

export const AuthorizationScopeKindSchema = z.enum([
  'distance_expansion',
  'category_broaden',
  'fallback_primary',
  'unverified_backup_only',
]);

function defaultArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }, z.array(schema).default([]).catch([]));
}

function optionalArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return undefined;
    }

    return Array.isArray(value) ? value : [value];
  }, z.array(schema)).optional().catch(undefined);
}

const OptionalStringArraySchema = optionalArray(z.string());
const DefaultStringArraySchema = defaultArray(z.string());

const OptionalStringSchema = z.preprocess((value) => {
  return typeof value === 'string' ? value : undefined;
}, z.string()).optional().catch(undefined);

const OptionalBooleanSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }

  return value;
}, z.boolean()).optional().catch(undefined);

function booleanWithDefault(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }

    return value;
  }, z.boolean()).default(defaultValue).catch(defaultValue);
}

const OptionalNumberSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}, z.coerce.number()).optional().catch(undefined);

function numberWithDefault(defaultValue: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return value;
  }, z.coerce.number()).default(defaultValue).catch(defaultValue);
}

function boundedNumberWithDefault(defaultValue: number, min: number, max: number) {
  return z.preprocess((value) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return value;
  }, z.coerce.number().min(min).max(max)).default(defaultValue).catch(defaultValue);
}

function stringWithDefault(defaultValue: string) {
  return z.preprocess((value) => {
    return typeof value === 'string' ? value : undefined;
  }, z.string().min(1).default(defaultValue).catch(defaultValue));
}

const OptionalPoiTypeArraySchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((item) =>
    typeof item === 'string'
      ? item.split('|').map((code) => code.trim()).filter(Boolean)
      : item
  );
}, z.array(z.string().regex(/^\d{6}$/)).max(5)).optional().catch(undefined);

const ConstraintRangeSchema = z.object({
  min: OptionalNumberSchema,
  max: OptionalNumberSchema,
});

export const ConstraintSchema = z.object({
  kind: ConstraintKindSchema,
  label: z.string().min(1).default('约束'),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    ConstraintRangeSchema,
  ]).optional(),
  strict: OptionalBooleanSchema,
  maxMeters: OptionalNumberSchema,
  values: OptionalStringArraySchema,
  min: OptionalNumberSchema,
  max: OptionalNumberSchema,
});

export const PreferenceSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { name: value };
  }

  return value;
}, z.object({
  name: z.string().min(1),
  weight: numberWithDefault(1),
  verifiable: booleanWithDefault(false),
}));

export const RequestedItemSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { name: value };
  }

  return value;
}, z.object({
  name: z.string().min(1),
  required: booleanWithDefault(true),
  aliases: DefaultStringArraySchema,
}));

export const GoalCategorySchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { name: value };
  }

  return value;
}, z.object({
  name: z.string().min(1),
  confidence: boundedNumberWithDefault(0.8, 0, 1),
}));

export const SearchKeywordTargetSchema = z.object({
  keyword: z.string().min(1).max(30),
  poiTypes: OptionalPoiTypeArraySchema,
  confidence: boundedNumberWithDefault(0.5, 0, 1),
  reason: OptionalStringSchema.pipe(z.string().max(120).optional()),
});

const AuthorizationConstraintsSchema = z.object({
  maxMeters: OptionalNumberSchema,
  allowedSearchIntents: optionalArray(SearchIntentSchema),
  allowedKeywords: OptionalStringArraySchema,
});

export const AgentAuthorizationSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  const record = value as Record<string, unknown>;
  const kind = typeof record.kind === 'string' ? record.kind : 'category_broaden';
  return {
    ...record,
    id: typeof record.id === 'string' && record.id.trim()
      ? record.id
      : `auth_${kind}_${Date.now().toString(36)}`,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
    reason: typeof record.reason === 'string' && record.reason.trim()
      ? record.reason
      : '用户授权调整推荐范围。',
  };
}, z.object({
  id: z.string().min(1),
  kind: AuthorizationScopeKindSchema,
  createdAt: z.number(),
  sourceQuestionId: OptionalStringSchema,
  reason: z.string().min(1),
  constraints: AuthorizationConstraintsSchema.optional(),
}));

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

const ClarificationEffectTargetListSchema = optionalArray(ClarificationEffectTargetSchema);

export const AlternativeGroupSchema = z.object({
  mode: z.enum(['any_of', 'all_of']),
  items: defaultArray(z.string().min(1)),
  minPerGroup: OptionalNumberSchema,
});

export const ClarificationEffectSchema = z.object({
  replaceRequestedItems: ClarificationEffectTargetListSchema,
  replaceCategories: ClarificationEffectTargetListSchema,
  replacePrimaryKeywords: ClarificationEffectTargetListSchema,
  addRequestedItems: ClarificationEffectTargetListSchema,
  addCategories: ClarificationEffectTargetListSchema,
  addSoftPreferences: optionalArray(PreferenceSchema),
  setDistanceMaxMeters: OptionalNumberSchema,
  addAuthorizations: optionalArray(AgentAuthorizationSchema),
  allowBroaden: OptionalBooleanSchema,
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
  allowFreeText: booleanWithDefault(true),
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
  goalId: z.string().min(1).optional(),
  goalVersion: OptionalNumberSchema,
  goalSignature: z.string().min(1).optional(),
  rawQuery: z.string(),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  requestedItems: defaultArray(RequestedItemSchema),
  acceptableCategories: defaultArray(GoalCategorySchema),
  alternativeGroups: defaultArray(AlternativeGroupSchema),
  primaryKeywords: DefaultStringArraySchema,
  relatedKeywords: DefaultStringArraySchema,
  broadenedKeywords: DefaultStringArraySchema,
  relatedTargets: defaultArray(SearchKeywordTargetSchema),
  broadenedTargets: defaultArray(SearchKeywordTargetSchema),
  hardConstraints: defaultArray(ConstraintSchema),
  softPreferences: defaultArray(PreferenceSchema),
  exclusions: DefaultStringArraySchema,
  ambiguity: DefaultStringArraySchema,
  clarificationNeeded: ClarificationNeedListSchema,
  authorizations: defaultArray(AgentAuthorizationSchema),
  allowBroaden: booleanWithDefault(false),
});

export const GoalPatchSchema = z.object({
  replaceRequestedItems: optionalArray(RequestedItemSchema),
  replaceCategories: optionalArray(GoalCategorySchema),
  replacePrimaryKeywords: OptionalStringArraySchema,
  addRequestedItems: optionalArray(RequestedItemSchema),
  addCategories: optionalArray(GoalCategorySchema),
  addSoftPreferences: optionalArray(PreferenceSchema),
  addConstraints: optionalArray(ConstraintSchema),
  removeConstraints: OptionalStringArraySchema,
  addAuthorizations: optionalArray(AgentAuthorizationSchema),
  allowBroaden: OptionalBooleanSchema,
  reason: stringWithDefault('SupervisorPlannerAgent 更新目标。'),
});

export const AgentGoalDraftSchema = z.object({
  requestedItems: defaultArray(RequestedItemSchema),
  acceptableCategories: defaultArray(GoalCategorySchema),
  alternativeGroups: defaultArray(AlternativeGroupSchema),
  primaryKeywords: defaultArray(z.string().min(1)),
  relatedKeywords: defaultArray(z.string().min(1)),
  broadenedKeywords: defaultArray(z.string().min(1)),
  relatedTargets: defaultArray(SearchKeywordTargetSchema),
  broadenedTargets: defaultArray(SearchKeywordTargetSchema),
  poiType: z.string().regex(/^\d{6}$/).optional(),
  softPreferences: defaultArray(PreferenceSchema),
  ambiguity: DefaultStringArraySchema,
  clarificationNeeded: ClarificationNeedListSchema,
  authorizations: defaultArray(AgentAuthorizationSchema),
  allowBroaden: booleanWithDefault(false),
});
