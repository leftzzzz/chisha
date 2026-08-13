/**
 * 一轮内的候选裁决缓存。
 *
 * 高德对「火锅」和「川菜」会返回大量重叠 POI，同一家店此前会被反复送进
 * EvaluationAgent——那是调用量最大的 agent。这里让一轮之内同一家店只被
 * 判一次。
 *
 * 三个刻意的边界：
 *
 * 1. **缓存的是模型原始裁决，不是准入结论。** `primaryEligible` 会在
 *    {@link applyVerdictGuard} 里与当轮 plan 的 `allowedForPrimary` 相与，
 *    所以复用时必须重新过一遍 guard，不能直接拿旧的准入结果。
 * 2. **只在一轮内复用。** 跨轮的候选裁决已经存在 `runtimeState.candidates`
 *    里，但那份 `primaryEligible` 是 guard 之后（甚至被 broadenAdmission
 *    提升过）的值，重新拿来当原始裁决会把授权状态算错。
 * 3. **只复用通过的裁决，且产出它的镜头不能比当前更宽。** 一家店已经满足
 *    目标，换个关键词看它依然满足；但"在这个关键词下不匹配"换个关键词可能
 *    就匹配了（「寿司专门店」在「日本料理」下判失败、在「寿司」下应当通过），
 *    所以 failed / unverified 一律重判。宽镜头（broadened/fallback）下宽容
 *    通过的裁决也不能拿到窄镜头复用。
 */

import type { CandidateVerdict, SearchIntent, SearchPlan } from './types';

interface VerdictCacheEntry {
  verdict: CandidateVerdict;
  /** 产出该裁决时所用计划的意图，决定它能否被更窄的镜头复用 */
  searchIntent: SearchIntent;
}

export interface VerdictClaim {
  /** 由本次调用负责评估的餐厅 id */
  own: string[];
  /** 正在被同批其他计划评估、需要等待的餐厅 */
  waits: Promise<void>[];
  /** 释放本次调用持有的预约，无论成功失败都必须调用 */
  done: () => void;
}

export interface VerdictCache {
  /** 取一条可以在当前计划下复用的裁决 */
  lookup(restaurantId: string, plan: SearchPlan): CandidateVerdict | undefined;
  /** 声明由本次调用评估这批餐厅；已有裁决或已被他人预约的会被排除 */
  claim(restaurantIds: string[], plan: SearchPlan): VerdictClaim;
  /** 写入本次评估产出的裁决 */
  settle(verdicts: CandidateVerdict[], plan: SearchPlan): void;
  /** 已缓存的裁决条数，用于观测 */
  size(): number;
}

const INTENT_RANK: Record<SearchIntent, number> = {
  exact: 0,
  synonym: 1,
  broadened: 2,
  fallback: 3,
};

export function createVerdictCache(): VerdictCache {
  const settled = new Map<string, VerdictCacheEntry>();
  const inFlight = new Map<string, Promise<void>>();

  function lookup(restaurantId: string, plan: SearchPlan): CandidateVerdict | undefined {
    const entry = settled.get(restaurantId);
    return entry && canReuse(entry, plan) ? entry.verdict : undefined;
  }

  return {
    lookup,

    claim(restaurantIds, plan) {
      const own: string[] = [];
      const waits: Promise<void>[] = [];
      let resolveOwn: () => void = () => undefined;
      const ownPromise = new Promise<void>((resolve) => {
        resolveOwn = resolve;
      });

      for (const restaurantId of Array.from(new Set(restaurantIds))) {
        if (lookup(restaurantId, plan)) {
          continue;
        }

        const pending = inFlight.get(restaurantId);
        if (pending) {
          waits.push(pending);
          continue;
        }

        inFlight.set(restaurantId, ownPromise);
        own.push(restaurantId);
      }

      return {
        own,
        waits,
        done: () => {
          for (const restaurantId of own) {
            if (inFlight.get(restaurantId) === ownPromise) {
              inFlight.delete(restaurantId);
            }
          }
          resolveOwn();
        },
      };
    },

    settle(verdicts, plan) {
      for (const verdict of verdicts) {
        settled.set(verdict.restaurantId, { verdict, searchIntent: plan.searchIntent });
      }
    },

    size: () => settled.size,
  };
}

function canReuse(entry: VerdictCacheEntry, plan: SearchPlan): boolean {
  return entry.verdict.status === 'passed'
    && INTENT_RANK[entry.searchIntent] <= INTENT_RANK[plan.searchIntent];
}
