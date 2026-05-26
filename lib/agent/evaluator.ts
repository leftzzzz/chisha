import type { Restaurant } from '@/types';
import type {
  AgentContext,
  Constraint,
  Observation,
  RestaurantCandidate,
  SearchPlan,
} from './types';

const SPICY_RISK_TERMS = [
  '川菜',
  '湘菜',
  '火锅',
  '麻辣',
  '香辣',
  '串串',
  '冒菜',
  '烧烤',
  '烤鱼',
  '小龙虾',
  '酸菜鱼',
  '干锅',
  '辣',
];

const LIGHT_TERMS = ['粤菜', '江浙', '日料', '寿司', '轻食', '沙拉', '粥', '素食', '茶餐厅'];
const FAST_TERMS = ['快餐', '简餐', '面馆', '小吃', '汉堡', '披萨'];
const GATHERING_TERMS = ['中餐', '粤菜', '海鲜', '东北菜', '餐厅', '酒楼'];
const DATE_TERMS = ['西餐', '日料', '日本料理', '咖啡', '甜品', '意大利'];

export function evaluateSearchResult(
  restaurants: Restaurant[],
  context: AgentContext,
  plan: SearchPlan,
  sourceAttempt: number
): Observation {
  const acceptedCandidates: RestaurantCandidate[] = [];
  let rejected = 0;

  for (const restaurant of restaurants) {
    const candidate = evaluateRestaurant(restaurant, context, plan, sourceAttempt);
    if (candidate) {
      acceptedCandidates.push(candidate);
    } else {
      rejected++;
    }
  }

  acceptedCandidates.sort((a, b) => b.score - a.score);

  return {
    plan,
    found: restaurants.length,
    acceptedCandidates,
    rejected,
    reason: buildObservationReason(restaurants.length, acceptedCandidates.length, plan),
  };
}

export function mergeCandidates(
  context: AgentContext,
  incomingCandidates: RestaurantCandidate[]
): void {
  const candidateMap = new Map<string, RestaurantCandidate>();

  for (const candidate of context.candidates) {
    candidateMap.set(candidateKey(candidate.restaurant), candidate);
  }

  for (const incoming of incomingCandidates) {
    const key = candidateKey(incoming.restaurant);
    const existing = candidateMap.get(key);

    if (!existing || incoming.score > existing.score) {
      candidateMap.set(key, incoming);
      continue;
    }

    existing.matched = mergeStrings(existing.matched, incoming.matched);
    existing.warnings = mergeStrings(existing.warnings, incoming.warnings);
  }

  context.candidates = Array.from(candidateMap.values())
    .sort((a, b) => b.score - a.score);
}

export function isGoodEnough(context: AgentContext): boolean {
  if (context.candidates.length < context.targetCount) {
    return false;
  }

  const strongCandidates = context.candidates.filter((candidate) => candidate.score >= 55);
  const hasExactOrSynonymAttempt = context.attempts.some((attempt) =>
    attempt.searchIntent === 'exact' || attempt.searchIntent === 'synonym'
  );

  if (hasExactOrSynonymAttempt && strongCandidates.length >= context.targetCount) {
    return true;
  }

  return context.attempts.length >= 2 && strongCandidates.length >= Math.ceil(context.targetCount * 0.75);
}

function evaluateRestaurant(
  restaurant: Restaurant,
  context: AgentContext,
  plan: SearchPlan,
  sourceAttempt: number
): RestaurantCandidate | null {
  if (violatesHardConstraints(restaurant, context.goal.hardConstraints)) {
    return null;
  }

  const matched: string[] = [];
  const warnings = [...context.goal.ambiguity];
  let score = plan.searchIntent === 'fallback' ? 18 : 32;
  const searchableText = restaurantText(restaurant);
  const requiresOpenNow = context.goal.hardConstraints.some((constraint) => constraint.kind === 'open_now');

  if (requiresOpenNow) {
    if (restaurant.businessStatus === 'open') {
      score += 8;
      matched.push('数据源标记营业中');
    } else if (!restaurant.businessStatus || restaurant.businessStatus === 'unknown') {
      warnings.push('营业状态未知，请出发前确认。');
    }
  }

  for (const keyword of plan.keywords) {
    if (textContains(searchableText, keyword)) {
      score += 18;
      matched.push(`匹配${keyword}`);
    }
  }

  for (const keyword of context.goal.primaryKeywords) {
    if (textContains(searchableText, keyword)) {
      score += 20;
      matched.push(`符合原始需求${keyword}`);
    }
  }

  for (const keyword of context.goal.relatedKeywords) {
    if (textContains(searchableText, keyword)) {
      score += 8;
      matched.push(`相关品类${keyword}`);
    }
  }

  if (matched.length === 0 && plan.searchIntent !== 'fallback') {
    score -= 16;
  }

  score += distanceScore(restaurant.distance);
  score += softPreferenceScore(restaurant, context.goal.softPreferences, matched, warnings);
  score += historyPreferenceScore(restaurant, context, matched, warnings);

  if (plan.searchIntent === 'exact') {
    score += 6;
  } else if (plan.searchIntent === 'broadened') {
    warnings.push('这是放宽品类后的候选。');
  } else if (plan.searchIntent === 'fallback') {
    warnings.push('这是兜底搜索候选，相关性可能较弱。');
  }

  const acceptedThreshold = plan.searchIntent === 'fallback' ? 28 : 38;
  if (score < acceptedThreshold) {
    return null;
  }

  return {
    restaurant,
    score,
    matched: mergeStrings(matched, []),
    warnings: mergeStrings(warnings, []),
    sourceAttempt,
  };
}

function violatesHardConstraints(restaurant: Restaurant, constraints: Constraint[]): boolean {
  const text = restaurantText(restaurant);

  return constraints.some((constraint) => {
    if (constraint.kind === 'distance' && typeof constraint.value === 'number') {
      return restaurant.distance !== undefined && restaurant.distance > constraint.value;
    }

    if (constraint.kind === 'avoid_spicy') {
      return SPICY_RISK_TERMS.some((term) => textContains(text, term));
    }

    if (constraint.kind === 'exclude_category' && typeof constraint.value === 'string') {
      return textContains(text, constraint.value);
    }

    if (constraint.kind === 'budget' && typeof constraint.value === 'object' && restaurant.averagePrice) {
      const range = constraint.value as { min?: number; max?: number };
      return (range.min !== undefined && restaurant.averagePrice < range.min)
        || (range.max !== undefined && restaurant.averagePrice > range.max);
    }

    if (constraint.kind === 'open_now') {
      return restaurant.businessStatus === 'closed';
    }

    return false;
  });
}

function softPreferenceScore(
  restaurant: Restaurant,
  preferences: AgentContext['goal']['softPreferences'],
  matched: string[],
  warnings: string[]
): number {
  const text = restaurantText(restaurant);
  let score = 0;

  for (const preference of preferences) {
    if (preference.name === '清淡' && LIGHT_TERMS.some((term) => textContains(text, term))) {
      score += 10 * preference.weight;
      matched.push('偏清淡');
    }

    if (preference.name === '适合聚餐' && GATHERING_TERMS.some((term) => textContains(text, term))) {
      score += 5 * preference.weight;
      matched.push('类型较适合聚餐');
    }

    if (preference.name === '适合约会' && DATE_TERMS.some((term) => textContains(text, term))) {
      score += 5 * preference.weight;
      matched.push('类型较适合约会');
    }

    if (preference.name === '默认多样性' && FAST_TERMS.concat(GATHERING_TERMS).some((term) => textContains(text, term))) {
      score += 6 * preference.weight;
      matched.push('适合作为默认推荐');
    }

    if (!preference.verifiable) {
      warnings.push(`${preference.name}缺少可靠字段，只能弱推断。`);
    }
  }

  return score;
}

function historyPreferenceScore(
  restaurant: Restaurant,
  context: AgentContext,
  matched: string[],
  warnings: string[]
): number {
  const text = restaurantText(restaurant);
  let score = 0;

  for (const favorite of context.preferenceSummary?.favoriteCuisines ?? []) {
    if (textContains(text, favorite.name)) {
      score += Math.min(18, favorite.weight * 4);
      matched.push(`历史偏好${favorite.name}`);
    }
  }

  for (const avoided of context.preferenceSummary?.avoidedCuisines ?? []) {
    if (textContains(text, avoided.name)) {
      score -= Math.min(20, avoided.weight * 5);
      warnings.push(`历史上较少选择${avoided.name}`);
    }
  }

  if (context.preferenceSummary?.recentSelectedRestaurants?.includes(restaurant.name)) {
    score += 8;
    matched.push('最近选中过');
  }

  if (context.preferenceSummary?.recentRejectedRestaurants?.includes(restaurant.name)) {
    score -= 16;
    warnings.push('最近手动删除过');
  }

  return score;
}

function distanceScore(distance?: number): number {
  if (distance === undefined) {
    return 4;
  }

  if (distance <= 500) return 16;
  if (distance <= 1000) return 13;
  if (distance <= 2000) return 9;
  if (distance <= 3000) return 5;
  return 1;
}

function buildObservationReason(found: number, accepted: number, plan: SearchPlan): string {
  if (found === 0) {
    return `搜索「${plan.keywords.join('、')}」没有返回结果。`;
  }

  if (accepted === 0) {
    return `搜索「${plan.keywords.join('、')}」返回 ${found} 家，但都未通过硬约束或相关性过滤。`;
  }

  if (accepted < found) {
    return `搜索「${plan.keywords.join('、')}」返回 ${found} 家，接受 ${accepted} 家。`;
  }

  return `搜索「${plan.keywords.join('、')}」接受 ${accepted} 家候选。`;
}

function restaurantText(restaurant: Restaurant): string {
  return `${restaurant.name} ${restaurant.cuisineType} ${restaurant.address}`;
}

function textContains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}

function candidateKey(restaurant: Restaurant): string {
  return `${restaurant.id}:${restaurant.name}:${restaurant.location.lat.toFixed(3)}:${restaurant.location.lng.toFixed(3)}`;
}

function mergeStrings(left: string[], right: string[]): string[] {
  return Array.from(new Set([...left, ...right].filter(Boolean)));
}
