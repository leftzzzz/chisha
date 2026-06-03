import type { Restaurant } from '@/types';

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
