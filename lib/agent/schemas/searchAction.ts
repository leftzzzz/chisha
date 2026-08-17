import { z } from 'zod';

export const SearchRelationSchema = z.enum([
  'exact',
  'equivalent',
  'broader',
  'alternative',
]);

export const SearchActionInputSchema = z.object({
  query: z.string().trim().min(1).max(120),
  supportsGoalIds: z.array(z.string().min(1)).max(8),
  relation: SearchRelationSchema,
  rationale: z.string().trim().min(1).max(500),
  authorizationRef: z.string().min(1).optional(),
});

export const SearchActionSchema = SearchActionInputSchema.extend({
  id: z.string().min(1),
});
