import type { Restaurant } from '@/types';
import type {
  CandidateVerification,
  Constraint,
  GoalCategory,
  ItemMatch,
  RequestedItem,
  SearchPlan,
  UserGoal,
  VerificationFailure,
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

const CATEGORY_ALIASES: Record<string, string[]> = {
  日料: ['日料', '日本料理', '日本菜', '寿司', '拉面'],
  日本料理: ['日料', '日本料理', '日本菜', '寿司', '拉面'],
  韩餐: ['韩餐', '韩国料理', '韩式', '烤肉'],
  韩国料理: ['韩餐', '韩国料理', '韩式', '烤肉'],
  快餐: ['快餐', '简餐', '汉堡', '炸鸡', '鸡排', '薯条', '披萨', '肯德基', '麦当劳', '德克士', '华莱士', '塔斯汀'],
  小吃: ['小吃', '简餐', '面馆', '米线', '粉', '麻辣烫', '炸物'],
  火锅: ['火锅', '牛肉火锅', '潮汕牛肉火锅', '串串'],
  西餐: ['西餐', '牛排', '意面', '披萨', '汉堡'],
  粤菜: ['粤菜', '广东菜', '茶餐厅'],
  江浙菜: ['江浙菜', '杭帮菜', '浙江菜'],
  轻食: ['轻食', '沙拉', '健康餐'],
  粥: ['粥', '清粥'],
  素食: ['素食', '素菜'],
  甜品: ['甜品', '蛋糕', '烘焙', '面包甜点'],
  奶茶: ['奶茶', '饮品'],
  咖啡: ['咖啡', '咖啡厅'],
  餐厅: ['餐厅', '美食', '酒楼', '饭店', '食堂'],
  美食: ['餐厅', '美食', '酒楼', '饭店', '食堂', '小吃', '简餐'],
};

const PRIMARY_MATCH_CONFIDENCE = 0.55;

export function verifyCandidate(
  restaurant: Restaurant,
  goal: UserGoal,
  plan: SearchPlan
): CandidateVerification {
  const hardFailures: VerificationFailure[] = [];
  const warnings: string[] = [];
  const itemMatches = matchRequestedItems(restaurant, goal.requestedItems, plan);
  const categoryMatches = matchCategories(restaurant, goal.acceptableCategories);
  const unverifiedStrictConstraints: string[] = [];

  for (const constraint of goal.hardConstraints) {
    const result = verifyConstraint(restaurant, constraint);
    if (result.status === 'failed') {
      hardFailures.push({
        kind: constraint.kind,
        message: result.message,
      });
    } else if (result.status === 'unverified') {
      warnings.push(result.message);
      unverifiedStrictConstraints.push(constraint.kind);
    } else if (result.message) {
      warnings.push(result.message);
    }
  }

  const requiredItems = goal.requestedItems.filter((item) => item.required);
  const hasStrongItemMatch = itemMatches.some((match) => match.confidence >= PRIMARY_MATCH_CONFIDENCE);

  if (requiredItems.length > 0 && !hasStrongItemMatch && !goal.allowBroaden) {
    hardFailures.push({
      kind: 'requested_item',
      message: `未验证到明确菜品「${requiredItems.map((item) => item.name).join('、')}」。`,
    });
  } else if (requiredItems.length > 0 && !hasStrongItemMatch) {
    warnings.push(`只弱关联到「${requiredItems.map((item) => item.name).join('、')}」，已按放宽需求处理。`);
  }

  const alternativeFailures = verifyAlternativeGroups(goal, categoryMatches);
  hardFailures.push(...alternativeFailures);

  if (
    requiredItems.length === 0
    && goal.acceptableCategories.length > 0
    && !hasDefaultDiversity(goal)
    && !hasAcceptableCategoryMatch(goal.acceptableCategories, categoryMatches)
    && !goal.allowBroaden
  ) {
    hardFailures.push({
      kind: 'category',
      message: `未验证到目标品类「${goal.acceptableCategories.map((category) => category.name).join('、')}」。`,
    });
  }

  const status = hardFailures.length > 0
    ? 'failed'
    : unverifiedStrictConstraints.length > 0
      ? 'unverified'
      : 'passed';

  return {
    restaurantId: restaurant.id,
    status,
    hardFailures,
    itemMatches,
    categoryMatches,
    warnings: Array.from(new Set(warnings.filter(Boolean))),
    confidence: calculateConfidence(status, itemMatches, categoryMatches, warnings),
  };
}

export function hasBlockingHardFailure(verification: CandidateVerification): boolean {
  return verification.hardFailures.some((failure) =>
    failure.kind !== 'requested_item' && failure.kind !== 'category'
  );
}

export function verificationSummary(verification: CandidateVerification): string[] {
  return [
    ...verification.hardFailures.map((failure) => failure.message),
    ...verification.warnings,
  ];
}

function verifyConstraint(
  restaurant: Restaurant,
  constraint: Constraint
): { status: 'passed' | 'failed' | 'unverified'; message: string } {
  const text = restaurantText(restaurant);

  if (constraint.kind === 'distance') {
    const maxMeters = getConstraintMaxMeters(constraint);
    if (maxMeters === undefined) {
      return { status: 'passed', message: '' };
    }

    if (restaurant.distance === undefined) {
      return constraint.strict
        ? { status: 'unverified', message: `${constraint.label}需要距离数据，但该餐厅距离未知。` }
        : { status: 'passed', message: `${constraint.label}缺少距离数据，已保留为候选。` };
    }

    if (restaurant.distance > maxMeters) {
      return {
        status: 'failed',
        message: `${restaurant.name}距离 ${restaurant.distance}m，超过${constraint.label} ${maxMeters}m。`,
      };
    }

    return { status: 'passed', message: '' };
  }

  if (constraint.kind === 'avoid_spicy') {
    return SPICY_RISK_TERMS.some((term) => textContains(text, term))
      ? { status: 'failed', message: `${restaurant.name}疑似重辣或辣味风险品类。` }
      : { status: 'passed', message: '' };
  }

  if (constraint.kind === 'exclude_category') {
    const excludedValues = constraint.values
      ?? (Array.isArray(constraint.value) ? constraint.value : typeof constraint.value === 'string' ? [constraint.value] : []);
    const matchedValue = excludedValues.find((value) => textContains(text, value));

    return matchedValue
      ? { status: 'failed', message: `${restaurant.name}命中排除品类「${matchedValue}」。` }
      : { status: 'passed', message: '' };
  }

  if (constraint.kind === 'budget') {
    const range = getBudgetRange(constraint);
    if (!range) {
      return { status: 'passed', message: '' };
    }

    if (restaurant.averagePrice === undefined) {
      return constraint.strict
        ? { status: 'unverified', message: `${constraint.label}需要人均价格，但该餐厅价格未知。` }
        : { status: 'passed', message: '预算信息依赖餐厅人均字段；当前数据源缺失时不会编造价格。' };
    }

    if (
      (range.min !== undefined && restaurant.averagePrice < range.min)
      || (range.max !== undefined && restaurant.averagePrice > range.max)
    ) {
      return {
        status: 'failed',
        message: `${restaurant.name}人均约 ${restaurant.averagePrice} 元，不满足${constraint.label}。`,
      };
    }
  }

  if (constraint.kind === 'open_now') {
    if (restaurant.businessStatus === 'closed') {
      return { status: 'failed', message: `${restaurant.name}数据源标记为已停业或未营业。` };
    }

    if (!restaurant.businessStatus || restaurant.businessStatus === 'unknown') {
      return constraint.strict
        ? { status: 'unverified', message: `${restaurant.name}营业状态未知。` }
        : { status: 'passed', message: '营业状态未知，请出发前确认。' };
    }
  }

  return { status: 'passed', message: '' };
}

function matchRequestedItems(
  restaurant: Restaurant,
  requestedItems: RequestedItem[],
  plan: SearchPlan
): ItemMatch[] {
  const matches: ItemMatch[] = [];

  for (const item of requestedItems) {
    const terms = itemTerms(item);
    const fieldMatch = findBestFieldMatch(restaurant, terms);
    if (fieldMatch) {
      matches.push({
        requestedItem: item.name,
        matchedBy: fieldMatch.field,
        confidence: fieldMatch.confidence,
      });
      continue;
    }

    if (plan.keywords.some((keyword) => terms.some((term) => textContains(keyword, term) || textContains(term, keyword)))) {
      matches.push({
        requestedItem: item.name,
        matchedBy: 'search_keyword',
        confidence: 0.35,
      });
    }
  }

  return matches;
}

function findBestFieldMatch(
  restaurant: Restaurant,
  terms: string[]
): { field: ItemMatch['matchedBy']; confidence: number } | null {
  const fields: Array<{ field: ItemMatch['matchedBy']; text: string; confidence: number }> = [
    { field: 'name', text: restaurant.name, confidence: 0.92 },
    { field: 'cuisineType', text: restaurant.cuisineType, confidence: 0.82 },
    { field: 'address', text: restaurant.address, confidence: 0.62 },
  ];

  for (const field of fields) {
    if (terms.some((term) => textContains(field.text, term))) {
      return {
        field: field.field,
        confidence: field.confidence,
      };
    }
  }

  return null;
}

function itemTerms(item: RequestedItem): string[] {
  return Array.from(new Set([item.name, ...item.aliases].map((term) => term.trim()).filter(Boolean)));
}

function matchCategories(restaurant: Restaurant, categories: GoalCategory[]): string[] {
  const text = restaurantText(restaurant);
  const matches: string[] = [];

  for (const category of categories) {
    const aliases = getCategoryAliases(category.name);
    if (aliases.some((alias) => textContains(text, alias))) {
      matches.push(category.name);
    }
  }

  return Array.from(new Set(matches));
}

function verifyAlternativeGroups(goal: UserGoal, categoryMatches: string[]): VerificationFailure[] {
  const failures: VerificationFailure[] = [];

  for (const group of goal.alternativeGroups) {
    if (group.items.length === 0) {
      continue;
    }

    const matchedItems = group.items.filter((item) => {
      if (categoryMatches.includes(item)) {
        return true;
      }

      const aliases = getCategoryAliases(item);
      return categoryMatches.some((match) => aliases.includes(match) || getCategoryAliases(match).includes(item));
    });

    if (group.mode === 'any_of' && matchedItems.length === 0 && !goal.allowBroaden) {
      failures.push({
        kind: 'category',
        message: `未验证到多意图中的任一品类「${group.items.join('、')}」。`,
      });
    }

    if (group.mode === 'all_of' && matchedItems.length < group.items.length && !goal.allowBroaden) {
      failures.push({
        kind: 'category',
        message: `未同时验证到「${group.items.join('、')}」。`,
      });
    }
  }

  return failures;
}

function hasAcceptableCategoryMatch(categories: GoalCategory[], categoryMatches: string[]): boolean {
  if (categoryMatches.length > 0) {
    return true;
  }

  return categories.every((category) => category.confidence < 0.7);
}

function hasDefaultDiversity(goal: UserGoal): boolean {
  return goal.softPreferences.some((preference) => preference.name === '默认多样性');
}

function getConstraintMaxMeters(constraint: Constraint): number | undefined {
  if (constraint.maxMeters !== undefined) {
    return constraint.maxMeters;
  }

  return typeof constraint.value === 'number' ? constraint.value : undefined;
}

function getBudgetRange(constraint: Constraint): { min?: number; max?: number } | null {
  if (constraint.min !== undefined || constraint.max !== undefined) {
    return {
      min: constraint.min,
      max: constraint.max,
    };
  }

  return typeof constraint.value === 'object' && !Array.isArray(constraint.value)
    ? constraint.value
    : null;
}

function calculateConfidence(
  status: CandidateVerification['status'],
  itemMatches: ItemMatch[],
  categoryMatches: string[],
  warnings: string[]
): number {
  if (status === 'failed') {
    return 0.2;
  }

  const itemConfidence = itemMatches.length > 0
    ? Math.max(...itemMatches.map((match) => match.confidence))
    : 0;
  const categoryConfidence = categoryMatches.length > 0 ? 0.72 : 0;
  const base = Math.max(itemConfidence, categoryConfidence, status === 'passed' ? 0.65 : 0.45);
  const warningPenalty = Math.min(0.2, warnings.length * 0.04);

  return Math.max(0, Math.min(1, Math.round((base - warningPenalty) * 100) / 100));
}

function getCategoryAliases(category: string): string[] {
  return Array.from(new Set([category, ...(CATEGORY_ALIASES[category] ?? [])]));
}

function restaurantText(restaurant: Restaurant): string {
  return `${restaurant.name} ${restaurant.cuisineType} ${restaurant.address}`;
}

function textContains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}
