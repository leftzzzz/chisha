import { z } from 'zod';

export const CandidateVerdictSchema = z.object({
  restaurantId: z.string().min(1),
  status: z.enum(['passed', 'failed', 'unverified']),
  primaryEligible: z.boolean(),
  confidence: z.number().min(0).max(1),
  matchedItems: z.array(z.string()).default([]),
  matchedCategories: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export const EvaluationAgentOutputSchema = z.object({
  verdicts: z.array(CandidateVerdictSchema),
  selectedIds: z.array(z.string()),
  candidateIds: z.array(z.string()),
  explanation: z.string().min(1).max(500),
  unmetConstraints: z.array(z.string()).default([]),
});
