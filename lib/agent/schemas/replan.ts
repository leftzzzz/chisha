import { z } from 'zod';
import { PendingQuestionSchema } from './clarification';

const ReplanTargetSchema = z.object({
  keyword: z.string().min(1).max(20),
  poiTypes: z.array(z.string()).optional(),
  reason: z.string().max(120).optional(),
});

/**
 * 策略枯竭时模型给出的新方向。
 *
 * 两种合法产出：换一批搜索词继续找，或者向用户提一个贴合上下文的问题。
 * 两者都为空表示模型也没有办法，Runtime 回落到模板追问。
 */
export const ReplanOutputSchema = z.object({
  targets: z.array(ReplanTargetSchema).max(3).optional().catch(undefined),
  question: PendingQuestionSchema.optional().catch(undefined),
  rationale: z.string().max(240).optional().catch(undefined),
});
