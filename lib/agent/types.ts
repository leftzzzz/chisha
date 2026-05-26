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
}

export interface Preference {
  name: string;
  weight: number;
  verifiable: boolean;
}

export interface UserGoal {
  intent: 'find_restaurants';
  rawQuery: string;
  primaryKeywords: string[];
  relatedKeywords: string[];
  broadenedKeywords: string[];
  hardConstraints: Constraint[];
  softPreferences: Preference[];
  exclusions: string[];
  ambiguity: string[];
}

export interface SearchPlan {
  keywords: string[];
  radiusMeters: number;
  poiType?: string;
  searchIntent: SearchIntent;
  reason: string;
}

export interface SearchAttempt {
  keywords: string[];
  radius: number;
  poiType?: string;
  searchIntent: SearchIntent;
  reason: string;
  found: number;
  accepted: number;
}

export interface RestaurantCandidate {
  restaurant: Restaurant;
  score: number;
  matched: string[];
  warnings: string[];
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

export interface AgentInput {
  query: string;
  location: Location;
  preferenceSummary?: UserPreferenceSummary;
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
  question: string;
  options?: string[];
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
