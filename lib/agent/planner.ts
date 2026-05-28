import type {
  AlternativeGroup,
  ClarificationNeed,
  Constraint,
  GoalCategory,
  Preference,
  RequestedItem,
  SearchPlan,
  UserGoal,
  UserPreferenceSummary,
} from './types';

export interface AgentGoalDraft {
  requestedItems?: RequestedItem[];
  acceptableCategories?: GoalCategory[];
  alternativeGroups?: AlternativeGroup[];
  primaryKeywords?: string[];
  relatedKeywords?: string[];
  broadenedKeywords?: string[];
  poiType?: string;
  softPreferences?: Preference[];
  ambiguity?: string[];
  clarificationNeeded?: ClarificationNeed[];
  allowBroaden?: boolean;
}

const EXCLUDABLE_CATEGORIES = [
  '火锅',
  '川菜',
  '湘菜',
  '烧烤',
  '日料',
  '西餐',
  '韩餐',
  '咖啡',
  '奶茶',
  '甜品',
  '快餐',
  '小吃',
  '海鲜',
];

const DEFAULT_RADIUS = 1800;

const CATEGORY_DEFINITIONS: Array<{
  name: string;
  aliases: string[];
  poiType?: string;
  related?: string[];
  broadened?: string[];
}> = [
  { name: '川菜', aliases: ['川菜', '麻辣', '川味'], poiType: '050102', related: ['麻辣'], broadened: ['中餐'] },
  { name: '粤菜', aliases: ['粤菜', '广东菜', '茶餐厅', '烧腊', '点心'], poiType: '050103', related: ['广东菜', '茶餐厅'], broadened: ['中餐'] },
  { name: '湘菜', aliases: ['湘菜', '湖南菜'], poiType: '050109', related: ['湖南菜'], broadened: ['中餐'] },
  { name: '鲁菜', aliases: ['鲁菜', '山东菜'], poiType: '050104', broadened: ['中餐'] },
  { name: '苏菜', aliases: ['苏菜', '江苏菜'], poiType: '050105', broadened: ['中餐'] },
  { name: '浙菜', aliases: ['浙菜', '杭帮菜', '浙江菜'], poiType: '050106', related: ['杭帮菜'], broadened: ['中餐'] },
  { name: '闽菜', aliases: ['闽菜', '福建菜'], poiType: '050108', broadened: ['中餐'] },
  { name: '徽菜', aliases: ['徽菜', '安徽菜'], poiType: '050107', broadened: ['中餐'] },
  { name: '火锅', aliases: ['火锅', '涮锅', '牛肉火锅', '潮汕牛肉火锅'], poiType: '050117', related: ['牛肉火锅', '串串'], broadened: ['中餐'] },
  { name: '烧烤', aliases: ['烧烤', '烤串', '烤肉', 'BBQ', 'bbq'], poiType: '050700', related: ['烤肉'], broadened: ['小吃'] },
  { name: '日料', aliases: ['日料', '日本料理', '日本菜', '寿司', '拉面'], poiType: '050201', related: ['日本料理', '寿司', '拉面'], broadened: ['亚洲料理'] },
  { name: '韩餐', aliases: ['韩餐', '韩国料理', '韩式', '石锅拌饭', '韩式烤肉'], poiType: '050202', related: ['韩国料理', '韩式烤肉'], broadened: ['亚洲料理'] },
  { name: '西餐', aliases: ['西餐', '牛排', '意面', '披萨', '意大利菜'], poiType: '050203', related: ['牛排', '意面', '披萨'], broadened: ['餐厅'] },
  { name: '快餐', aliases: ['快餐', '汉堡', '炸鸡', '薯条', '鸡排'], poiType: '050300', related: ['汉堡', '炸鸡'], broadened: ['简餐'] },
  { name: '小吃', aliases: ['小吃', '麻辣烫', '冒菜', '串串', '米线'], poiType: '050310', related: ['简餐'], broadened: ['餐厅'] },
  { name: '咖啡', aliases: ['咖啡', '咖啡店', '咖啡厅'], poiType: '050401', related: ['咖啡厅'], broadened: ['饮品'] },
  { name: '奶茶', aliases: ['奶茶', '饮品', '果茶', '柠檬茶'], poiType: '050307', related: ['饮品'], broadened: ['甜品'] },
  { name: '甜品', aliases: ['甜品', '蛋糕', '面包', '烘焙'], poiType: '050600', related: ['蛋糕', '烘焙'], broadened: ['饮品'] },
  { name: '海鲜', aliases: ['海鲜', '海鲜餐厅'], poiType: '050118', broadened: ['中餐'] },
  { name: '素食', aliases: ['素食', '素菜'], poiType: '050119', related: ['轻食'], broadened: ['中餐'] },
  { name: '清真', aliases: ['清真', '兰州拉面'], poiType: '050116', broadened: ['中餐'] },
];

const ITEM_DEFINITIONS: Array<{
  name: string;
  aliases?: string[];
  category?: string;
  broadened?: string[];
}> = [
  { name: '炸鸡', aliases: ['鸡排', '炸物', '炸鸡汉堡'], category: '快餐', broadened: ['小吃'] },
  { name: '薯条', aliases: ['汉堡', '麦当劳', '肯德基'], category: '快餐', broadened: ['小吃'] },
  { name: '汉堡', aliases: ['汉堡包'], category: '快餐', broadened: ['西餐'] },
  { name: '披萨', aliases: ['比萨'], category: '西餐', broadened: ['快餐'] },
  { name: '寿司', aliases: ['刺身'], category: '日料', broadened: ['日料'] },
  { name: '拉面', aliases: ['日式拉面'], category: '日料', broadened: ['日料', '面馆'] },
  { name: '牛肉面', aliases: ['兰州拉面'], category: '面馆', broadened: ['快餐'] },
  { name: '酸菜鱼', aliases: ['烤鱼'], category: '川菜', broadened: ['中餐'] },
  { name: '麻辣烫', aliases: ['冒菜', '串串'], category: '小吃', broadened: ['快餐'] },
  { name: '小龙虾', aliases: ['龙虾'], category: '海鲜', broadened: ['烧烤'] },
  { name: '烤鸭', aliases: ['北京烤鸭'], category: '中餐', broadened: ['餐厅'] },
  { name: '蛋糕', aliases: ['甜点', '烘焙'], category: '甜品', broadened: ['咖啡'] },
  { name: '沙拉', aliases: ['轻食'], category: '轻食', broadened: ['素食'] },
  { name: '粥', aliases: ['养生粥'], category: '粥', broadened: ['中餐'] },
];

const TASTE_EXPANSIONS: Array<{ patterns: string[]; keywords: string[]; preference?: Preference }> = [
  {
    patterns: ['清淡', '不油腻'],
    keywords: ['粤菜', '江浙菜', '日料', '轻食', '沙拉', '粥'],
    preference: { name: '清淡', weight: 2, verifiable: false },
  },
  { patterns: ['健康', '养生', '低卡'], keywords: ['轻食', '沙拉', '素食', '养生粥'] },
  { patterns: ['赶时间', '快一点', '快的', '简单'], keywords: ['快餐', '面馆', '简餐'] },
  { patterns: ['喝点', '饮品', '喝的'], keywords: ['咖啡', '奶茶', '饮品'] },
  { patterns: ['甜', '甜点'], keywords: ['甜品', '蛋糕', '烘焙'] },
  { patterns: ['家常'], keywords: ['中餐', '家常菜', '炒菜'] },
  { patterns: ['辣', '重口味', '刺激'], keywords: ['川菜', '湘菜', '火锅', '烧烤'] },
];

export function parseUserGoal(
  query: string,
  preferenceSummary?: UserPreferenceSummary,
  agentGoal: AgentGoalDraft = {}
): UserGoal {
  const fallbackGoal = buildFallbackAgentGoal(query);
  const hardConstraints: Constraint[] = [];
  const softPreferences: Preference[] = [
    ...(agentGoal.softPreferences ?? []),
    ...(agentGoal.softPreferences?.length ? [] : fallbackGoal.softPreferences ?? []),
  ];
  const exclusions = parseExclusions(query);
  const ambiguity: string[] = [...(agentGoal.ambiguity ?? []), ...(fallbackGoal.ambiguity ?? [])];
  const avoidSpicy = isAvoidingSpicy(query);
  const requestedItems = dedupeRequestedItems([
    ...(agentGoal.requestedItems ?? []),
    ...(fallbackGoal.requestedItems ?? []),
  ]);
  const distanceConstraint = parseDistanceConstraint(query, preferenceSummary);
  const budgetConstraint = parseBudgetConstraint(query, preferenceSummary);
  const openNowConstraint = parseOpenNowConstraint(query);

  if (distanceConstraint) {
    hardConstraints.push(distanceConstraint);
  }

  if (avoidSpicy) {
    hardConstraints.push({
      kind: 'avoid_spicy',
      label: '不吃辣或偏清淡',
      strict: true,
    });
    softPreferences.push({
      name: '清淡',
      weight: 2,
      verifiable: false,
    });
  }

  if (budgetConstraint) {
    hardConstraints.push(budgetConstraint);
    ambiguity.push('当前餐厅数据源不稳定提供人均价格，预算只能作为说明和弱排序依据。');
  }

  if (openNowConstraint) {
    hardConstraints.push(openNowConstraint);
    ambiguity.push('营业状态依赖高德详情字段；缺失时只能过滤明确停业的餐厅。');
  }

  for (const exclusion of exclusions) {
    hardConstraints.push({
      kind: 'exclude_category',
      label: `排除${exclusion}`,
      value: exclusion,
      values: [exclusion],
      strict: true,
    });
  }

  let primaryKeywords = dedupeKeywords(
    agentGoal.primaryKeywords?.length ? agentGoal.primaryKeywords : fallbackGoal.primaryKeywords ?? []
  );
  const relatedKeywords = dedupeKeywords([
    ...(agentGoal.relatedKeywords ?? []),
    ...(fallbackGoal.relatedKeywords ?? []),
  ]);
  const broadenedKeywords = dedupeKeywords([
    ...(agentGoal.broadenedKeywords ?? []),
    ...(fallbackGoal.broadenedKeywords ?? []),
  ]);
  const hasAgentIntentSignal = primaryKeywords.length > 0
    || requestedItems.length > 0
    || Boolean(agentGoal.acceptableCategories?.length)
    || Boolean(fallbackGoal.acceptableCategories?.length);

  if (primaryKeywords.length === 0 && requestedItems.length > 0) {
    primaryKeywords = requestedItems.map((item) => item.name);
  }

  if (primaryKeywords.length === 0 && agentGoal.acceptableCategories?.length) {
    primaryKeywords = agentGoal.acceptableCategories.map((category) => category.name);
  }

  if (primaryKeywords.length === 0 && isOpenEndedQuery(query)) {
    const favoriteKeywords = preferenceSummary?.favoriteCuisines
      ?.filter((item) => item.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((item) => item.name) ?? [];

    primaryKeywords = favoriteKeywords.length > 0
      ? favoriteKeywords
      : ['餐厅', '美食'];
    softPreferences.push({ name: '默认多样性', weight: 1, verifiable: true });
  }

  if (primaryKeywords.length === 0) {
    primaryKeywords = [query.trim()].filter(Boolean);
  }

  const dedupedPrimaryKeywords = dedupeKeywords(primaryKeywords);
  const dedupedRelatedKeywords = dedupeKeywords(relatedKeywords);
  const dedupedBroadenedKeywords = dedupeKeywords(broadenedKeywords);
  const acceptableCategories = dedupeGoalCategories([
    ...(agentGoal.acceptableCategories ?? []),
    ...(fallbackGoal.acceptableCategories ?? []),
  ]);
  const alternativeGroups = dedupeAlternativeGroups(agentGoal.alternativeGroups ?? []);
  const allowBroaden = agentGoal.allowBroaden ?? (isOpenEndedQuery(query) || isBroadenPermission(query));
  const clarificationNeeded = agentGoal.clarificationNeeded?.length
    ? agentGoal.clarificationNeeded
    : buildFallbackClarificationNeeds(query, hasAgentIntentSignal);

  return {
    intent: 'find_restaurants',
    rawQuery: query,
    poiType: agentGoal.poiType ?? fallbackGoal.poiType,
    requestedItems,
    acceptableCategories,
    alternativeGroups,
    primaryKeywords: dedupedPrimaryKeywords,
    relatedKeywords: dedupedRelatedKeywords,
    broadenedKeywords: dedupedBroadenedKeywords,
    hardConstraints,
    softPreferences,
    exclusions,
    ambiguity: dedupeStrings(ambiguity),
    clarificationNeeded,
    allowBroaden,
  };
}

function buildFallbackAgentGoal(query: string): AgentGoalDraft {
  const normalizedQuery = query.trim().toLowerCase();
  const primaryKeywords: string[] = [];
  const relatedKeywords: string[] = [];
  const broadenedKeywords: string[] = [];
  const requestedItems: RequestedItem[] = [];
  const acceptableCategories: GoalCategory[] = [];
  const softPreferences: Preference[] = [];
  let poiType: string | undefined;

  if (!normalizedQuery || isOpenEndedQuery(query)) {
    return {};
  }

  for (const item of ITEM_DEFINITIONS) {
    const terms = [item.name, ...(item.aliases ?? [])];
    if (!terms.some((term) => normalizedQuery.includes(term.toLowerCase()))) {
      continue;
    }

    primaryKeywords.push(item.name);
    requestedItems.push({
      name: item.name,
      required: true,
      aliases: dedupeKeywords(item.aliases ?? []),
    });

    if (item.category) {
      acceptableCategories.push({ name: item.category, confidence: 0.75 });
      broadenedKeywords.push(item.category);
    }

    broadenedKeywords.push(...(item.broadened ?? []));
  }

  for (const definition of CATEGORY_DEFINITIONS) {
    const matchedAlias = definition.aliases.find((alias) =>
      normalizedQuery.includes(alias.toLowerCase())
    );
    if (!matchedAlias) {
      continue;
    }

    primaryKeywords.push(definition.name);
    acceptableCategories.push({ name: definition.name, confidence: 0.9 });
    relatedKeywords.push(...(definition.related ?? definition.aliases.filter((alias) => alias !== definition.name)));
    broadenedKeywords.push(...(definition.broadened ?? []));
    poiType ??= definition.poiType;
  }

  if (primaryKeywords.length === 0) {
    for (const expansion of TASTE_EXPANSIONS) {
      if (!expansion.patterns.some((pattern) => normalizedQuery.includes(pattern.toLowerCase()))) {
        continue;
      }

      primaryKeywords.push(...expansion.keywords);
      acceptableCategories.push(...expansion.keywords.map((keyword) => ({
        name: keyword,
        confidence: 0.65,
      })));
      if (expansion.preference) {
        softPreferences.push(expansion.preference);
      }
    }
  }

  return {
    requestedItems,
    acceptableCategories,
    primaryKeywords,
    relatedKeywords,
    broadenedKeywords,
    poiType,
    softPreferences,
  };
}

export function initialPlan(goal: UserGoal): SearchPlan {
  const radiusMeters = getGoalRadius(goal);

  return {
    keywords: goal.primaryKeywords.slice(0, 5),
    radiusMeters,
    poiType: goal.poiType,
    searchIntent: 'exact',
    allowedForPrimary: true,
    reason: '先搜索用户原始需求中最明确的餐饮类型。',
  };
}

export function normalizeSearchPlan(plan: SearchPlan, goal: UserGoal): SearchPlan | null {
  const keywords = removeExcludedKeywords(plan.keywords, goal).slice(0, 5);
  if (keywords.length === 0) {
    return null;
  }

  const maxStrictRadius = getStrictDistanceMaxMeters(goal);
  const requestedRadius = Number.isFinite(plan.radiusMeters)
    ? plan.radiusMeters
    : getGoalRadius(goal);
  const radiusMeters = maxStrictRadius !== undefined
    ? Math.min(requestedRadius, maxStrictRadius)
    : requestedRadius;
  const searchIntent = plan.searchIntent ?? 'exact';
  const isBroadenedIntent = searchIntent === 'broadened' || searchIntent === 'fallback';

  return {
    keywords,
    radiusMeters: clamp(Math.round(radiusMeters), 300, 5000),
    poiType: plan.poiType,
    searchIntent,
    allowedForPrimary: Boolean(plan.allowedForPrimary) && (!isBroadenedIntent || goal.allowBroaden),
    reason: plan.reason || 'Agent 决定继续搜索。',
  };
}

export function searchPlanKey(plan: SearchPlan): string {
  return `${plan.searchIntent}:${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
}

export function searchAttemptKey(attempt: {
  keywords: string[];
  radius: number;
  poiType?: string;
  searchIntent: string;
}): string {
  return `${attempt.searchIntent}:${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}`;
}

function parseDistanceConstraint(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): Constraint | null {
  const explicitKm = query.match(/(\d+(?:\.\d+)?)\s*(?:公里|km)/i);
  if (explicitKm) {
    const maxMeters = Math.round(Number(explicitKm[1]) * 1000);
    return {
      kind: 'distance',
      label: `${explicitKm[1]}公里内`,
      value: maxMeters,
      maxMeters,
      strict: true,
    };
  }

  const explicitMeters = query.match(/(\d{2,5})\s*(?:米|m)/i);
  if (explicitMeters) {
    const maxMeters = Number(explicitMeters[1]);
    return {
      kind: 'distance',
      label: `${explicitMeters[1]}米内`,
      value: maxMeters,
      maxMeters,
      strict: true,
    };
  }

  if (/下楼|楼下/.test(query)) {
    return { kind: 'distance', label: '楼下500米内', value: 500, maxMeters: 500, strict: true };
  }

  if (/步行|走路|几分钟/.test(query)) {
    return { kind: 'distance', label: '步行1公里内', value: 1000, maxMeters: 1000, strict: true };
  }

  if (/附近|很近|近一点/.test(query)) {
    return { kind: 'distance', label: '附近1200米内', value: 1200, maxMeters: 1200, strict: true };
  }

  if (/周边/.test(query)) {
    return { kind: 'distance', label: '周边2公里内', value: 2000, maxMeters: 2000, strict: false };
  }

  if (/稍远也行|远一点也行|可以远一点/.test(query)) {
    return { kind: 'distance', label: '可接受5公里内', value: 5000, maxMeters: 5000, strict: false };
  }

  if (preferenceSummary?.preferredDistanceMeters) {
    return {
      kind: 'distance',
      label: '历史偏好距离',
      value: preferenceSummary.preferredDistanceMeters,
      maxMeters: preferenceSummary.preferredDistanceMeters,
      strict: false,
    };
  }

  return null;
}

function parseBudgetConstraint(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): Constraint | null {
  const budgetMatch = query.match(/(?:预算|人均|每人|一人|每位)?\s*(\d{2,4})\s*(?:元|块|左右|以内)?/);
  const hasBudgetHint = /预算|人均|每人|一人|每位|元|块|以内/.test(query);

  if (budgetMatch && hasBudgetHint) {
    return {
      kind: 'budget',
      label: `预算${budgetMatch[1]}左右`,
      value: { max: Number(budgetMatch[1]) },
      max: Number(budgetMatch[1]),
      strict: false,
    };
  }

  if (preferenceSummary?.preferredPriceRange) {
    return {
      kind: 'budget',
      label: '历史偏好价格',
      value: preferenceSummary.preferredPriceRange,
      min: preferenceSummary.preferredPriceRange.min,
      max: preferenceSummary.preferredPriceRange.max,
      strict: false,
    };
  }

  return null;
}

function parseOpenNowConstraint(query: string): Constraint | null {
  if (!/营业中|还开|开门|现在开|没打烊|正在营业/.test(query)) {
    return null;
  }

  return {
    kind: 'open_now',
    label: '当前营业中',
    strict: false,
  };
}

function isAvoidingSpicy(query: string): boolean {
  return /清淡|不辣|少辣|别太辣|不要辣|不吃辣|不能吃辣|忌辣|不吃重口/.test(query);
}

function parseExclusions(query: string): string[] {
  return EXCLUDABLE_CATEGORIES.filter((category) => {
    const pattern = new RegExp(`(不吃|不要|别吃|不想吃|排除|避开).{0,3}${category}`);
    return pattern.test(query);
  });
}

function buildFallbackClarificationNeeds(
  query: string,
  hasAgentIntentSignal: boolean
): ClarificationNeed[] {
  if (!isOpenEndedQuery(query) || hasAgentIntentSignal) {
    return [];
  }

  return [
    {
      reason: '用户需求较开放，缺少可验证的菜品或品类目标。',
      question: '你想找哪类餐厅，或具体想吃什么？',
      allowFreeText: true,
    },
  ];
}

function isOpenEndedQuery(query: string): boolean {
  return /随便|都行|推荐|附近有什么|吃点|吃什么|不知道吃啥|你决定/.test(query);
}

function isBroadenPermission(query: string): boolean {
  return /可以放宽|放宽|扩大范围|扩大|远一点也行|稍远也行|候补也行|查看候补|看看候补/.test(query);
}

function getStrictDistanceMaxMeters(goal: UserGoal): number | undefined {
  const distanceConstraint = goal.hardConstraints.find((constraint) => constraint.kind === 'distance');
  if (!distanceConstraint?.strict) {
    return undefined;
  }

  return distanceConstraint.maxMeters
    ?? (typeof distanceConstraint.value === 'number' ? distanceConstraint.value : undefined);
}

function getGoalRadius(goal: UserGoal): number {
  const distanceConstraint = goal.hardConstraints.find((constraint) => constraint.kind === 'distance');
  if (typeof distanceConstraint?.value === 'number') {
    return clamp(distanceConstraint.value, 500, 5000);
  }

  return DEFAULT_RADIUS;
}

function removeExcludedKeywords(keywords: string[], goal: UserGoal): string[] {
  return dedupeKeywords(keywords).filter((keyword) => {
    if (goal.exclusions.some((exclusion) => keyword.includes(exclusion))) {
      return false;
    }

    const avoidingSpicy = goal.hardConstraints.some((constraint) => constraint.kind === 'avoid_spicy');
    if (avoidingSpicy && /川菜|湘菜|火锅|烧烤|串串|麻辣/.test(keyword)) {
      return false;
    }

    return true;
  });
}

function dedupeKeywords(keywords: string[]): string[] {
  return dedupeStrings(keywords.map((keyword) => keyword.trim()).filter(Boolean));
}

function dedupeRequestedItems(items: RequestedItem[]): RequestedItem[] {
  const byName = new Map<string, RequestedItem>();

  for (const item of items) {
    const name = item.name.trim();
    if (!name) {
      continue;
    }

    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, {
        name,
        required: item.required ?? true,
        aliases: dedupeKeywords(item.aliases ?? []),
      });
      continue;
    }

    existing.required = existing.required || item.required;
    existing.aliases = dedupeKeywords([...existing.aliases, ...(item.aliases ?? [])]);
  }

  return Array.from(byName.values());
}

function dedupeGoalCategories(categories: GoalCategory[]): GoalCategory[] {
  const byName = new Map<string, GoalCategory>();

  for (const category of categories) {
    const name = category.name.trim();
    if (!name) {
      continue;
    }

    const confidence = clamp(category.confidence ?? 0.7, 0, 1);
    const existing = byName.get(name);
    byName.set(name, {
      name,
      confidence: existing ? Math.max(existing.confidence, confidence) : confidence,
    });
  }

  return Array.from(byName.values());
}

function dedupeAlternativeGroups(groups: AlternativeGroup[]): AlternativeGroup[] {
  const result: AlternativeGroup[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    const items = dedupeKeywords(group.items ?? []);
    if (items.length === 0) {
      continue;
    }

    const normalized = {
      mode: group.mode,
      items,
      minPerGroup: group.minPerGroup,
    };
    const key = `${normalized.mode}:${normalized.items.join('|')}:${normalized.minPerGroup ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(normalized);
    }
  }

  return result;
}

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
