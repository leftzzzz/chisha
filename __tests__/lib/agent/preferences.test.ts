import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';

describe('mergeUserPreferenceSummaries', () => {
  it('merges multiple people preference summaries', () => {
    const summary = mergeUserPreferenceSummaries([
      {
        favoriteCuisines: [{ name: '粤菜', weight: 2 }],
        avoidedCuisines: [{ name: '火锅', weight: 1 }],
        preferredDistanceMeters: 800,
        preferredPriceRange: { min: 50, max: 120 },
        recentSelectedRestaurants: ['粤菜餐厅'],
      },
      {
        favoriteCuisines: [{ name: '粤菜', weight: 1 }, { name: '日料', weight: 2 }],
        avoidedCuisines: [{ name: '火锅', weight: 2 }],
        preferredDistanceMeters: 1400,
        preferredPriceRange: { min: 80, max: 160 },
        recentRejectedRestaurants: ['火锅店'],
      },
    ]);

    expect(summary?.favoriteCuisines?.[0]).toEqual({ name: '粤菜', weight: 3 });
    expect(summary?.avoidedCuisines?.[0]).toEqual({ name: '火锅', weight: 3 });
    expect(summary?.preferredDistanceMeters).toBe(1100);
    expect(summary?.preferredPriceRange).toEqual({ min: 80, max: 120 });
    expect(summary?.recentSelectedRestaurants).toContain('粤菜餐厅');
    expect(summary?.recentRejectedRestaurants).toContain('火锅店');
  });
});
