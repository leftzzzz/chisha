/**
 * useRestaurantSearch - 餐厅搜索 Hook
 *
 * 使用 Agent API 执行智能搜索:
 * 1. 调用 /api/agent/chat (SSE 流式)
 * 2. 实时更新搜索进度
 * 3. 更新应用状态
 *
 * 特性:
 * - Agent 自主决策搜索策略
 * - 实时进度反馈
 * - 多轮搜索自动合并
 * - 智能筛选推荐
 */

'use client';

import { useState, useCallback, useRef } from 'react';
import { Location } from '@/types';
import { agentChat, APIError, AgentQuestion, AgentTraceEvent, SearchResultRestaurant } from '@/lib/api';
import { buildUserPreferenceSummary } from '@/lib/storage';
import { useAppState } from './useAppState';

/**
 * 搜索进度状态
 */
export interface SearchProgress {
  status: 'idle' | 'thinking' | 'searching' | 'filtering' | 'question' | 'done' | 'error';
  message: string;
  currentKeywords?: string[];
  round?: number;
  found?: number;
  total?: number;
  /** 已搜索到的餐厅列表（用于实时展示） */
  foundRestaurants?: SearchResultRestaurant[];
  /** Agent 需要用户补充信息时的追问 */
  question?: AgentQuestion;
  // 全局进度
  maxRounds?: number;
  completedRounds?: number;
  targetCount?: number;
  currentStage?: 'exact' | 'synonym' | 'broadened' | 'fallback';
}

/**
 * useRestaurantSearch Hook 返回值
 */
export interface UseRestaurantSearchReturn {
  isSearching: boolean;
  progress: SearchProgress;
  search: (query: string, location: Location, onError?: (errorCode: string) => void) => Promise<void>;
  answerQuestion: (answer: string, onError?: (errorCode: string) => void) => Promise<void>;
}

/** 一步之内单个搜索计划的进度。 */
interface StepPlanProgress {
  keywords: string[];
  found?: number;
  restaurants?: SearchResultRestaurant[];
}

function collectStepKeywords(plans: Map<string, StepPlanProgress>): string[] {
  return Array.from(new Set(
    Array.from(plans.values()).flatMap((plan) => plan.keywords)
  ));
}

function sumStepFound(plans: Map<string, StepPlanProgress>): number {
  return Array.from(plans.values()).reduce((total, plan) => total + (plan.found ?? 0), 0);
}

function collectStepRestaurants(plans: Map<string, StepPlanProgress>): SearchResultRestaurant[] {
  const byId = new Map<string, SearchResultRestaurant>();
  for (const plan of plans.values()) {
    for (const restaurant of plan.restaurants ?? []) {
      byId.set(restaurant.id, restaurant);
    }
  }

  return Array.from(byId.values());
}

function isSameQuestion(left?: AgentQuestion | null, right?: AgentQuestion | null): boolean {
  if (!left || !right) {
    return false;
  }

  return left.sessionId === right.sessionId
    && left.question === right.question
    && left.allowFreeText === right.allowFreeText
    && (left.options ?? []).join('\u0000') === (right.options ?? []).join('\u0000');
}

/**
 * 将 Agent 技术性消息翻译为用户可理解的消息
 */
function translateStatusMessage(message: string): string {
  if (message.includes('SupervisorPlanner')) {
    return '正在分析您的需求...';
  }
  if (message.includes('KeywordExpansion')) {
    return '正在联想相关搜索词...';
  }
  if (message.includes('EvaluationAgent')) {
    return '正在验证推荐结果...';
  }
  return message;
}

/**
 * useRestaurantSearch Hook
 *
 * 执行 Agent 智能搜索
 *
 * @returns 搜索状态、进度和搜索方法
 *
 * @example
 * ```tsx
 * function SearchComponent() {
 *   const { isSearching, progress, search } = useRestaurantSearch();
 *
 *   return (
 *     <div>
 *       {isSearching && (
 *         <LoadingSteps progress={progress} />
 *       )}
 *       <button onClick={() => search(query, location)}>
 *         搜索
 *       </button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useRestaurantSearch(): UseRestaurantSearchReturn {
  const {
    state,
    setStep,
    setRestaurantsWithCandidates,
    setError,
    setAgentSessionId,
    setAgentQuestion,
    appendAgentTrace,
    clearAgentTrace,
  } = useAppState();

  const [isSearching, setIsSearching] = useState(false);
  const [progress, setProgress] = useState<SearchProgress>({
    status: 'idle',
    message: '',
  });

  // 用于取消上一个搜索请求
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeLocationRef = useRef<Location | null>(null);
  const activeQuestionRef = useRef<AgentQuestion | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const questionCountRef = useRef(0);
  /**
   * 当前这一步里同时在跑的搜索计划。
   *
   * 开启并行 fan-out 后一步会有多个计划，事件交错到达。按 planId 聚合，
   * 否则关键词会互相覆盖、found/total 会来回跳。每次新的 search action
   * 就是一步的边界，届时清空。
   */
  const stepPlansRef = useRef(new Map<string, StepPlanProgress>());
  const MAX_QUESTION_COUNT = 3;

  const setQuestionProgress = useCallback((question: AgentQuestion) => {
    activeQuestionRef.current = question;
    activeSessionIdRef.current = question.sessionId;
    setAgentSessionId(question.sessionId);
    setAgentQuestion(question);
    setStep('AGENT_QUESTION');

    // 检查追问次数，超过上限时只显示"你推荐"选项
    questionCountRef.current += 1;
    if (questionCountRef.current > MAX_QUESTION_COUNT) {
      setProgress(prev => {
        if (prev.status === 'question' && isSameQuestion(prev.question, question)) {
          return prev;
        }

        return {
          status: 'question',
          message: question.question,
          question: {
            ...question,
            options: ['你推荐'],
            allowFreeText: false,
          },
        };
      });
      return;
    }

    setProgress(prev => {
      if (prev.status === 'question' && isSameQuestion(prev.question, question)) {
        return prev;
      }

      return {
        status: 'question',
        message: question.question,
        question,
      };
    });
  }, [setAgentQuestion, setAgentSessionId, setStep]);

  const appendTraceProgress = useCallback((trace: AgentTraceEvent) => {
    appendAgentTrace(trace);
  }, [appendAgentTrace]);

  /**
   * 执行 Agent 搜索或会话续跑
   */
  const runChatSearch = useCallback(
    async (
      message: string,
      location: Location,
      onError?: (errorCode: string) => void,
      sessionId?: string
    ) => {
      // 验证输入
      if (!message.trim()) {
        setError('请输入您想吃什么');
        return;
      }

      if (!location || !location.lat || !location.lng) {
        setError('请提供位置信息');
        return;
      }

      // 取消上一个正在进行的搜索请求
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // 创建新的 AbortController
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsSearching(true);
      setStep('SEARCHING');
      setError(null);
      setAgentQuestion(null);
      activeLocationRef.current = location;

      // 新搜索开始时重置追问计数
      if (!sessionId) {
        questionCountRef.current = 0;
      }

      if (sessionId) {
        activeSessionIdRef.current = sessionId;
        setAgentSessionId(sessionId);
      } else {
        activeSessionIdRef.current = null;
        setAgentSessionId(null);
        clearAgentTrace();
      }

      // 初始化进度
      setProgress({
        status: 'thinking',
        message: sessionId ? '正在继续理解你的补充...' : '正在分析您的需求...',
      });

      try {
        const preferenceSummary = buildUserPreferenceSummary();
        const result = await agentChat(message, location, {
          onThinking: (message) => {
            setProgress({
              status: 'thinking',
              message,
            });
          },

          onSearching: (keywords, round, searchIntent, planId) => {
            const plans = stepPlansRef.current;
            const key = planId ?? keywords.join('|');
            plans.set(key, { keywords, ...(plans.get(key) ?? {}) });
            const activeKeywords = collectStepKeywords(plans);

            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `正在搜索「${activeKeywords.join('、')}」...`,
              currentKeywords: activeKeywords,
              round,
              currentStage: searchIntent as SearchProgress['currentStage'],
            }));
          },

          // total 是单个计划的数量，这里改用批次累加，忽略它。
          onSearchResult: (found, _total, foundRestaurants, planId) => {
            const plans = stepPlansRef.current;
            const key = planId ?? String(plans.size);
            plans.set(key, {
              keywords: plans.get(key)?.keywords ?? [],
              found,
              restaurants: foundRestaurants,
            });

            const stepTotal = sumStepFound(plans);
            const stepRestaurants = collectStepRestaurants(plans);

            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: stepTotal > 0
                ? `已找到 ${stepTotal} 家餐厅，继续搜索...`
                : '暂未找到，尝试其他类型...',
              found: stepTotal,
              total: stepTotal,
              foundRestaurants: stepRestaurants,
            }));
          },

          onPartialResults: (restaurants) => {
            setProgress(prev => ({
              ...prev,
              foundRestaurants: restaurants.slice(0, 8).map(r => ({
                id: r.id,
                name: r.name,
                cuisineType: r.cuisineType,
                distance: r.distance,
              })),
            }));
          },

          onFiltering: (message, total) => {
            setProgress(prev => ({
              ...prev,
              status: 'filtering',
              message,
              total,
            }));
          },

          onStatus: (message) => {
            const translated = translateStatusMessage(message);
            setProgress(prev => ({
              ...prev,
              message: translated,
            }));
          },

          onAction: (summary, actionType) => {
            if (actionType === 'search') {
              // 新的一步开始，上一步的并行计划聚合结果作废。
              stepPlansRef.current.clear();
            }

            setProgress(prev => ({
              ...prev,
              status: actionType === 'search' ? 'searching' : prev.status,
              message: summary,
            }));
          },

          onObservation: (found, accepted, _rejected) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `找到 ${found} 家餐厅，其中 ${accepted} 家符合要求`,
              found,
            }));
          },

          onGuardrail: () => {
            // Guardrail 消息不展示给用户，只记录到 trace
          },

          onQuestion: (question) => {
            setQuestionProgress(question);
          },

          onSessionPaused: (sessionId) => {
            activeSessionIdRef.current = sessionId;
            setAgentSessionId(sessionId);
          },

          onSessionResumed: (sessionId) => {
            activeSessionIdRef.current = sessionId;
            setAgentSessionId(sessionId);
          },

          onSessionUpdated: (sessionId) => {
            activeSessionIdRef.current = sessionId;
            setAgentSessionId(sessionId);
          },

          onTrace: (trace) => {
            appendTraceProgress(trace);
          },

          onDone: () => {
            // done 事件现在由 filtering 事件替代进度更新
          },

          onError: (message) => {
            setProgress({
              status: 'error',
              message,
            });
          },
        }, abortController.signal, sessionId, preferenceSummary);

        if (result.paused && result.question) {
          setQuestionProgress({
            ...result.question,
            sessionId: result.sessionId ?? result.question.sessionId,
          });
          return;
        }

        const { restaurants, candidates, explanation, unmetConstraints } = result;
        activeQuestionRef.current = null;
        setAgentQuestion(null);
        if (result.sessionId) {
          activeSessionIdRef.current = result.sessionId;
          setAgentSessionId(result.sessionId);
        }

        // 搜索完成
        const totalFound = restaurants.length + candidates.length;
        setProgress({
          status: 'done',
          message: `找到 ${restaurants.length} 家推荐餐厅${candidates.length > 0 ? `，${candidates.length} 家候补` : ''}`,
          total: totalFound,
        });

        // 直接使用后端返回的选中餐厅和候补餐厅
        setRestaurantsWithCandidates(restaurants, candidates, explanation, unmetConstraints);
        setStep('READY');

      } catch (error) {
        // 如果是请求被取消，不显示错误
        if (error instanceof Error && error.name === 'AbortError') {
          console.log('Search request was cancelled');
          return;
        }

        console.error('Agent search error:', error);

        const errorCode = error instanceof APIError ? (error.code || 'UNKNOWN_ERROR') : 'UNKNOWN_ERROR';
        const errorMessage = error instanceof Error ? error.message : '搜索失败，请重试';

        setProgress({
          status: 'error',
          message: errorMessage,
        });

        activeQuestionRef.current = null;
        activeSessionIdRef.current = null;
        setAgentQuestion(null);
        setAgentSessionId(null);
        setError(errorMessage);
        onError?.(errorCode);

      } finally {
        setIsSearching(false);
        // 清理 AbortController 引用
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
        }
      }
    },
    [
      appendTraceProgress,
      clearAgentTrace,
      setAgentQuestion,
      setAgentSessionId,
      setStep,
      setRestaurantsWithCandidates,
      setError,
      setQuestionProgress,
    ]
  );

  const search = useCallback(
    async (query: string, location: Location, onError?: (errorCode: string) => void) => {
      activeQuestionRef.current = null;
      const sessionId = activeSessionIdRef.current ?? state.agentSessionId ?? undefined;

      // 如果有 sessionId，先检查会话是否有效
      if (sessionId) {
        try {
          await runChatSearch(query, location, onError, sessionId);
        } catch (error) {
          if (error instanceof APIError && error.code === 'SESSION_EXPIRED') {
            // 会话过期，清除 sessionId 并重试
            activeSessionIdRef.current = null;
            setAgentSessionId(null);
            await runChatSearch(query, location, onError, undefined);
          } else {
            throw error;
          }
        }
      } else {
        await runChatSearch(query, location, onError, undefined);
      }
    },
    [runChatSearch, state.agentSessionId, setAgentSessionId]
  );

  const answerQuestion = useCallback(
    async (answer: string, onError?: (errorCode: string) => void) => {
      const question = activeQuestionRef.current ?? progress.question ?? state.agentQuestion;
      const location = activeLocationRef.current;

      if (!question || !location) {
        setError('当前没有可继续的 Agent 会话');
        return;
      }

      // 立即设置反馈状态
      setProgress({
        status: 'thinking',
        message: `好的，正在按您的要求「${answer}」继续搜索...`,
      });

      await runChatSearch(answer, location, onError, question.sessionId);
    },
    [progress.question, runChatSearch, setError, state.agentQuestion]
  );

  return {
    isSearching,
    progress,
    search,
    answerQuestion,
  };
}
