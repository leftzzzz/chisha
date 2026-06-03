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

  const setQuestionProgress = useCallback((question: AgentQuestion) => {
    activeQuestionRef.current = question;
    activeSessionIdRef.current = question.sessionId;
    setAgentSessionId(question.sessionId);
    setAgentQuestion(question);
    setStep('AGENT_QUESTION');
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

          onSearching: (keywords, round) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `正在搜索「${keywords.join('、')}」...`,
              currentKeywords: keywords,
              round,
            }));
          },

          onSearchResult: (found, total, foundRestaurants) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: found > 0
                ? `已找到 ${total} 家餐厅，继续搜索...`
                : `暂未找到，尝试其他类型...`,
              found,
              total,
              foundRestaurants,
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
            setProgress(prev => ({
              ...prev,
              message,
            }));
          },

          onStrategyChange: (reason) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `正在调整策略：${reason}`,
            }));
          },

          onAction: (summary, actionType) => {
            setProgress(prev => ({
              ...prev,
              status: actionType === 'search' ? 'searching' : prev.status,
              message: summary,
            }));
          },

          onObservation: (found, accepted, rejected) => {
            setProgress(prev => ({
              ...prev,
              status: 'searching',
              message: `观察到 ${found} 家，${accepted} 家可进主推荐，${rejected} 家被硬约束过滤`,
              found,
            }));
          },

          onGuardrail: (message) => {
            setProgress(prev => ({
              ...prev,
              message,
            }));
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
      await runChatSearch(query, location, onError, sessionId);
    },
    [runChatSearch, state.agentSessionId]
  );

  const answerQuestion = useCallback(
    async (answer: string, onError?: (errorCode: string) => void) => {
      const question = activeQuestionRef.current ?? progress.question ?? state.agentQuestion;
      const location = activeLocationRef.current;

      if (!question || !location) {
        setError('当前没有可继续的 Agent 会话');
        return;
      }

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
