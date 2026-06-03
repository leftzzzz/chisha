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
});
