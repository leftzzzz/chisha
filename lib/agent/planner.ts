import type {
  AgentContext,
  AlternativeGroup,
  ClarificationNeed,
  Constraint,
  GoalCategory,
  Observation,
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

export function parseUserGoal(
  query: string,
  preferenceSummary?: UserPreferenceSummary,
  agentGoal: AgentGoalDraft = {}
): UserGoal {
  const hardConstraints: Constraint[] = [];
  const softPreferences: Preference[] = [...(agentGoal.softPreferences ?? [])];
  const exclusions = parseExclusions(query);
  const ambiguity: string[] = [...(agentGoal.ambiguity ?? [])];
  const avoidSpicy = isAvoidingSpicy(query);
  const requestedItems = dedupeRequestedItems(agentGoal.requestedItems ?? []);
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

  let primaryKeywords = dedupeKeywords(agentGoal.primaryKeywords ?? []);
  const relatedKeywords = dedupeKeywords(agentGoal.relatedKeywords ?? []);
  const broadenedKeywords = dedupeKeywords(agentGoal.broadenedKeywords ?? []);
  const hasAgentIntentSignal = primaryKeywords.length > 0
    || requestedItems.length > 0
    || Boolean(agentGoal.acceptableCategories?.length);

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
  const acceptableCategories = dedupeGoalCategories(agentGoal.acceptableCategories ?? []);
  const alternativeGroups = dedupeAlternativeGroups(agentGoal.alternativeGroups ?? []);
  const allowBroaden = agentGoal.allowBroaden ?? (isOpenEndedQuery(query) || isBroadenPermission(query));
  const clarificationNeeded = agentGoal.clarificationNeeded?.length
    ? agentGoal.clarificationNeeded
    : buildFallbackClarificationNeeds(query, hasAgentIntentSignal);

  return {
    intent: 'find_restaurants',
    rawQuery: query,
    poiType: agentGoal.poiType,
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

export function nextPlan(context: AgentContext, observation: Observation): SearchPlan | null {
  if (context.attempts.length >= context.maxSearchCalls) {
    return null;
  }

  const tried = new Set(context.attempts.map(planKeyFromAttempt));
  const candidates = buildPlanCandidates(context, observation);
  return candidates.find((candidate) => !tried.has(planKey(candidate))) ?? null;
}

function buildPlanCandidates(context: AgentContext, observation: Observation): SearchPlan[] {
  const radiusMeters = getGoalRadius(context.goal);
  const canExpandRadius = canSafelyExpandRadius(context.goal);
  const candidates: SearchPlan[] = [];
  const add = (plan: SearchPlan) => {
    const cleaned = removeExcludedKeywords(plan.keywords, context.goal);
    if (cleaned.length > 0) {
      candidates.push({ ...plan, keywords: cleaned.slice(0, 5) });
    }
  };

  if (context.goal.relatedKeywords.length > 0) {
    add({
      keywords: context.goal.relatedKeywords,
      radiusMeters,
      poiType: context.goal.poiType,
      searchIntent: 'synonym',
      allowedForPrimary: true,
      reason: '原关键词结果不足，尝试同义词或相邻品类。',
    });
  }

  if (context.goal.broadenedKeywords.length > 0) {
    add({
      keywords: context.goal.broadenedKeywords,
      radiusMeters: context.goal.allowBroaden && canExpandRadius
        ? Math.max(radiusMeters, 2200)
        : radiusMeters,
      searchIntent: 'broadened',
      allowedForPrimary: context.goal.allowBroaden,
      reason: '精确结果不足，向上放宽到更大的餐饮品类。',
    });
  }

  if (canExpandRadius && radiusMeters < 3000) {
    add({
      keywords: observation.plan.searchIntent === 'exact'
        ? context.goal.primaryKeywords
        : observation.plan.keywords,
      radiusMeters: 3000,
      poiType: observation.plan.poiType,
      searchIntent: observation.plan.searchIntent === 'fallback'
        ? 'fallback'
        : 'broadened',
      allowedForPrimary: context.goal.allowBroaden,
      reason: '附近结果质量或数量不足，扩大搜索半径。',
    });
  }

  const isVague = context.goal.softPreferences.some((preference) => preference.name === '默认多样性');
  if (isVague) {
    add({
      keywords: ['餐厅', '小吃', '简餐'],
      radiusMeters: Math.max(radiusMeters, 2500),
      searchIntent: 'fallback',
      allowedForPrimary: context.goal.allowBroaden,
      reason: '需求较开放，补充通用餐饮候选以保证选择面。',
    });
  }

  if (context.candidates.length === 0) {
    add({
      keywords: context.goal.broadenedKeywords.length > 0
        ? context.goal.broadenedKeywords
        : ['餐厅'],
      radiusMeters: canExpandRadius ? 3500 : radiusMeters,
      searchIntent: 'fallback',
      allowedForPrimary: context.goal.allowBroaden,
      reason: '前几轮没有可接受结果，保留硬约束后做兜底搜索。',
    });
  }

  return dedupePlans(candidates);
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
      question: '想吃正餐、小吃，还是喝点东西？',
      options: [
        { label: '正餐', value: '正餐', effect: { addCategories: ['正餐'] } },
        { label: '小吃', value: '小吃', effect: { addCategories: ['小吃'] } },
        { label: '喝点东西', value: '喝点东西', effect: { addCategories: ['饮品'] } },
      ],
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

function canSafelyExpandRadius(goal: UserGoal): boolean {
  const distanceConstraint = goal.hardConstraints.find((constraint) => constraint.kind === 'distance');
  return !distanceConstraint?.strict;
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

function planKey(plan: SearchPlan): string {
  return `${plan.searchIntent}:${plan.keywords.join('|')}:${plan.radiusMeters}:${plan.poiType ?? ''}`;
}

function planKeyFromAttempt(attempt: { keywords: string[]; radius: number; poiType?: string; searchIntent: string }): string {
  return `${attempt.searchIntent}:${attempt.keywords.join('|')}:${attempt.radius}:${attempt.poiType ?? ''}`;
}

function dedupePlans(plans: SearchPlan[]): SearchPlan[] {
  const seen = new Set<string>();
  const result: SearchPlan[] = [];

  for (const plan of plans) {
    const key = planKey(plan);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(plan);
    }
  }

  return result;
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
