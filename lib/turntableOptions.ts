import type { CustomOption, Restaurant, TurntableOption } from '@/types';

export const MAX_TURNTABLE_OPTIONS = 8;
export const MIN_TURNTABLE_OPTIONS = 3;

export function getTurntableOptions(
  restaurants: readonly Restaurant[],
  customOptions: readonly CustomOption[] = []
): TurntableOption[] {
  return [...restaurants, ...customOptions].slice(0, MAX_TURNTABLE_OPTIONS);
}

export function getTurntableOptionCount(
  restaurants: readonly Restaurant[],
  customOptions: readonly CustomOption[] = []
): number {
  return Math.min(restaurants.length + customOptions.length, MAX_TURNTABLE_OPTIONS);
}

export function hasTurntableCapacity(
  restaurants: readonly Restaurant[],
  customOptions: readonly CustomOption[] = []
): boolean {
  return restaurants.length + customOptions.length < MAX_TURNTABLE_OPTIONS;
}
