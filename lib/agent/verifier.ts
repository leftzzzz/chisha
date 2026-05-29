import type { Restaurant } from '@/types';
import { lookupFoodPoiTypes } from './poiTaxonomy';
import type {
  CandidateVerification,
  GoalCategory,
  ItemMatch,
  RequestedItem,
  SearchPlan,
  UserGoal,
  VerificationFailure,
} from './types';
import { evaluateConstraint } from './constraintEvaluator';

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
  饮品: ['饮品', '奶茶', '咖啡', '果茶'],
  中餐: ['中餐', '家常菜', '炒菜', '餐厅', '饭店'],
  正餐: ['正餐', '中餐', '餐厅', '饭店'],
  简餐: ['简餐', '快餐', '面馆', '小吃'],
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
  const categoryMatches = matchCategories(restaurant, goal.acceptableCategories, plan);
  const unverifiedStrictConstraints: string[] = [];

  for (const constraint of goal.hardConstraints) {
    const result = evaluateConstraint(restaurant, constraint);
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
  const hasSupportedSearchKeywordMatch = hasSearchKeywordItemMatch(itemMatches)
    && isPrimaryKeywordPlan(plan)
    && hasCategorySupportForKeywordEvidence(categoryMatches);

  if (requiredItems.length > 0 && !hasStrongItemMatch && !hasSupportedSearchKeywordMatch && !goal.allowBroaden) {
    hardFailures.push({
      kind: 'requested_item',
      message: `未验证到明确菜品「${requiredItems.map((item) => item.name).join('、')}」。`,
    });
  } else if (requiredItems.length > 0 && !hasStrongItemMatch && hasSupportedSearchKeywordMatch) {
    warnings.push(`菜品「${requiredItems.map((item) => item.name).join('、')}」由精确搜索词和餐厅品类共同验证。`);
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

function matchCategories(restaurant: Restaurant, categories: GoalCategory[], plan: SearchPlan): string[] {
  const text = restaurantText(restaurant);
  const matches: string[] = [];

  for (const category of categories) {
    const aliases = getCategoryAliases(category.name);
    if (aliases.some((alias) => textContains(text, alias))) {
      matches.push(category.name);
      continue;
    }

    if (categoryMatchesPoiType(category.name, restaurant)) {
      matches.push(category.name);
      continue;
    }

    if (planPoiTypesMatchRestaurant(plan, restaurant)) {
      matches.push(category.name);
      continue;
    }

    if (category.confidence < 0.7 && plan.searchIntent !== 'exact' && plan.keywords.some((keyword) =>
      aliases.some((alias) => textContains(keyword, alias) || textContains(alias, keyword))
    )) {
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

function hasSearchKeywordItemMatch(itemMatches: ItemMatch[]): boolean {
  return itemMatches.some((match) => match.matchedBy === 'search_keyword');
}

function isPrimaryKeywordPlan(plan: SearchPlan): boolean {
  return plan.allowedForPrimary
    && (plan.searchIntent === 'exact' || plan.searchIntent === 'synonym');
}

function hasCategorySupportForKeywordEvidence(categoryMatches: string[]): boolean {
  return categoryMatches.length > 0;
}

function hasDefaultDiversity(goal: UserGoal): boolean {
  return goal.softPreferences.some((preference) => preference.name === '默认多样性');
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

function categoryMatchesPoiType(category: string, restaurant: Restaurant): boolean {
  return poiTypesForCategory(category).some((poiType) =>
    restaurant.poiTypeCode === poiType
  );
}

function planPoiTypesMatchRestaurant(plan: SearchPlan, restaurant: Restaurant): boolean {
  if (!plan.poiType || !restaurant.poiTypeCode) {
    return false;
  }

  return plan.poiType.split('|').some((poiType) => poiType === restaurant.poiTypeCode);
}

function poiTypesForCategory(category: string): string[] {
  return (lookupFoodPoiTypes(category) ?? '')
    .split('|')
    .map((poiType) => poiType.trim())
    .filter(Boolean);
}

function restaurantText(restaurant: Restaurant): string {
  return `${restaurant.name} ${restaurant.cuisineType} ${restaurant.address}`;
}

function textContains(text: string, keyword: string): boolean {
  return text.toLowerCase().includes(keyword.toLowerCase());
}
