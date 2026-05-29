import { z } from 'zod';

function optionalArray<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((value) => value ?? [], z.array(schema));
}

export const SearchKeywordTargetSchema = z.object({
  keyword: z.string().min(1).max(30),
  poiTypes: z.array(z.string().regex(/^\d{6}$/)).max(5).optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  reason: z.string().max(120).optional(),
});

export const KeywordExpansionOutputSchema = z.object({
  relatedKeywords: z.array(z.string().min(1).max(30)).max(8).default([]),
  broadenedKeywords: z.array(z.string().min(1).max(30)).max(5).default([]),
  relatedTargets: optionalArray(SearchKeywordTargetSchema).pipe(z.array(SearchKeywordTargetSchema).max(8)),
  broadenedTargets: optionalArray(SearchKeywordTargetSchema).pipe(z.array(SearchKeywordTargetSchema).max(5)),
  rationale: z.string().min(1).max(240).default('根据用户目标生成搜索联想词。'),
});
