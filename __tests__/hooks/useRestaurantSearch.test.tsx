import { act, renderHook } from '@testing-library/react';
import { agentChat, APIError } from '@/lib/api';
import { useAppState } from '@/hooks/useAppState';
import { useRestaurantSearch } from '@/hooks/useRestaurantSearch';
import type { Location } from '@/types';

jest.mock('@/lib/api', () => {
  const actual = jest.requireActual('@/lib/api');
  return {
    ...actual,
    agentChat: jest.fn(),
  };
});

jest.mock('@/lib/storage', () => ({
  buildUserPreferenceSummary: jest.fn(() => undefined),
}));

jest.mock('@/hooks/useAppState', () => ({
  useAppState: jest.fn(),
}));

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

describe('useRestaurantSearch', () => {
  const setStep = jest.fn();
  const setRestaurantsWithCandidates = jest.fn();
  const setError = jest.fn();
  const setAgentSessionId = jest.fn();
  const setAgentQuestion = jest.fn();
  const appendAgentTrace = jest.fn();
  const clearAgentTrace = jest.fn();
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAppState as jest.Mock).mockReturnValue({
      state: {
        agentSessionId: null,
        agentQuestion: null,
      },
      setStep,
      setRestaurantsWithCandidates,
      setError,
      setAgentSessionId,
      setAgentQuestion,
      appendAgentTrace,
      clearAgentTrace,
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('keeps the visible error state when agent search fails', async () => {
    (agentChat as jest.Mock).mockRejectedValue(
      new APIError('会话已过期，请重新发起搜索', 'AGENT_ERROR')
    );

    const { result } = renderHook(() => useRestaurantSearch());

    await act(async () => {
      await result.current.search('想吃火锅', location);
    });

    expect(result.current.progress).toEqual({
      status: 'error',
      message: '会话已过期，请重新发起搜索',
    });
    expect(setError).toHaveBeenCalledWith('会话已过期，请重新发起搜索');
    expect(setStep).toHaveBeenCalledWith('SEARCHING');
    expect(setStep).not.toHaveBeenCalledWith('INPUT');
  });

  it('carries the current Agent session id into ordinary follow-up searches', async () => {
    (agentChat as jest.Mock)
      .mockImplementationOnce(async (_message, _location, callbacks) => {
        callbacks.onSessionUpdated?.('session_1');
        return {
          restaurants: [{
            id: 'r1',
            name: '寿司店',
            cuisineType: '日本料理',
            address: '测试地址',
            location,
            source: 'amap',
          }],
          candidates: [],
          sessionId: 'session_1',
          explanation: '测试结果',
          unmetConstraints: [],
        };
      })
      .mockImplementationOnce(async () => ({
        restaurants: [{
          id: 'r2',
          name: '平价寿司',
          cuisineType: '日本料理',
          address: '测试地址',
          location,
          source: 'amap',
        }],
        candidates: [],
        sessionId: 'session_1',
        explanation: '追问结果',
        unmetConstraints: [],
      }));

    const { result } = renderHook(() => useRestaurantSearch());

    await act(async () => {
      await result.current.search('想吃日料', location);
    });

    await act(async () => {
      await result.current.search('刚才这些里便宜点的', location);
    });

    expect(agentChat).toHaveBeenCalledTimes(2);
    expect((agentChat as jest.Mock).mock.calls[0][4]).toBeUndefined();
    expect((agentChat as jest.Mock).mock.calls[1][4]).toBe('session_1');
    expect(setAgentSessionId).toHaveBeenCalledWith('session_1');
  });

  it('keeps an interrupted session resumable after a stream timeout', async () => {
    (agentChat as jest.Mock)
      .mockImplementationOnce(async (_message, _location, callbacks) => {
        callbacks.onSessionCreated?.('session_interrupted');
        throw new APIError(
          '搜索超时，请重试',
          'SEARCH_TIMEOUT',
          undefined,
          'session_interrupted'
        );
      })
      .mockImplementationOnce(async () => ({
        restaurants: [{
          id: 'r1',
          name: '寿司店',
          cuisineType: '日本料理',
          address: '测试地址',
          location,
          source: 'amap',
        }],
        candidates: [],
        sessionId: 'session_interrupted',
        explanation: '继续完成搜索。',
        unmetConstraints: [],
      }));

    const { result } = renderHook(() => useRestaurantSearch());

    await act(async () => {
      await result.current.search('想吃日料', location);
    });
    await act(async () => {
      await result.current.search('继续', location);
    });

    expect(result.current.progress.status).toBe('done');
    expect((agentChat as jest.Mock).mock.calls[1][4]).toBe('session_interrupted');
    expect(setAgentSessionId).toHaveBeenCalledWith('session_interrupted');
  });

  it('stores Agent questions in app state', async () => {
    (agentChat as jest.Mock).mockImplementationOnce(async (_message, _location, callbacks) => {
      callbacks.onQuestion?.({
        sessionId: 'session_1',
        question: '你想找哪类餐厅？',
        options: ['日料', '火锅'],
        allowFreeText: true,
      });
      return {
        restaurants: [],
        candidates: [],
        sessionId: 'session_1',
        paused: true,
        question: {
          sessionId: 'session_1',
          question: '你想找哪类餐厅？',
          options: ['日料', '火锅'],
          allowFreeText: true,
        },
      };
    });

    const { result } = renderHook(() => useRestaurantSearch());

    await act(async () => {
      await result.current.search('想吃健康点', location);
    });

    expect(result.current.progress.status).toBe('question');
    expect(setStep).toHaveBeenCalledWith('AGENT_QUESTION');
    expect(setAgentQuestion).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session_1',
      question: '你想找哪类餐厅？',
    }));
  });

  /**
   * 并行 fan-out 下同一步会有多个搜索计划，事件交错到达。
   * 没有按 planId 聚合的话，后到的事件会覆盖先到的：用户只看得见最后一个
   * 关键词，found/total 还会来回跳。
   */
  describe('并行搜索进度聚合', () => {
    interface ProgressCallbacks {
      onAction?: (summary: string, actionType: string) => void;
      onSearching?: (keywords: string[], round: number, intent?: string, planId?: string) => void;
      onSearchResult?: (found: number, total: number, restaurants: unknown[], planId?: string) => void;
    }

    function restaurant(id: string, name: string) {
      return { id, name, cuisineType: '火锅', distance: 300 };
    }

    /**
     * 搜索结束时 progress 会被 done 整体覆盖，所以要在事件发完、结果返回前
     * 断言中间态：用一个闸门把 agentChat 卡在那一刻。
     */
    async function observeProgressDuringSearch(
      emitEvents: (callbacks: ProgressCallbacks) => void
    ) {
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      (agentChat as jest.Mock).mockImplementation(async (
        _message: string,
        _location: Location,
        callbacks: ProgressCallbacks
      ) => {
        emitEvents(callbacks);
        await gate;
        return { restaurants: [], candidates: [] };
      });

      const { result } = renderHook(() => useRestaurantSearch());
      let searching: Promise<void> = Promise.resolve();

      await act(async () => {
        searching = result.current.search('想吃火锅', location);
        await Promise.resolve();
      });

      const snapshot = result.current.progress;

      await act(async () => {
        release();
        await searching;
      });

      return snapshot;
    }

    it('merges concurrent plans into one progress view', async () => {
      const progress = await observeProgressDuringSearch((callbacks) => {
        callbacks.onAction?.('搜索「火锅」', 'search');
        callbacks.onSearching?.(['火锅'], 1, 'exact', 'plan-a');
        callbacks.onSearching?.(['川菜'], 1, 'exact', 'plan-b');
        callbacks.onSearchResult?.(2, 2, [restaurant('r1', '海底捞'), restaurant('r2', '小龙坎')], 'plan-a');
        callbacks.onSearchResult?.(2, 2, [restaurant('r2', '小龙坎'), restaurant('r3', '眉州东坡')], 'plan-b');
      });

      expect(progress.currentKeywords).toEqual(['火锅', '川菜']);
      expect(progress.found).toBe(4);
      // 同一家店被两个关键词召回，展示时按 id 去重
      expect(progress.foundRestaurants?.map((item) => item.id)).toEqual(['r1', 'r2', 'r3']);
    });

    it('resets the aggregate when the next search step starts', async () => {
      const progress = await observeProgressDuringSearch((callbacks) => {
        callbacks.onAction?.('搜索「火锅」', 'search');
        callbacks.onSearching?.(['火锅'], 1, 'exact', 'plan-a');
        callbacks.onSearchResult?.(2, 2, [restaurant('r1', '海底捞')], 'plan-a');

        callbacks.onAction?.('搜索「烧烤」', 'search');
        callbacks.onSearching?.(['烧烤'], 2, 'broadened', 'plan-c');
        callbacks.onSearchResult?.(1, 1, [restaurant('r9', '很久以前')], 'plan-c');
      });

      expect(progress.currentKeywords).toEqual(['烧烤']);
      expect(progress.found).toBe(1);
      expect(progress.foundRestaurants?.map((item) => item.id)).toEqual(['r9']);
    });
  });
});
