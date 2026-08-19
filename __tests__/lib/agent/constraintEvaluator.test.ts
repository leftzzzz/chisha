import { evaluateConstraint } from '@/lib/agent/constraintEvaluator';
import type { Constraint } from '@/lib/agent/types';
import type { Restaurant } from '@/types';

const restaurant: Restaurant = {
  id: 'r1', name: '测试餐厅', cuisineType: '川菜', address: '地址',
  location: { lat: 1, lng: 2 }, source: 'amap',
};

function constraint(overrides: Partial<Constraint>): Constraint {
  return { kind: 'distance', label: '距离要求', ...overrides };
}

describe('evaluateConstraint', () => {
  it('evaluates distance values, missing data and absent bounds', () => {
    expect(evaluateConstraint(restaurant, constraint({ value: 'nearby' }))).toEqual({ status: 'passed', message: '' });
    expect(evaluateConstraint(restaurant, constraint({ maxMeters: 1000, strict: true }))).toMatchObject({ status: 'unverified' });
    expect(evaluateConstraint(restaurant, constraint({ value: 1000, strict: false }))).toMatchObject({ status: 'passed', message: expect.stringContaining('已保留') });
    expect(evaluateConstraint({ ...restaurant, distance: 1200 }, constraint({ maxMeters: 1000 }))).toMatchObject({ status: 'failed', message: expect.stringContaining('1200m') });
    expect(evaluateConstraint({ ...restaurant, distance: 800 }, constraint({ maxMeters: 1000 }))).toEqual({ status: 'passed', message: '' });
  });

  it('evaluates budget ranges from direct fields and object values', () => {
    expect(evaluateConstraint(restaurant, constraint({ kind: 'budget', value: 'cheap' }))).toEqual({ status: 'passed', message: '' });
    expect(evaluateConstraint(restaurant, constraint({ kind: 'budget', min: 50, strict: true }))).toMatchObject({ status: 'unverified' });
    expect(evaluateConstraint(restaurant, constraint({ kind: 'budget', max: 100, strict: false }))).toMatchObject({ status: 'passed', message: expect.stringContaining('不会编造') });
    expect(evaluateConstraint({ ...restaurant, averagePrice: 40 }, constraint({ kind: 'budget', min: 50 }))).toMatchObject({ status: 'failed' });
    expect(evaluateConstraint({ ...restaurant, averagePrice: 120 }, constraint({ kind: 'budget', value: { max: 100 } }))).toMatchObject({ status: 'failed' });
    expect(evaluateConstraint({ ...restaurant, averagePrice: 80 }, constraint({ kind: 'budget', min: 50, max: 100 }))).toEqual({ status: 'passed', message: '' });
    expect(evaluateConstraint({ ...restaurant, averagePrice: 80 }, constraint({ kind: 'budget', value: [] as unknown as string[] }))).toEqual({ status: 'passed', message: '' });
  });

  it('evaluates open-now status and ignores unrelated constraints', () => {
    expect(evaluateConstraint({ ...restaurant, businessStatus: 'closed' }, constraint({ kind: 'open_now' }))).toMatchObject({ status: 'failed' });
    expect(evaluateConstraint({ ...restaurant, businessStatus: undefined }, constraint({ kind: 'open_now', strict: true }))).toMatchObject({ status: 'unverified' });
    expect(evaluateConstraint({ ...restaurant, businessStatus: 'unknown' }, constraint({ kind: 'open_now', strict: false }))).toMatchObject({ status: 'passed', message: expect.stringContaining('出发前确认') });
    expect(evaluateConstraint({ ...restaurant, businessStatus: 'open' }, constraint({ kind: 'open_now' }))).toEqual({ status: 'passed', message: '' });
    expect(evaluateConstraint(restaurant, constraint({ kind: 'avoid_spicy' }))).toEqual({ status: 'passed', message: '' });
  });
});
