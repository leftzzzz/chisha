import type {
  PlanningAgentOutput,
  SearchPlan,
  SearchTarget,
  UserGoal,
} from './types';
import { SearchPlanSchema } from './schemas/plan';

export const DEFAULT_POI_TYPE = '050000';
export const MAX_SEARCH_KEYWORDS = 5;
export const MAX_POI_PAGES = 5;
export const MAX_SEARCH_REQUESTS_PER_CALL = 8;

const KEYWORD_SPLIT_PATTERN = /[|｜、,，;；/／]|\s+(?:or|and)\s+|(?:或者|还是|以及|跟|或)/i;
const GENERIC_KEYWORDS = new Set(['餐厅', '美食']);

interface PoiTaxonomyEntry {
  canonical: string;
  terms: string[];
  poiTypes: string[];
  targetKinds: SearchTarget['kind'][];
}

export const POI_TAXONOMY: PoiTaxonomyEntry[] = [
  { canonical: '江浙菜', terms: ['江浙菜'], poiTypes: ['050105', '050106'], targetKinds: ['cuisine'] },
  { canonical: '川菜', terms: ['川菜', '川味', '麻辣'], poiTypes: ['050102'], targetKinds: ['cuisine'] },
  { canonical: '粤菜', terms: ['粤菜', '广东菜', '茶餐厅', '烧腊', '点心'], poiTypes: ['050103'], targetKinds: ['cuisine'] },
  { canonical: '湘菜', terms: ['湘菜', '湖南菜'], poiTypes: ['050109'], targetKinds: ['cuisine'] },
  { canonical: '鲁菜', terms: ['鲁菜', '山东菜'], poiTypes: ['050104'], targetKinds: ['cuisine'] },
  { canonical: '苏菜', terms: ['苏菜', '江苏菜'], poiTypes: ['050105'], targetKinds: ['cuisine'] },
  { canonical: '浙菜', terms: ['浙菜', '杭帮菜', '浙江菜'], poiTypes: ['050106'], targetKinds: ['cuisine'] },
  { canonical: '闽菜', terms: ['闽菜', '福建菜'], poiTypes: ['050108'], targetKinds: ['cuisine'] },
  { canonical: '徽菜', terms: ['徽菜', '安徽菜'], poiTypes: ['050107'], targetKinds: ['cuisine'] },
  { canonical: '火锅', terms: ['火锅', '涮锅', '牛肉火锅', '潮汕牛肉火锅', '串串'], poiTypes: ['050117'], targetKinds: ['dish', 'cuisine', 'restaurant_type'] },
  { canonical: '日本料理', terms: ['日料', '日本料理', '日本菜', '寿司', '刺身', '日式拉面', '拉面'], poiTypes: ['050201'], targetKinds: ['dish', 'cuisine'] },
  { canonical: '韩国料理', terms: ['韩餐', '韩国料理', '韩式', '石锅拌饭', '韩式烤肉'], poiTypes: ['050202'], targetKinds: ['dish', 'cuisine'] },
  { canonical: '西餐', terms: ['西餐', '牛排', '意面', '披萨', '比萨', '意大利菜'], poiTypes: ['050203'], targetKinds: ['dish', 'cuisine'] },
  { canonical: '烧烤', terms: ['烧烤', '烤串', '烤肉', 'bbq'], poiTypes: ['050700'], targetKinds: ['dish', 'restaurant_type'] },
  { canonical: '快餐', terms: ['快餐', '汉堡', '炸鸡', '薯条', '鸡排'], poiTypes: ['050300'], targetKinds: ['dish', 'restaurant_type'] },
  { canonical: '小吃', terms: ['小吃', '麻辣烫', '冒菜', '米线'], poiTypes: ['050310'], targetKinds: ['dish', 'restaurant_type'] },
  { canonical: '咖啡', terms: ['咖啡', '咖啡店', '咖啡厅'], poiTypes: ['050401'], targetKinds: ['restaurant_type'] },
  { canonical: '奶茶', terms: ['奶茶', '果茶', '柠檬茶'], poiTypes: ['050307'], targetKinds: ['dish', 'restaurant_type'] },
  { canonical: '饮品', terms: ['饮品', '喝点', '喝的'], poiTypes: ['050307', '050401'], targetKinds: ['restaurant_type'] },
  { canonical: '甜品', terms: ['甜品', '甜点', '蛋糕', '面包', '烘焙'], poiTypes: ['050600'], targetKinds: ['dish', 'restaurant_type'] },
  { canonical: '海鲜', terms: ['海鲜', '小龙虾', '龙虾'], poiTypes: ['050118'], targetKinds: ['dish', 'cuisine'] },
  { canonical: '素食', terms: ['素食', '素菜'], poiTypes: ['050119'], targetKinds: ['cuisine'] },
  { canonical: '清真', terms: ['清真', '兰州拉面'], poiTypes: ['050116'], targetKinds: ['cuisine', 'restaurant_type'] },
];

export function normalizeSearchKeywords(keywords: string[]): string[] {
  const normalized = Array.from(new Set(
    keywords.flatMap(normalizeKeywordText).filter(Boolean)
  )).slice(0, MAX_SEARCH_KEYWORDS);

  return normalized.length > 0 ? normalized : ['餐厅'];
}

export function extractKnownFoodTerms(text: string): string[] {
  const normalizedText = text.trim().toLowerCase();
  if (!normalizedText) {
    return [];
  }

  const candidates = POI_TAXONOMY.flatMap((entry) =>
    entry.terms.map((term) => ({
      term,
      start: normalizedText.indexOf(term.toLowerCase()),
    }))
  )
    .filter((match) => match.start >= 0)
    .sort((left, right) =>
      left.start - right.start || right.term.length - left.term.length
    );

  const selected: Array<{ term: string; start: number; end: number }> = [];
  for (const candidate of candidates) {
    const end = candidate.start + candidate.term.length;
    const overlaps = selected.some((item) =>
      candidate.start < item.end && end > item.start
    );
    if (!overlaps) {
      selected.push({ ...candidate, end });
    }
  }

  return Array.from(new Set(selected.map((item) => normalizeKnownTerm(item.term))));
}

export function isGenericSearchKeyword(keyword: string): boolean {
  return GENERIC_KEYWORDS.has(keyword.trim());
}

function normalizeKeywordText(keyword: string): string[] {
  const trimmedKeyword = keyword.trim();
  if (!trimmedKeyword) {
    return [];
  }

  const segments = trimmedKeyword
    .split(KEYWORD_SPLIT_PATTERN)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const searchSegments = segments.length > 0 ? segments : [trimmedKeyword];
  const normalized: string[] = [];

  for (const segment of searchSegments) {
    const knownTerms = extractKnownFoodTerms(segment);
    if (knownTerms.length > 0) {
      normalized.push(...knownTerms);
      continue;
    }

    const stripped = stripSearchIntentWords(segment);
    if (!stripped) {
      continue;
    }

    const strippedTerms = extractKnownFoodTerms(stripped);
    normalized.push(...(strippedTerms.length > 0 ? strippedTerms : [stripped]));
  }

  return normalized;
}

function stripSearchIntentWords(text: string): string {
  return text
    .trim()
    .replace(/^(我|我们|一个|一家|个|附近|周边|今天|今晚|中午|晚上|午餐|晚餐|夜宵|现在|随便|都行|想要|想|要|找|搜|搜索|推荐|来点|吃点|吃|喝点|喝|有没有|有啥|有什么)+/u, '')
    .replace(/(附近|周边|好吃的|吃的|喝的|一点|一些|吧|吗|呢|呀|啊|的)+$/u, '')
    .trim();
}

function normalizeKnownTerm(term: string): string {
  if (term === '喝点' || term === '喝的') {
    return '饮品';
  }

  return term;
}

export function getPagesPerKeyword(keywordCount: number, requestedPages: number): number {
  if (keywordCount <= 1) {
    return requestedPages;
  }

  return Math.max(
    1,
    Math.min(requestedPages, Math.floor(MAX_SEARCH_REQUESTS_PER_CALL / keywordCount))
  );
}

export function resolvePoiTypesForKeyword(
  keyword: string,
  fallbackPoiType: string | undefined,
  hasMultipleKeywords: boolean
): string {
  const keywordPoiType = lookupFoodPoiTypes(keyword);
  if (keywordPoiType) {
    return keywordPoiType;
  }

  if (!hasMultipleKeywords && fallbackPoiType) {
    return fallbackPoiType;
  }

  return DEFAULT_POI_TYPE;
}

export function lookupFoodPoiTypes(keyword: string): string | undefined {
  const normalizedKeyword = keyword.toLowerCase();
  const matcher = POI_TAXONOMY.find(({ terms }) =>
    terms.some((term) => normalizedKeyword.includes(term.toLowerCase()))
  );

  return matcher ? matcher.poiTypes.join('|') : undefined;
}

export function canonicalizePoiTerm(term: string): string {
  const normalizedTerm = term.trim().toLowerCase();
  const entry = POI_TAXONOMY.find(({ terms, canonical }) =>
    canonical.toLowerCase() === normalizedTerm
    || terms.some((alias) => alias.toLowerCase() === normalizedTerm)
  );

  return entry?.canonical ?? term.trim();
}

export function getPoiTerms(term: string): string[] {
  const normalizedTerm = term.trim().toLowerCase();
  const entry = POI_TAXONOMY.find(({ terms, canonical }) =>
    canonical.toLowerCase() === normalizedTerm
    || terms.some((alias) => alias.toLowerCase() === normalizedTerm)
  );

  return entry ? Array.from(new Set([entry.canonical, ...entry.terms])) : [term.trim()].filter(Boolean);
}

export function resolvePlansWithPoiTaxonomy(
  planningOutput: PlanningAgentOutput,
  goal: UserGoal
): SearchPlan[] {
  const plans: SearchPlan[] = [];

  for (const plan of planningOutput.plans) {
    const keywords = normalizeSearchKeywords(plan.targets.map((target) => target.label));
    const poiType = keywords.length === 1
      ? lookupFoodPoiTypes(keywords[0]) ?? goal.poiType
      : undefined;
    const parsed = SearchPlanSchema.safeParse({
      keywords,
      radiusMeters: plan.radiusMeters,
      poiType,
      searchIntent: plan.searchIntent,
      allowedForPrimary: plan.allowedForPrimary,
      reason: plan.reason,
    });

    if (parsed.success) {
      plans.push(parsed.data);
    }
  }

  return plans;
}
