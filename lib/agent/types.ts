import type { Location, Restaurant } from '@/types';
import type { FinishReason } from './finishReason';
import type { ModelCallMetrics } from './metrics';

export type SearchIntent = 'exact' | 'synonym' | 'broadened' | 'fallback';

export type AuthorizationScopeKind =
  | 'distance_expansion'
  | 'category_broaden'
  | 'fallback_primary'
  | 'unverified_backup_only';

export interface AgentAuthorization {
  id: string;
  kind: AuthorizationScopeKind;
  createdAt: number;
  sourceQuestionId?: string;
  reason: string;
  constraints?: {
    maxMeters?: number;
    allowedSearchIntents?: SearchIntent[];
    allowedKeywords?: string[];
  };
}

export interface UserPreferenceSummary {
  favoriteCuisines?: Array<{ name: string; weight: number }>;
  avoidedCuisines?: Array<{ name: string; weight: number }>;
  preferredDistanceMeters?: number;
  preferredPriceRange?: { min?: number; max?: number };
  recentSelectedRestaurants?: string[];
  recentRejectedRestaurants?: string[];
}

export type ConstraintKind =
  | 'distance'
  | 'avoid_spicy'
  | 'exclude_category'
  | 'budget'
  | 'open_now';

export interface Constraint {
  kind: ConstraintKind;
  label: string;
  value?: string | number | boolean | string[] | { min?: number; max?: number };
  strict?: boolean;
  maxMeters?: number;
  values?: string[];
  min?: number;
  max?: number;
}

export interface Preference {
  name: string;
  weight: number;
  verifiable: boolean;
}

export interface RequestedItem {
  name: string;
  required: boolean;
  aliases: string[];
}

export interface GoalCategory {
  name: string;
  confidence: number;
}

export interface AlternativeGroup {
  mode: 'any_of' | 'all_of';
  items: string[];
  minPerGroup?: number;
}

export interface GoalPatch {
  replaceRequestedItems?: RequestedItem[];
  replaceCategories?: GoalCategory[];
  replacePrimaryKeywords?: string[];
  addRequestedItems?: RequestedItem[];
  addCategories?: GoalCategory[];
  addSoftPreferences?: Preference[];
  addConstraints?: Constraint[];
  removeConstraints?: string[];
  addAuthorizations?: AgentAuthorization[];
  allowBroaden?: boolean;
  reason: string;
}

export type ConversationMode =
  | 'continue_current_goal'
  | 'patch_current_goal'
  | 'start_new_goal';

export interface SearchKeywordTarget {
  keyword: string;
  poiTypes?: string[];
  confidence?: number;
  reason?: string;
}

export interface ClarificationEffect {
  replaceRequestedItems?: string[];
  replaceCategories?: string[];
  replacePrimaryKeywords?: string[];
  addRequestedItems?: string[];
  addCategories?: string[];
  addSoftPreferences?: Preference[];
  setDistanceMaxMeters?: number;
  addAuthorizations?: AgentAuthorization[];
  allowBroaden?: boolean;
}

export interface ClarificationOption {
  label: string;
  value: string;
  effect?: ClarificationEffect;
}

export interface ClarificationNeed {
  reason: string;
  question: string;
  options?: ClarificationOption[];
  allowFreeText: boolean;
}

export interface UserGoal {
  intent: 'find_restaurants';
  goalId?: string;
  goalVersion?: number;
  goalSignature?: string;
  rawQuery: string;
  poiType?: string;
  requestedItems: RequestedItem[];
  acceptableCategories: GoalCategory[];
  alternativeGroups: AlternativeGroup[];
  primaryKeywords: string[];
  relatedKeywords: string[];
  broadenedKeywords: string[];
  relatedTargets?: SearchKeywordTarget[];
  broadenedTargets?: SearchKeywordTarget[];
  hardConstraints: Constraint[];
  softPreferences: Preference[];
  exclusions: string[];
  ambiguity: string[];
  clarificationNeeded: ClarificationNeed[];
  authorizations?: AgentAuthorization[];
  allowBroaden: boolean;
}

export interface SearchPlan {
  keywords: string[];
  radiusMeters: number;
  poiType?: string;
  searchIntent: SearchIntent;
  allowedForPrimary: boolean;
  reason: string;
  /** Runtime 生成，用于并行搜索时区分交错事件；不进模型 schema。 */
  planId?: string;
}

export interface SearchTarget {
  label: string;
  kind: 'dish' | 'cuisine' | 'restaurant_type' | 'generic';
  strictness: 'exact' | 'compatible' | 'broad';
}

export interface CandidateVerdict {
  restaurantId: string;
  status: 'passed' | 'failed' | 'unverified';
  primaryEligible: boolean;
  confidence: number;
  matchedItems: string[];
  matchedCategories: string[];
  conflicts: string[];
  evidence: string[];
  warnings: string[];
}

export interface EvaluationAgentOutput {
  verdicts: CandidateVerdict[];
  selectedIds: string[];
  candidateIds: string[];
  explanation: string;
  unmetConstraints: string[];
  source?: 'model' | 'cache' | 'error';
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export type GuardrailViolationCode =
  | 'SEARCH_BUDGET_EXCEEDED'
  | 'INVALID_PLAN_SCHEMA'
  | 'UNAUTHORIZED_BROADENING'
  | 'STRICT_DISTANCE_EXCEEDED'
  | 'DUPLICATE_PLAN'
  | 'UNOBSERVED_CANDIDATE_ID'
  | 'INVALID_POI_TYPE'
  | 'PREMATURE_FINISH';

export interface GuardrailViolation {
  code: GuardrailViolationCode;
  message: string;
  severity: 'info' | 'warn' | 'error';
  details?: unknown;
}

export type GuardrailDecision =
  | {
      type: 'allow';
      action: AgentAction;
      notes?: string[];
    }
  | {
      type: 'reject';
      violations: GuardrailViolation[];
      fallback?: 'ask_user' | 'finish' | 'error';
    }
  | {
      type: 'request_rewrite';
      violations: GuardrailViolation[];
      instruction: string;
      suggestedAction?: AgentAction;
    };

export interface SearchAttempt {
  keywords: string[];
  radius: number;
  poiType?: string;
  searchIntent: SearchIntent;
  allowedForPrimary: boolean;
  reason: string;
  found: number;
  accepted: number;
}

export interface VerificationFailure {
  kind: ConstraintKind | 'requested_item' | 'category';
  message: string;
}

export interface ItemMatch {
  requestedItem: string;
  matchedBy: 'name' | 'cuisineType' | 'address' | 'search_keyword' | 'llm_semantic';
  confidence: number;
}

export interface CandidateVerification {
  restaurantId: string;
  status: 'passed' | 'failed' | 'unverified';
  primaryEligible: boolean;
  hardFailures: VerificationFailure[];
  itemMatches: ItemMatch[];
  categoryMatches: string[];
  warnings: string[];
  confidence: number;
}

export interface RestaurantCandidate {
  candidateId?: string;
  goalId?: string;
  verifiedAgainstGoalVersion?: number;
  verifiedAgainstGoalSignature?: string;
  locationSignature?: string;
  evaluationTraceId?: string;
  stale?: boolean;
  staleReason?: string;
  restaurant: Restaurant;
  score: number;
  matched: string[];
  warnings: string[];
  verification: CandidateVerification;
  sourceAttempt: number;
}

export interface Observation {
  plan: SearchPlan;
  found: number;
  acceptedCandidates: RestaurantCandidate[];
  rejected: number;
  reason: string;
}

export interface FinishRecommendation {
  selectedIds?: string[];
  candidateIds?: string[];
  explanation: string;
  unmetConstraints?: string[];
  confidence: number;
}

export type AgentAction =
  | {
      type: 'search';
      plan: SearchPlan;
    }
  | {
      type: 'ask_user';
      question: PendingQuestion;
    }
  | {
      type: 'finish';
      /**
       * 结束原因。模型不输出该字段（缺省视为 MODEL_DECIDED）；
       * Runtime / Planner 内部构造的 finish 必须显式给出，
       * 用户文案由 describeFinish 统一映射。
       */
      reason?: FinishReason;
      selectedIds?: string[];
      candidateIds?: string[];
      explanation: string;
      confidence: number;
    };

export interface AgentActionRecord {
  id: string;
  action: AgentAction;
  createdAt: number;
  summary: string;
}

export interface AgentObservation {
  actionId: string;
  traceId?: string;
  plan: SearchPlan;
  provider: 'amap' | 'osm';
  rawCount: number;
  hardRejected: Array<{
    restaurantId: string;
    reasons: string[];
  }>;
  verdicts: CandidateVerdict[];
  acceptedPrimaryIds: string[];
  candidateIds: string[];
  unmetConstraints: string[];
}

export type AgentTraceType =
  | 'user_message'
  | 'model_goal'
  | 'model_action'
  | 'model_call'
  | 'guard_decision'
  | 'tool_start'
  | 'tool_result'
  | 'observation'
  | 'evaluation'
  | 'state_update'
  | 'runtime_decision'
  | 'question'
  | 'final'
  | 'error';

/**
 * Agent 结构化错误码。
 *
 * SSE `error` 事件与 `error` trace 都携带该码，客户端据此判断可恢复性，
 * 不再依赖对错误文案做子串匹配。
 */
export type AgentErrorCode =
  | 'SESSION_EXPIRED'
  /** 缺少 key / 鉴权失败，不可恢复 */
  | 'CONFIG_MISSING'
  /** 模型配额耗尽（402/403），重试无意义 */
  | 'MODEL_QUOTA_EXHAUSTED'
  /** 模型服务暂时不可达（5xx / 超时 / 网络） */
  | 'MODEL_UNAVAILABLE'
  /** 模型可达但输出不合法或被截断 */
  | 'MODEL_INVALID_OUTPUT'
  /** Supervisor 没有产出可用的目标或补丁 */
  | 'SUPERVISOR_UNAVAILABLE'
  | 'EVALUATION_FAILED'
  | 'SEARCH_PROVIDER_FAILED'
  | 'RATE_LIMITED'
  | 'INVALID_OPTION'
  | 'UNKNOWN';

export interface AgentTraceItem {
  id: string;
  sessionId: string;
  turnId: string;
  actionId?: string;
  type: AgentTraceType;
  createdAt: number;
  input?: unknown;
  output?: unknown;
  rawAction?: AgentAction;
  guardedAction?: AgentAction;
  guardDecision?: GuardrailDecision;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface AgentInput {
  query: string;
  /**
   * 用户点击的追问选项 id。
   *
   * 与 query 互斥：有 optionId 走确定性状态转移（不调模型），
   * 只有 query 才交给 Supervisor 做意图理解。
   */
  optionId?: string;
  location: Location;
  previousLocation?: Location;
  sessionId?: string;
  messages?: AgentMessage[];
  preferenceSummary?: UserPreferenceSummary;
  runtimeState?: AgentRuntimeState;
}

/**
 * 做策略判断所需的最小搜索状态。
 *
 * 放在 types 而不是 orchestrator/policy：规则库（guards 等）也要按这个形状
 * 做校验，若从 policy 导入就成了"规则层反向依赖编排层"。
 * AgentContext 与 AgentV3Context 均结构性满足。
 */
export interface PolicyContext {
  goal: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  location: Location;
  targetCount: number;
  maxSearchCalls: number;
  /**
   * 本轮是否发生过候选验证失败。
   *
   * 验证失败不再合成 unverified 候选，所以这个标记同时意味着"再搜也没用"：
   * 搜到的东西没人能验证，继续扩搜只会重复调用高德。
   */
  evaluationFailed?: boolean;
}

export interface AgentContext extends AgentInput {
  goal: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  unmetConstraints: string[];
  maxSteps: number;
  maxSearchCalls: number;
  targetCount: number;
  /** 本轮模型调用指标；由 metrics.ts 填充。 */
  modelCallMetrics?: ModelCallMetrics[];
  /**
   * 本轮是否发生过候选验证失败。
   *
   * 失败的候选不再被合成为 unverified 结果（那是用硬编码语义冒充模型判断），
   * 因此这个标记同时意味着"继续扩搜没有意义"——策略层据此立即收敛。
   */
  evaluationFailed?: boolean;
  /** 触发 evaluationFailed 的原始错误，用于在没有主推荐时原样抛出。 */
  evaluationError?: AgentError;
}

export interface AgentFinalResult {
  restaurants: Restaurant[];
  candidates: Restaurant[];
  explanation: string;
  unmetConstraints: string[];
  /** 结果可用但存在瑕疵时的提示（如部分候选未能完成验证）。 */
  warnings?: string[];
  paused?: boolean;
  question?: PendingQuestion;
  questionTraceId?: string;
  runtimeState?: AgentRuntimeState;
}

/**
 * 带结构化错误码的 Agent 错误。
 *
 * 在**抛出点**决定错误码，而不是在消费端对 message 做正则猜测——
 * 后者会把任何碰巧包含 "poi" 的信息判成数据源故障，而 recoverable
 * 直接决定前端让不让用户重试。
 */
export class AgentError extends Error {
  readonly cause?: unknown;

  constructor(
    message: string,
    readonly code: AgentErrorCode,
    readonly retryable: boolean,
    options?: { cause?: unknown }
  ) {
    super(message);
    this.name = 'AgentError';
    this.cause = options?.cause;
  }
}

export function isAgentError(error: unknown): error is AgentError {
  return error instanceof AgentError;
}

/**
 * Runtime 执行失败时抛出，携带失败前的运行状态，
 * 便于 route 层把失败 turn 的 trace 一并落库。
 */
export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly code: AgentErrorCode,
    readonly runtimeState?: AgentRuntimeState,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = 'AgentRunError';
  }
}

export interface AgentRuntimeState {
  goal?: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  actions?: AgentActionRecord[];
  observations?: AgentObservation[];
  trace?: AgentTraceItem[];
  pendingQuestion?: PendingQuestion;
  lastQuestionFingerprint?: string;
  consecutiveAskTurns?: number;
}

type AgentEventPayload =
  | { type: 'thinking'; message: string }
  | { type: 'searching'; keywords: string[]; round: number; searchIntent?: string; planId?: string }
  | {
      type: 'search_result';
      found: number;
      total: number;
      planId?: string;
      restaurants: Array<{
        id: string;
        name: string;
        cuisineType: string;
        distance?: number;
      }>;
    }
  | { type: 'filtering'; message: string; total: number }
  | {
      type: 'done';
      sessionId?: string;
      restaurants: Restaurant[];
      candidates: Restaurant[];
      explanation?: string;
      unmetConstraints?: string[];
    }
  | { type: 'error'; message: string; code?: AgentErrorCode; recoverable?: boolean }
  | { type: 'status'; message: string }
  // 流级心跳：客户端只用它重置"无事件超时"，不触发任何业务回调。
  | { type: 'heartbeat'; at: number }
  | { type: 'tool_start'; tool: string; args: unknown; planId?: string }
  | { type: 'tool_result'; tool: string; summary: unknown; planId?: string }
  | { type: 'partial_results'; restaurants: Restaurant[] }
  | { type: 'action'; actionId: string; actionType: AgentAction['type']; summary: string }
  | { type: 'observation'; actionId: string; found: number; accepted: number; rejected: number }
  | { type: 'guardrail'; actionId: string; message: string; severity: 'info' | 'warn' }
  | {
      type: 'question';
      sessionId: string;
      question: string;
      options?: PendingQuestionOption[];
      allowFreeText: boolean;
    }
  | { type: 'session_paused'; sessionId: string }
  | { type: 'session_resumed'; sessionId: string }
  | { type: 'session_updated'; sessionId: string }
  | {
      type: 'final';
      sessionId?: string;
      restaurants: Restaurant[];
      candidates: Restaurant[];
      explanation: string;
      unmetConstraints: string[];
      warnings?: string[];
    };

export type AgentEvent = AgentEventPayload & { traceId?: string };

export type EmitAgentEvent = (event: AgentEvent) => void;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

/**
 * 追问选项。
 *
 * `id` 是协议，`label` 只是展示文案——两者必须分开：历史上前端按文案回传、
 * 后端按文案查 optionEffects，一旦两侧措辞不一致（前端「你推荐」/后端
 * 「随便推荐」）确定性通道就恒 miss，追问会原地循环。
 */
export interface PendingQuestionOption {
  id: string;
  label: string;
}

export interface PendingQuestion {
  reason?: string;
  question: string;
  options?: PendingQuestionOption[];
  allowFreeText?: boolean;
  /** key 为 option.id，绝不能用 label。 */
  optionEffects?: Record<string, ClarificationEffect>;
}

export interface AgentSession {
  id: string;
  version: 4;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  location: Location;
  messages: AgentMessage[];
  goal?: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  actions: AgentActionRecord[];
  observations: AgentObservation[];
  trace: AgentTraceItem[];
  pendingQuestion?: PendingQuestion;
  /** 上一轮追问的指纹，用于阻止同一个问题连问两次。 */
  lastQuestionFingerprint?: string;
  /** 连续追问轮数；任何一次产出结果的轮次都会清零。 */
  consecutiveAskTurns?: number;
}
