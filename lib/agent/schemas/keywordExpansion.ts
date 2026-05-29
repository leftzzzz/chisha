import { z } from 'zod';

export const KeywordExpansionOutputSchema = z.object({
  relatedKeywords: z.array(z.string().min(1).max(30)).max(3).default([]),
  broadenedKeywords: z.array(z.string().min(1).max(30)).max(3).default([]),
  rationale: z.string().min(1).max(240).default('根据用户目标生成搜索联想词。'),
});
