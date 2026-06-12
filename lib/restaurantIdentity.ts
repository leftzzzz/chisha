import type { Restaurant } from '@/types';

/**
 * Extract brand name from a restaurant name.
 * Strips branch info in parentheses: "麦当劳(国贸店)" → "麦当劳"
 * Normalizes by removing common suffixes and spaces.
 */
export function getRestaurantBrand(restaurant: Restaurant): string | null {
  const name = restaurant.name?.trim();
  if (!name) return null;

  const brand = name
    .replace(/[（(].*$/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  return brand.length > 0 ? brand : null;
}

export function getRestaurantIdentityKeys(restaurant: Restaurant): string[] {
  const keys = new Set<string>();
  const id = normalizeIdentityPart(restaurant.id);
  const placeKey = getRestaurantPlaceIdentityKey(restaurant);

  if (id) {
    keys.add(`id:${id}`);
  }

  if (placeKey) {
    keys.add(`place:${placeKey}`);
  }

  if (keys.size === 0) {
    const name = normalizeRestaurantName(restaurant.name);
    if (name) {
      keys.add(`name:${name}`);
    }
  }

  return Array.from(keys);
}

export function getRestaurantPlaceIdentityKey(restaurant: Restaurant): string | null {
  const name = normalizeRestaurantName(restaurant.name);
  const lat = formatCoordinate(restaurant.location.lat);
  const lng = formatCoordinate(restaurant.location.lng);

  if (!name || !lat || !lng) {
    return null;
  }

  return `${name}:${lat}:${lng}`;
}

/**
 * Count distinct brands among a list of restaurants.
 * Used for result-count validation: e.g. 8 results from 2 brands should be treated as 2.
 */
export function countDistinctBrands(restaurants: Restaurant[]): number {
  const brands = new Set<string>();
  for (const r of restaurants) {
    const brand = getRestaurantBrand(r);
    if (brand) {
      brands.add(brand);
    }
  }
  return brands.size;
}

export function getRestaurantInfoScore(restaurant: Restaurant): number {
  let score = 0;

  if (restaurant.phone) score += 1;
  if (restaurant.rating) score += 1;
  if (restaurant.averagePrice) score += 1;
  if (restaurant.openingHours) score += 1;
  if (restaurant.address && restaurant.address !== '地址未知') score += 1;
  if (restaurant.source === 'amap') score += 1;

  return score;
}

function normalizeRestaurantName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '');
}

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase();
}

function formatCoordinate(value: number): string | null {
  return Number.isFinite(value) ? value.toFixed(3) : null;
}
