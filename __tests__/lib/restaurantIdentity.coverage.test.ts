import {
  countDistinctBrands,
  getRestaurantBrand,
  getRestaurantIdentityKeys,
  getRestaurantInfoScore,
  getRestaurantPlaceIdentityKey,
} from '@/lib/restaurantIdentity';
import type { Restaurant } from '@/types';

function restaurant(overrides: Partial<Restaurant> = {}): Restaurant {
  return {
    id: 'ID-1', name: ' 品牌（人民店） ', cuisineType: '菜', address: '地址',
    location: { lat: 31.23456, lng: 121.45678 }, source: 'amap', ...overrides,
  };
}

describe('restaurantIdentity edge cases', () => {
  it('normalizes brands and counts only non-empty distinct values', () => {
    expect(getRestaurantBrand(restaurant())).toBe('品牌');
    expect(getRestaurantBrand(restaurant({ name: '   ' }))).toBeNull();
    expect(getRestaurantBrand(restaurant({ name: '（分店）' }))).toBeNull();
    expect(countDistinctBrands([restaurant(), restaurant({ id: '2', name: '品牌(二店)' }), restaurant({ id: '3', name: '' })])).toBe(1);
  });

  it('builds id/place/name identity fallbacks and rejects invalid coordinates', () => {
    expect(getRestaurantIdentityKeys(restaurant())).toEqual(['id:id-1', 'place:品牌（人民店）:31.235:121.457']);
    const nameOnly = restaurant({ id: '', name: ' Name Only ', location: { lat: Number.NaN, lng: Number.NaN } });
    expect(getRestaurantIdentityKeys(nameOnly)).toEqual(['name:nameonly']);
    expect(getRestaurantPlaceIdentityKey(nameOnly)).toBeNull();
    expect(getRestaurantPlaceIdentityKey(restaurant({ name: '' }))).toBeNull();
  });

  it('scores every optional information field', () => {
    expect(getRestaurantInfoScore(restaurant({ phone: '1', rating: 4, averagePrice: 80, openingHours: 'open' }))).toBe(6);
    expect(getRestaurantInfoScore(restaurant({ address: '地址未知', source: 'osm' }))).toBe(0);
  });
});
