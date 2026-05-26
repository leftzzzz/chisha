import { runSearchAgent } from '@/lib/agent/runtime';
import type { AgentEvent, SearchPlan } from '@/lib/agent/types';
import type { Location, Restaurant } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function restaurant(
  id: string,
  name: string,
  cuisineType: string,
  distance: number = 600
): Restaurant {
  return {
    id,
    name,
    cuisineType,
    distance,
    address: '测试地址',
    location,
    source: 'amap',
  };
}

describe('runSearchAgent', () => {
  it('expands specific hotpot queries and reports unmet exact matches', async () => {
    const events: AgentEvent[] = [];
    const result = await runSearchAgent(
      { query: '想吃潮汕牛肉火锅', location },
      (event) => events.push(event),
      async (plan: SearchPlan) => {
        if (plan.keywords.includes('潮汕牛肉火锅')) {
          return [restaurant('r1', '潮汕牛肉火锅', '火锅', 500)];
        }

        if (plan.keywords.includes('牛肉火锅')) {
          return [restaurant('r2', '牛肉火锅店', '火锅', 700)];
        }

        if (plan.keywords.includes('火锅')) {
          return [
            restaurant('r3', '社区火锅', '火锅', 900),
            restaurant('r4', '老街火锅', '火锅', 1000),
            restaurant('r5', '鲜味火锅', '火锅', 1200),
          ];
        }

        return [];
      }
    );

    expect(result.restaurants.length).toBeGreaterThan(1);
    expect(result.unmetConstraints.join('')).toContain('潮汕牛肉火锅');
    expect(events.some((event) => event.type === 'strategy_change')).toBe(true);
    expect(events.some((event) => event.type === 'final')).toBe(true);
    expect(events.some((event) => event.type === 'done')).toBe(true);
  });

  it('does not return spicy-risk restaurants when user avoids spicy food', async () => {
    const result = await runSearchAgent(
      { query: '今天想吃清淡的，不吃辣', location },
      () => undefined,
      async () => [
        restaurant('r1', '川味小馆', '川菜', 300),
        restaurant('r2', '清粥小菜', '粥', 400),
        restaurant('r3', '粤式茶餐厅', '粤菜', 500),
        restaurant('r4', '寿司店', '日本料理', 600),
      ]
    );

    const names = result.restaurants.map((item) => item.name).join('、');
    expect(names).not.toContain('川味小馆');
    expect(result.restaurants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: '清粥小菜' }),
        expect.objectContaining({ name: '粤式茶餐厅' }),
      ])
    );
  });

  it('returns fewer than target without random fill when candidates are insufficient', async () => {
    const result = await runSearchAgent(
      { query: '想吃素食', location },
      () => undefined,
      async () => [
        restaurant('r1', '素食餐厅', '素食', 300),
      ]
    );

    expect(result.restaurants).toHaveLength(1);
    expect(result.unmetConstraints.join('')).toContain('只找到 1 家');
  });

  it('uses history preferences without overriding explicit current intent', async () => {
    const result = await runSearchAgent(
      {
        query: '想吃日料',
        location,
        preferenceSummary: {
          avoidedCuisines: [{ name: '日本料理', weight: 5 }],
          favoriteCuisines: [{ name: '粤菜', weight: 5 }],
        },
      },
      () => undefined,
      async () => [
        restaurant('r1', '寿司店', '日本料理', 500),
        restaurant('r2', '粤菜餐厅', '粤菜', 300),
      ]
    );

    expect(result.restaurants[0].name).toBe('寿司店');
  });

  it('filters restaurants explicitly marked closed when user asks for open places', async () => {
    const result = await runSearchAgent(
      { query: '附近营业中的餐厅', location },
      () => undefined,
      async () => [
        { ...restaurant('r1', '已打烊餐厅', '餐厅', 300), businessStatus: 'closed' },
        { ...restaurant('r2', '营业中餐厅', '餐厅', 500), businessStatus: 'open' },
      ]
    );

    expect(result.restaurants.map((item) => item.name)).toEqual(['营业中餐厅']);
    expect(result.unmetConstraints.join('')).toContain('营业状态');
  });
});
