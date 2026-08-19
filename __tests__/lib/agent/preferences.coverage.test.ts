import { mergeUserPreferenceSummaries } from '@/lib/agent/preferences';

describe('mergeUserPreferenceSummaries edge cases', () => {
  it('returns undefined when every summary lacks a signal', () => {
    expect(mergeUserPreferenceSummaries([{}, { favoriteCuisines: [], recentSelectedRestaurants: [] }])).toBeUndefined();
  });

  it('handles odd medians, sparse price ranges, empty weights and unique list caps', () => {
    const selected = Array.from({ length: 25 }, (_, index) => `selected-${index}`);
    const result = mergeUserPreferenceSummaries([
      {
        favoriteCuisines: [{ name: '  ', weight: 4 }, { name: '川菜', weight: 1.234 }],
        preferredDistanceMeters: 100,
        preferredPriceRange: { min: 20 },
        recentSelectedRestaurants: [...selected, '', 'selected-0'],
      },
      {
        favoriteCuisines: [{ name: '川菜', weight: 2.345 }],
        preferredDistanceMeters: 300,
        preferredPriceRange: { min: 40 },
        recentRejectedRestaurants: ['', '拒绝店', '拒绝店'],
      },
      { preferredDistanceMeters: 200, preferredPriceRange: { min: 30 } },
    ]);
    expect(result).toMatchObject({
      favoriteCuisines: [{ name: '川菜', weight: 3.58 }],
      preferredDistanceMeters: 200,
      preferredPriceRange: { min: 40, max: undefined },
      recentRejectedRestaurants: ['拒绝店'],
    });
    expect(result?.recentSelectedRestaurants).toHaveLength(20);
  });

  it('supports max-only ranges and summaries with each individual signal', () => {
    const result = mergeUserPreferenceSummaries([
      { avoidedCuisines: [{ name: '香菜', weight: 1 }] },
      { preferredPriceRange: { max: 100 } },
      { recentRejectedRestaurants: ['店'] },
    ]);
    expect(result?.preferredPriceRange).toEqual({ min: undefined, max: 100 });
    expect(result?.preferredDistanceMeters).toBeUndefined();
  });
});
