import { z } from 'zod';

function defaultArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => {
    if (value === undefined || value === null) {
      return [];
    }

    return Array.isArray(value) ? value : [value];
  }, z.array(schema).default([]).catch([]));
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

const OptionalStringSchema = z.preprocess((value) => {
  return typeof value === 'string' ? value : undefined;
}, z.string()).optional().catch(undefined);

const ConfidenceSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return value;
}, z.coerce.number().min(0).max(1)).default(0.5).catch(0.5);

const RationaleSchema = z.preprocess((value) => {
  return typeof value === 'string' ? value : undefined;
}, z.string().min(1).max(240).default('根据用户目标生成搜索联想词。').catch('根据用户目标生成搜索联想词。'));

export const SearchKeywordTargetSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { keyword: value };
  }

  return value;
}, z.object({
  keyword: z.string().min(1).max(30),
  poiTypes: OptionalPoiTypeArraySchema,
  confidence: ConfidenceSchema,
  reason: OptionalStringSchema.pipe(z.string().max(120).optional()),
}));

export const KeywordExpansionOutputSchema = z.object({
  relatedKeywords: defaultArray(z.string().min(1).max(30)).pipe(z.array(z.string().min(1).max(30)).max(8)),
  broadenedKeywords: defaultArray(z.string().min(1).max(30)).pipe(z.array(z.string().min(1).max(30)).max(5)),
  relatedTargets: defaultArray(SearchKeywordTargetSchema).pipe(z.array(SearchKeywordTargetSchema).max(8)),
  broadenedTargets: defaultArray(SearchKeywordTargetSchema).pipe(z.array(SearchKeywordTargetSchema).max(5)),
  rationale: RationaleSchema,
});
