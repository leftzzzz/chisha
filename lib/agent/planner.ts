import type {
  AgentContext,
  Constraint,
  Observation,
  Preference,
  SearchPlan,
  UserGoal,
  UserPreferenceSummary,
} from './types';

interface KeywordRule {
  match: RegExp;
  primary: string[];
  related?: string[];
  broadened?: string[];
  poiType?: string;
  preference?: string;
}

const KEYWORD_RULES: KeywordRule[] = [
  {
    match: /潮汕牛肉火锅/,
    primary: ['潮汕牛肉火锅'],
    related: ['牛肉火锅'],
    broadened: ['火锅'],
    poiType: '050117',
  },
  {
    match: /牛肉火锅/,
    primary: ['牛肉火锅'],
    related: ['潮汕牛肉火锅'],
    broadened: ['火锅'],
    poiType: '050117',
  },
  {
    match: /火锅/,
    primary: ['火锅'],
    related: ['牛肉火锅', '串串'],
    broadened: ['中餐'],
    poiType: '050117',
  },
  {
    match: /日料|日本料理|日本菜/,
    primary: ['日料', '日本料理'],
    related: ['寿司', '拉面'],
    broadened: ['亚洲料理'],
    poiType: '050201',
  },
  { match: /寿司/, primary: ['寿司'], related: ['日料'], broadened: ['日本料理'] },
  { match: /拉面/, primary: ['拉面'], related: ['日料'], broadened: ['日本料理'] },
  { match: /川菜/, primary: ['川菜'], broadened: ['中餐'], poiType: '050102' },
  { match: /湘菜/, primary: ['湘菜'], broadened: ['中餐'], poiType: '050109' },
  { match: /粤菜|广东菜/, primary: ['粤菜'], related: ['茶餐厅'], broadened: ['中餐'], poiType: '050103' },
  { match: /江浙菜|杭帮菜|浙江菜/, primary: ['江浙菜'], related: ['杭帮菜'], broadened: ['中餐'], poiType: '050106' },
  { match: /烧烤|烤串/, primary: ['烧烤'], related: ['烤肉'], broadened: ['中餐'], poiType: '050700' },
  { match: /韩餐|韩国料理|烤肉/, primary: ['韩餐', '韩国料理'], related: ['烤肉'], broadened: ['亚洲料理'], poiType: '050202' },
  { match: /西餐|牛排|意面|披萨/, primary: ['西餐'], related: ['牛排', '意面', '披萨'], poiType: '050203' },
  { match: /咖啡/, primary: ['咖啡'], related: ['咖啡厅'], poiType: '050401' },
  { match: /奶茶|饮品/, primary: ['奶茶'], related: ['饮品'], poiType: '050307' },
  { match: /甜品|蛋糕|烘焙/, primary: ['甜品'], related: ['蛋糕', '面包甜点'], poiType: '050600' },
  { match: /快餐|赶时间|快点|简单/, primary: ['快餐', '简餐'], related: ['面馆', '小吃'], poiType: '050300' },
  { match: /小吃|夜宵/, primary: ['小吃'], related: ['简餐'], poiType: '050310' },
  { match: /面馆|吃面|面条/, primary: ['面馆'], related: ['牛肉面', '拉面'], poiType: '050300' },
  { match: /粥|养生/, primary: ['粥'], related: ['粤菜', '轻食'] },
  { match: /素食|素菜/, primary: ['素食'], related: ['轻食'], poiType: '050119' },
  { match: /轻食|沙拉|低卡/, primary: ['轻食', '沙拉'], related: ['健康餐'] },
  { match: /东北菜/, primary: ['东北菜'], broadened: ['中餐'], poiType: '050113' },
  { match: /清真/, primary: ['清真'], related: ['兰州拉面'], poiType: '050116' },
  { match: /海鲜/, primary: ['海鲜'], broadened: ['中餐'], poiType: '050118' },
];

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
  preferenceSummary?: UserPreferenceSummary
): UserGoal {
  const hardConstraints: Constraint[] = [];
  const softPreferences: Preference[] = [];
  const exclusions = parseExclusions(query);
  const ambiguity: string[] = [];
  const avoidSpicy = isAvoidingSpicy(query);
  const matchedRule = KEYWORD_RULES.find((rule) => rule.match.test(query));
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
    });
  }

  let primaryKeywords = matchedRule?.primary ?? [];
  let relatedKeywords = matchedRule?.related ?? [];
  let broadenedKeywords = matchedRule?.broadened ?? [];

  if (avoidSpicy && primaryKeywords.length === 0) {
    primaryKeywords = ['粤菜', '江浙菜', '日料', '轻食', '粥'];
    relatedKeywords = ['茶餐厅', '素食'];
    broadenedKeywords = ['餐厅'];
  }

  if (/约会|情侣/.test(query)) {
    softPreferences.push({ name: '适合约会', weight: 2, verifiable: false });
    if (primaryKeywords.length === 0) {
      primaryKeywords = ['西餐', '日料', '咖啡'];
      relatedKeywords = ['甜品'];
    }
    ambiguity.push('环境、安静程度和氛围当前只能从餐厅类型弱推断，不能保证。');
  }

  if (/聚餐|朋友|多人/.test(query)) {
    softPreferences.push({ name: '适合聚餐', weight: 2, verifiable: false });
    if (primaryKeywords.length === 0) {
      primaryKeywords = avoidSpicy ? ['粤菜', '江浙菜', '中餐'] : ['中餐', '粤菜', '火锅'];
      relatedKeywords = ['海鲜'];
    }
  }

  if (/环境|安静|聊天|氛围/.test(query)) {
    softPreferences.push({ name: '环境或安静', weight: 1, verifiable: false });
    ambiguity.push('环境好、安静和适合聊天目前缺少可靠外部字段，只会标注为不确定。');
  }

  if (/随便|都行|推荐|附近有什么|吃点|吃什么/.test(query) && primaryKeywords.length === 0) {
    const favoriteKeywords = preferenceSummary?.favoriteCuisines
      ?.filter((item) => item.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 2)
      .map((item) => item.name) ?? [];

    primaryKeywords = favoriteKeywords.length > 0
      ? favoriteKeywords
      : ['餐厅', '小吃', '简餐'];
    relatedKeywords = ['中餐', '面馆'];
    broadenedKeywords = ['美食'];
    softPreferences.push({ name: '默认多样性', weight: 1, verifiable: true });
  }

  if (primaryKeywords.length === 0) {
    primaryKeywords = ['餐厅', '美食'];
    relatedKeywords = ['小吃', '简餐'];
    softPreferences.push({ name: '默认多样性', weight: 1, verifiable: true });
  }

  return {
    intent: 'find_restaurants',
    rawQuery: query,
    primaryKeywords: dedupeKeywords(primaryKeywords),
    relatedKeywords: dedupeKeywords(relatedKeywords),
    broadenedKeywords: dedupeKeywords(broadenedKeywords),
    hardConstraints,
    softPreferences,
    exclusions,
    ambiguity: dedupeStrings(ambiguity),
  };
}

export function initialPlan(goal: UserGoal): SearchPlan {
  const radiusMeters = getGoalRadius(goal);
  const poiType = getPoiTypeForKeywords(goal.primaryKeywords);

  return {
    keywords: goal.primaryKeywords.slice(0, 5),
    radiusMeters,
    poiType,
    searchIntent: 'exact',
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
      poiType: getPoiTypeForKeywords(context.goal.relatedKeywords),
      searchIntent: 'synonym',
      reason: '原关键词结果不足，尝试同义词或相邻品类。',
    });
  }

  if (context.goal.broadenedKeywords.length > 0) {
    add({
      keywords: context.goal.broadenedKeywords,
      radiusMeters: Math.max(radiusMeters, 2200),
      poiType: getPoiTypeForKeywords(context.goal.broadenedKeywords),
      searchIntent: 'broadened',
      reason: '精确结果不足，向上放宽到更大的餐饮品类。',
    });
  }

  if (radiusMeters < 3000) {
    add({
      keywords: observation.plan.searchIntent === 'exact'
        ? context.goal.primaryKeywords
        : observation.plan.keywords,
      radiusMeters: 3000,
      poiType: observation.plan.poiType,
      searchIntent: observation.plan.searchIntent === 'fallback'
        ? 'fallback'
        : 'broadened',
      reason: '附近结果质量或数量不足，扩大搜索半径。',
    });
  }

  const isVague = context.goal.softPreferences.some((preference) => preference.name === '默认多样性');
  if (isVague) {
    add({
      keywords: ['餐厅', '小吃', '简餐'],
      radiusMeters: Math.max(radiusMeters, 2500),
      searchIntent: 'fallback',
      reason: '需求较开放，补充通用餐饮候选以保证选择面。',
    });
  }

  if (context.candidates.length === 0) {
    add({
      keywords: context.goal.broadenedKeywords.length > 0
        ? context.goal.broadenedKeywords
        : ['餐厅'],
      radiusMeters: 3500,
      searchIntent: 'fallback',
      reason: '前几轮没有可接受结果，保留硬约束后做兜底搜索。',
    });
  }

  return dedupePlans(candidates);
}

function parseDistanceConstraint(
  query: string,
  preferenceSummary?: UserPreferenceSummary
): Constraint | null {
  const explicitKm = query.match(/(\d+(?:\.\d+)?)\s*公里/);
  if (explicitKm) {
    return {
      kind: 'distance',
      label: `${explicitKm[1]}公里内`,
      value: Math.round(Number(explicitKm[1]) * 1000),
    };
  }

  const explicitMeters = query.match(/(\d{3,5})\s*米/);
  if (explicitMeters) {
    return {
      kind: 'distance',
      label: `${explicitMeters[1]}米内`,
      value: Number(explicitMeters[1]),
    };
  }

  if (/附近|很近|近一点|走路/.test(query)) {
    return { kind: 'distance', label: '附近', value: 1200 };
  }

  if (preferenceSummary?.preferredDistanceMeters) {
    return {
      kind: 'distance',
      label: '历史偏好距离',
      value: preferenceSummary.preferredDistanceMeters,
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
    };
  }

  if (preferenceSummary?.preferredPriceRange) {
    return {
      kind: 'budget',
      label: '历史偏好价格',
      value: preferenceSummary.preferredPriceRange,
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

function getGoalRadius(goal: UserGoal): number {
  const distanceConstraint = goal.hardConstraints.find((constraint) => constraint.kind === 'distance');
  if (typeof distanceConstraint?.value === 'number') {
    return clamp(distanceConstraint.value, 500, 5000);
  }

  return DEFAULT_RADIUS;
}

function getPoiTypeForKeywords(keywords: string[]): string | undefined {
  const matchingRule = KEYWORD_RULES.find((rule) =>
    rule.poiType && rule.primary.some((keyword) => keywords.includes(keyword))
  );

  return matchingRule?.poiType;
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

function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
