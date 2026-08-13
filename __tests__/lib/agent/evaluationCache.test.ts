import { createVerdictCache } from '@/lib/agent/evaluationCache';
import type { CandidateVerdict, SearchPlan } from '@/lib/agent/types';

function plan(searchIntent: SearchPlan['searchIntent']): SearchPlan {
  return {
    keywords: ['火锅'],
    radiusMeters: 1800,
    searchIntent,
    allowedForPrimary: true,
    reason: 'test',
  };
}

function verdict(
  restaurantId: string,
  status: CandidateVerdict['status'],
  primaryEligible = status === 'passed'
): CandidateVerdict {
  return {
    restaurantId,
    status,
    primaryEligible,
    confidence: 0.9,
    matchedItems: [],
    matchedCategories: [],
    conflicts: [],
    evidence: [],
    warnings: [],
  };
}

describe('verdict 缓存复用规则', () => {
  it('reuses a passed verdict under the same or broader lens', () => {
    const cache = createVerdictCache();
    cache.settle([verdict('r1', 'passed')], plan('exact'));

    expect(cache.lookup('r1', plan('exact'))?.status).toBe('passed');
    expect(cache.lookup('r1', plan('synonym'))?.status).toBe('passed');
    expect(cache.lookup('r1', plan('broadened'))?.status).toBe('passed');
  });

  it('never reuses a passed verdict produced under a broader lens', () => {
    const cache = createVerdictCache();
    cache.settle([verdict('r1', 'passed')], plan('broadened'));

    expect(cache.lookup('r1', plan('broadened'))?.status).toBe('passed');
    expect(cache.lookup('r1', plan('fallback'))?.status).toBe('passed');
    expect(cache.lookup('r1', plan('exact'))).toBeUndefined();
    expect(cache.lookup('r1', plan('synonym'))).toBeUndefined();
  });

  it('always re-evaluates a failed verdict, even under the same lens', () => {
    const cache = createVerdictCache();
    cache.settle([verdict('r1', 'failed')], plan('synonym'));

    // 「寿司专门店」在「日本料理」下不匹配，在「寿司」下应当通过——
    // 同一 intent 层的不同关键词是不同镜头，不能互相沿用失败结论。
    expect(cache.lookup('r1', plan('synonym'))).toBeUndefined();
    expect(cache.lookup('r1', plan('exact'))).toBeUndefined();
  });

  it('always re-evaluates an unverified verdict', () => {
    const cache = createVerdictCache();
    cache.settle([verdict('r1', 'unverified', false)], plan('exact'));

    expect(cache.lookup('r1', plan('exact'))).toBeUndefined();
  });
});

describe('verdict 缓存并发申领', () => {
  it('gives a restaurant to exactly one claimer at a time', () => {
    const cache = createVerdictCache();
    const first = cache.claim(['r1', 'r2'], plan('exact'));
    const second = cache.claim(['r2', 'r3'], plan('exact'));

    expect(first.own).toEqual(['r1', 'r2']);
    expect(second.own).toEqual(['r3']);
    expect(second.waits).toHaveLength(1);
  });

  it('lets a waiter read the verdict once the owner settles', async () => {
    const cache = createVerdictCache();
    const owner = cache.claim(['r1'], plan('exact'));
    const waiter = cache.claim(['r1'], plan('exact'));

    let waiterResolved = false;
    const waiting = Promise.all(waiter.waits).then(() => {
      waiterResolved = true;
    });

    expect(waiterResolved).toBe(false);

    cache.settle([verdict('r1', 'passed')], plan('exact'));
    owner.done();
    await waiting;

    expect(waiterResolved).toBe(true);
    expect(cache.lookup('r1', plan('exact'))?.status).toBe('passed');
  });

  it('releases the reservation so a later plan can retry after a failure', () => {
    const cache = createVerdictCache();
    const first = cache.claim(['r1'], plan('exact'));
    first.done();

    // 评估失败时不 settle，下一个计划应当能重新申领
    expect(cache.claim(['r1'], plan('exact')).own).toEqual(['r1']);
    expect(cache.size()).toBe(0);
  });

  it('does not claim a restaurant that already has a reusable verdict', () => {
    const cache = createVerdictCache();
    cache.settle([verdict('r1', 'passed')], plan('exact'));

    expect(cache.claim(['r1', 'r2'], plan('synonym')).own).toEqual(['r2']);
  });
});
