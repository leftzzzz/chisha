import type { Location, Restaurant } from '@/types';

export type SearchIntent = 'exact' | 'synonym' | 'broadened' | 'fallback';

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
  value?: string | number | string[] | { min?: number; max?: number };
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
  addRequestedItems?: RequestedItem[];
  addCategories?: GoalCategory[];
  addConstraints?: Constraint[];
  removeConstraints?: string[];
  allowBroaden?: boolean;
  reason: string;
}

export interface ClarificationEffect {
  addRequestedItems?: string[];
  addCategories?: string[];
  setDistanceMaxMeters?: number;
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
  rawQuery: string;
  poiType?: string;
  requestedItems: RequestedItem[];
  acceptableCategories: GoalCategory[];
  alternativeGroups: AlternativeGroup[];
  primaryKeywords: string[];
  relatedKeywords: string[];
  broadenedKeywords: string[];
  hardConstraints: Constraint[];
  softPreferences: Preference[];
  exclusions: string[];
  ambiguity: string[];
  clarificationNeeded: ClarificationNeed[];
  allowBroaden: boolean;
}

export interface SearchPlan {
  keywords: string[];
  radiusMeters: number;
  poiType?: string;
  searchIntent: SearchIntent;
  allowedForPrimary: boolean;
  reason: string;
}

export interface SearchTarget {
  label: string;
  kind: 'dish' | 'cuisine' | 'restaurant_type' | 'generic';
  strictness: 'exact' | 'compatible' | 'broad';
}

export interface PlanningAgentPlan {
  targets: SearchTarget[];
  radiusMeters: number;
  searchIntent: SearchIntent;
  allowedForPrimary: boolean;
  reason: string;
}

export interface PlanningAgentOutput {
  plans: PlanningAgentPlan[];
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
}

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
  hardFailures: VerificationFailure[];
  itemMatches: ItemMatch[];
  categoryMatches: string[];
  warnings: string[];
  confidence: number;
}

export interface RestaurantCandidate {
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
  selectedIds: string[];
  candidateIds?: string[];
  explanation: string;
  unmetConstraints?: string[];
  confidence: number;
}

export type AgentDecision =
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
      explanation?: string;
    };

export type AgentDecisionMaker = (
  context: AgentContext,
  observation: Observation
) => Promise<AgentDecision>;

export interface AgentInput {
  query: string;
  location: Location;
  preferenceSummary?: UserPreferenceSummary;
  runtimeState?: AgentRuntimeState;
}

export interface AgentContext extends AgentInput {
  goal: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  unmetConstraints: string[];
  maxSteps: number;
  maxSearchCalls: number;
  targetCount: number;
}

export interface AgentFinalResult {
  restaurants: Restaurant[];
  candidates: Restaurant[];
  explanation: string;
  unmetConstraints: string[];
  paused?: boolean;
  question?: PendingQuestion;
  runtimeState?: AgentRuntimeState;
}

export interface AgentRuntimeState {
  goal?: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
}

export type AgentEvent =
  | { type: 'thinking'; message: string }
  | { type: 'searching'; keywords: string[]; round: number }
  | {
      type: 'search_result';
      found: number;
      total: number;
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
      restaurants: Restaurant[];
      candidates: Restaurant[];
      explanation?: string;
      unmetConstraints?: string[];
    }
  | { type: 'error'; message: string }
  | { type: 'status'; message: string }
  | { type: 'tool_start'; tool: string; args: unknown }
  | { type: 'tool_result'; tool: string; summary: unknown }
  | { type: 'strategy_change'; reason: string; next: SearchPlan }
  | { type: 'partial_results'; restaurants: Restaurant[] }
  | {
      type: 'question';
      sessionId: string;
      question: string;
      options?: string[];
      allowFreeText: boolean;
    }
  | { type: 'session_paused'; sessionId: string }
  | { type: 'session_resumed'; sessionId: string }
  | {
      type: 'final';
      restaurants: Restaurant[];
      candidates: Restaurant[];
      explanation: string;
      unmetConstraints: string[];
    };

export type EmitAgentEvent = (event: AgentEvent) => void;

export interface AgentMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface PendingQuestion {
  reason?: string;
  question: string;
  options?: string[];
  allowFreeText?: boolean;
  optionEffects?: Record<string, ClarificationEffect>;
}

export interface AgentSession {
  id: string;
  createdAt: number;
  updatedAt: number;
  location: Location;
  messages: AgentMessage[];
  goal?: UserGoal;
  attempts: SearchAttempt[];
  candidates: RestaurantCandidate[];
  pendingQuestion?: PendingQuestion;
}
