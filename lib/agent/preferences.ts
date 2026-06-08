import type { UserPreferenceSummary } from './types';

export function mergeUserPreferenceSummaries(
  summaries: UserPreferenceSummary[]
): UserPreferenceSummary | undefined {
  const validSummaries = summaries.filter((summary) => hasPreferenceSignal(summary));
  if (validSummaries.length === 0) {
    return undefined;
  }

  const favoriteWeights = new Map<string, number>();
  const avoidedWeights = new Map<string, number>();
  const distances: number[] = [];
  const minPrices: number[] = [];
  const maxPrices: number[] = [];
  const selectedRestaurants: string[] = [];
  const rejectedRestaurants: string[] = [];

  for (const summary of validSummaries) {
    for (const item of summary.favoriteCuisines ?? []) {
      addWeight(favoriteWeights, item.name, item.weight);
    }

    for (const item of summary.avoidedCuisines ?? []) {
      addWeight(avoidedWeights, item.name, item.weight);
    }

    if (summary.preferredDistanceMeters !== undefined) {
      distances.push(summary.preferredDistanceMeters);
    }

    if (summary.preferredPriceRange?.min !== undefined) {
      minPrices.push(summary.preferredPriceRange.min);
    }

    if (summary.preferredPriceRange?.max !== undefined) {
      maxPrices.push(summary.preferredPriceRange.max);
    }

    selectedRestaurants.push(...(summary.recentSelectedRestaurants ?? []));
    rejectedRestaurants.push(...(summary.recentRejectedRestaurants ?? []));
  }

  return {
    favoriteCuisines: toWeightedList(favoriteWeights),
    avoidedCuisines: toWeightedList(avoidedWeights),
    preferredDistanceMeters: median(distances),
    preferredPriceRange: mergePriceRanges(minPrices, maxPrices),
    recentSelectedRestaurants: unique(selectedRestaurants).slice(0, 20),
    recentRejectedRestaurants: unique(rejectedRestaurants).slice(0, 20),
  };
}

function hasPreferenceSignal(summary: UserPreferenceSummary): boolean {
  return Boolean(
    summary.favoriteCuisines?.length ||
    summary.avoidedCuisines?.length ||
    summary.preferredDistanceMeters ||
    summary.preferredPriceRange ||
    summary.recentSelectedRestaurants?.length ||
    summary.recentRejectedRestaurants?.length
  );
}

function addWeight(weights: Map<string, number>, name: string, weight: number): void {
  const normalizedName = name.trim();
  if (!normalizedName) {
    return;
  }

  weights.set(normalizedName, (weights.get(normalizedName) ?? 0) + weight);
}

function toWeightedList(weights: Map<string, number>): Array<{ name: string; weight: number }> {
  return Array.from(weights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, weight]) => ({ name, weight: Math.round(weight * 100) / 100 }));
}

function median(values: number[]): number | undefined {
  if (values.length === 0) {
    return undefined;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

function mergePriceRanges(
  minPrices: number[],
  maxPrices: number[]
): { min?: number; max?: number } | undefined {
  if (minPrices.length === 0 && maxPrices.length === 0) {
    return undefined;
  }

  return {
    min: minPrices.length > 0 ? Math.max(...minPrices) : undefined,
    max: maxPrices.length > 0 ? Math.min(...maxPrices) : undefined,
  };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}
