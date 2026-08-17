/**
 * Agent 离线评测集类型。
 *
 * 评测的对象是 **loop 行为**，不是模型质量：给定确定的目标理解与确定的
 * 高德返回，agent 走了几轮、评估了几次、有没有重复评估、最终推了几家。
 * 这些正是 M2/M3/M4 会改变的量，也正是单测覆盖不到的量。
 */

import type { Location, Restaurant } from '@/types';

/** 桩 Supervisor 要返回的目标。字段是 UserGoal 的最小子集，其余按空值补齐。 */
export interface StubGoal {
  primaryKeywords?: string[];
  requestedItems?: string[];
  acceptableCategories?: string[];
  exclusions?: string[];
  allowBroaden?: boolean;
  /** 严格距离约束（米） */
  strictDistanceMeters?: number;
  /** 非空时 Supervisor 直接追问，不进入 loop */
  clarifyingQuestion?: string;
  /**
   * 非空时 Supervisor 桩直接抛错（模拟模型不可用）。
   *
   * 用于锁死"理解不了就报错、不猜"这条不变量：不能有任何降级搜索。
   */
  failWithCode?: string;
}

/** 桩 KeywordExpansion 要返回的联想词。 */
export interface StubExpansion {
  related?: string[];
  broadened?: string[];
}

export interface EvalTurn {
  message: string;
  /** offline 模式下 Supervisor 桩的输出；live 模式忽略 */
  stubGoal?: StubGoal;
  /** offline 模式下 KeywordExpansion 桩的输出；live 模式忽略 */
  stubExpansion?: StubExpansion;
  /** 非空时候选验证桩直接抛错（模拟验证服务不可用） */
  stubEvaluationError?: string;
  /** 点击追问选项而不是输入文本时的选项 id */
  optionId?: string;
  expect?: EvalExpectation;
}

export interface EvalExpectation {
  /** 该轮是否应当追问用户 */
  shouldAsk?: boolean;
  /** 主推荐最少条数 */
  minPrimary?: number;
  /** 主推荐最多条数 */
  maxPrimary?: number;
  /** 候补最少条数 */
  minBackup?: number;
  /** 主推荐中必须出现的菜系（任一命中即可） */
  anyCuisine?: string[];
  /** 主推荐中不允许出现的菜系 */
  noCuisine?: string[];
  /** 搜索轮数上限 */
  maxSearchRounds?: number;
  /** 同一餐厅是否允许被重复送评估 */
  allowDuplicateEvaluation?: boolean;
  /** 该轮应当以错误结束，并带上这个错误码 */
  failsWithCode?: string;
  /** 该轮最多允许发起几次高德搜索 */
  maxSearchCalls?: number;
  /** 该轮最多允许调用几次候选验证 */
  maxEvaluationCalls?: number;
}

export interface EvalCase {
  id: string;
  description: string;
  location?: Location;
  turns: EvalTurn[];
}

export interface TurnMetricsSnapshot {
  askedUser: boolean;
  primaryCount: number;
  backupCount: number;
  /** attempts 数量：一共搜了几个关键词 */
  searchRounds: number;
  /**
   * 串行搜索步数：一共发起了几个 search action。
   *
   * 与 searchRounds 的差就是 fan-out 的收益——同一批里并发铺开的关键词
   * 只算一步，用户等的是步数不是关键词数。
   */
  searchSteps: number;
  /** searchPlaces 实际被调用次数 */
  searchCalls: number;
  /** 单个时刻最多有几个搜索在飞 */
  maxConcurrentSearches: number;
  /** planner 走模型决策的次数（M3 后应为 0） */
  plannerModelCalls: number;
  /** EvaluationModel 被调用次数 */
  evaluationCalls: number;
  /** 送进 EvaluationModel 的餐厅条目总数（含重复） */
  evaluatedSlots: number;
  /** 送进 EvaluationModel 的不同餐厅数 */
  evaluatedDistinct: number;
  /** evaluatedSlots - evaluatedDistinct，M2 后应为 0 */
  duplicateEvaluations: number;
  /** 模型调用串行步数（区间合并后），live 模式才有意义 */
  serialModelSteps: number;
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  wallMs: number;
}

export interface EvalTurnResult {
  message: string;
  passed: boolean;
  failures: string[];
  metrics: TurnMetricsSnapshot;
  primaryNames: string[];
  question?: string;
}

export interface EvalCaseResult {
  caseId: string;
  description: string;
  passed: boolean;
  turns: EvalTurnResult[];
}

export interface EvalSuiteResult {
  mode: 'offline' | 'live';
  passed: number;
  failed: number;
  cases: EvalCaseResult[];
  totals: Pick<
    TurnMetricsSnapshot,
    | 'searchRounds'
    | 'searchSteps'
    | 'searchCalls'
    | 'plannerModelCalls'
    | 'evaluationCalls'
    | 'evaluatedSlots'
    | 'duplicateEvaluations'
    | 'modelCalls'
    | 'serialModelSteps'
  > & { askRate: number };
}

/** fixture 文件：搜索关键词 → 高德会返回的餐厅。刻意包含跨关键词重叠。 */
export type AmapFixture = Record<string, FixtureRestaurant[]>;

export interface FixtureRestaurant {
  id: string;
  name: string;
  cuisineType: string;
  distance: number;
  address?: string;
  rating?: number;
  averagePrice?: number;
  businessStatus?: Restaurant['businessStatus'];
  poiTypeCode?: string;
}
