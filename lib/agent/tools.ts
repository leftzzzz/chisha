import { tool } from 'ai';
import { z } from 'zod';
import type { FinishRecommendation, PendingQuestion } from './types';

/**
 * @deprecated Runtime V3 no longer uses AI SDK tool calling directly. Keep
 * these schemas only for migration/reference tests until the old tool loop is
 * removed.
 */

const LocationSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  address: z.string().optional(),
});

export const RestaurantSchema = z.object({
  id: z.string(),
  name: z.string(),
  cuisineType: z.string(),
  rating: z.number().optional(),
  distance: z.number().optional(),
  address: z.string(),
  phone: z.string().optional(),
  openingHours: z.string().optional(),
  averagePrice: z.number().optional(),
  location: LocationSchema,
  source: z.enum(['amap', 'osm']),
});

export const SearchRestaurantsInputSchema = z.object({
  keywords: z.array(z.string().min(1)).min(1).max(5),
  radiusMeters: z.number().int().min(300).max(5000),
  poiType: z.string().regex(/^\d{6}(?:\|\d{6})*$/).optional(),
  searchIntent: z.enum(['exact', 'synonym', 'broadened', 'fallback']),
  allowedForPrimary: z.boolean().default(false),
  reason: z.string().min(1).max(120),
});

export const SearchRestaurantsOutputSchema = z.object({
  source: z.literal('amap'),
  query: z.object({
    keywords: z.array(z.string()),
    radiusMeters: z.number(),
    poiType: z.string().optional(),
    searchIntent: z.enum(['exact', 'synonym', 'broadened', 'fallback']),
    allowedForPrimary: z.boolean(),
  }),
  restaurants: z.array(RestaurantSchema),
  providerMeta: z.object({
    rawCount: z.number(),
    truncated: z.boolean(),
  }),
});

export const FinishRecommendationInputSchema = z.object({
  selectedIds: z.array(z.string()).min(1).max(8),
  candidateIds: z.array(z.string()).max(20).default([]),
  explanation: z.string().min(1).max(300),
  unmetConstraints: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});

export const AskUserInputSchema = z.object({
  reason: z.string().min(1).max(200),
  question: z.string().min(1).max(120),
  options: z.array(z.object({
    label: z.string().min(1).max(20),
    value: z.string().min(1).max(80),
    effect: z.object({
      replaceRequestedItems: z.array(z.string()).default([]),
      replaceCategories: z.array(z.string()).default([]),
      replacePrimaryKeywords: z.array(z.string()).default([]),
      addRequestedItems: z.array(z.string()).default([]),
      addCategories: z.array(z.string()).default([]),
      setDistanceMaxMeters: z.number().optional(),
      allowBroaden: z.boolean().optional(),
    }).optional(),
  })).min(2).max(4).optional(),
  allowFreeText: z.boolean().default(true),
});

export type SearchRestaurantsInput = z.infer<typeof SearchRestaurantsInputSchema>;
export type SearchRestaurantsOutput = z.infer<typeof SearchRestaurantsOutputSchema>;
export type AskUserInput = z.infer<typeof AskUserInputSchema>;

interface AgentToolExecutors {
  searchRestaurants: (input: SearchRestaurantsInput) => Promise<SearchRestaurantsOutput>;
  askUser?: (input: AskUserInput) => Promise<PendingQuestion> | PendingQuestion;
  finishRecommendation?: (input: FinishRecommendation) => Promise<FinishRecommendation> | FinishRecommendation;
}

export function createAgentTools(executors: AgentToolExecutors) {
  return {
    search_restaurants: tool({
      description: '搜索当前位置附近的餐饮 POI。用于观察外部世界，不负责最终筛选。',
      inputSchema: SearchRestaurantsInputSchema,
      outputSchema: SearchRestaurantsOutputSchema,
      execute: executors.searchRestaurants,
    }),
    ask_user: tool({
      description: '当需求不足、硬约束冲突、搜索结果无法满足目标时，向用户提出一个澄清问题并暂停会话。',
      inputSchema: AskUserInputSchema,
      execute: async (input) => {
        const question: PendingQuestion = {
          reason: input.reason,
          question: input.question,
          options: input.options?.map((option) => option.label),
          allowFreeText: input.allowFreeText,
          optionEffects: input.options
            ? Object.fromEntries(
                input.options
                  .filter((option) => option.effect)
                  .map((option) => [option.label, option.effect!])
              )
            : undefined,
        };

        return executors.askUser?.(input) ?? question;
      },
    }),
    finish_recommendation: tool({
      description: '当已经有足够候选，提交最终推荐意图。Runtime 会再次校验和排序。',
      inputSchema: FinishRecommendationInputSchema,
      execute: async (input) => {
        const recommendation: FinishRecommendation = {
          selectedIds: input.selectedIds,
          candidateIds: input.candidateIds,
          explanation: input.explanation,
          unmetConstraints: input.unmetConstraints,
          confidence: input.confidence,
        };

        return executors.finishRecommendation?.(recommendation) ?? recommendation;
      },
    }),
  };
}
