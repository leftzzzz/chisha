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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    (useAppState as jest.Mock).mockReturnValue({
      setStep,
      setRestaurantsWithCandidates,
      setError,
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
});
