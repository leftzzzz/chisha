import { act, renderHook } from '@testing-library/react';
import { useAppState } from '@/hooks/useAppState';

const mockDispatch = jest.fn();
const mockState = { selectedIndex: -1 };

jest.mock('@/context/AppContext', () => ({
  useAppContext: () => ({ state: mockState, dispatch: mockDispatch }),
}));

describe('useAppState', () => {
  beforeEach(() => mockDispatch.mockClear());

  it('maps every convenience method to the reducer action contract', () => {
    const restaurant = { id: 'r1', name: '餐厅' };
    const parsed = { cuisine: ['川菜'] };
    const question = { id: 'q1', text: '想吃什么？', options: [] };
    const trace = { id: 't1', type: 'search' };
    const customOption = { id: 'c1', name: '在家做饭', emoji: '🍳' };
    const { result } = renderHook(() => useAppState());

    act(() => {
      result.current.setQuery('q');
      result.current.setLocation({ lat: 1, lng: 2 });
      result.current.setStep('READY');
      result.current.setParsedRequirement(parsed as Parameters<typeof result.current.setParsedRequirement>[0]);
      result.current.setRestaurants([restaurant] as Parameters<typeof result.current.setRestaurants>[0]);
      result.current.setRestaurantsWithCandidates(
        [restaurant] as Parameters<typeof result.current.setRestaurants>[0],
        [],
        '说明',
        ['约束']
      );
      result.current.setSelectedIndex(1);
      result.current.setError('e');
      result.current.setAgentSessionId('s1');
      result.current.setAgentQuestion(question as Parameters<typeof result.current.setAgentQuestion>[0]);
      result.current.appendAgentTrace(trace as Parameters<typeof result.current.appendAgentTrace>[0]);
      result.current.setAgentTrace([trace] as Parameters<typeof result.current.setAgentTrace>[0]);
      result.current.clearAgentTrace();
      result.current.deleteRestaurant(0);
      result.current.restoreRestaurant(0);
      result.current.addFromCandidates(0);
      result.current.removeToCandidates(0);
      result.current.addRestaurant(restaurant as Parameters<typeof result.current.addRestaurant>[0]);
      result.current.addCustomOption(customOption as Parameters<typeof result.current.addCustomOption>[0]);
      result.current.removeCustomOption('c1');
      result.current.reset();
    });

    expect(result.current.state).toBe(mockState);
    expect(result.current.dispatch).toBe(mockDispatch);
    expect(mockDispatch.mock.calls.map(([action]) => action.type)).toEqual([
      'SET_QUERY',
      'SET_LOCATION',
      'SET_STEP',
      'SET_PARSED_REQUIREMENT',
      'SET_RESTAURANTS',
      'SET_RESTAURANTS_WITH_CANDIDATES',
      'SET_SELECTED_INDEX',
      'SET_ERROR',
      'SET_AGENT_SESSION_ID',
      'SET_AGENT_QUESTION',
      'APPEND_AGENT_TRACE',
      'SET_AGENT_TRACE',
      'CLEAR_AGENT_TRACE',
      'DELETE_RESTAURANT',
      'RESTORE_RESTAURANT',
      'ADD_FROM_CANDIDATES',
      'REMOVE_TO_CANDIDATES',
      'ADD_RESTAURANT',
      'ADD_CUSTOM_OPTION',
      'REMOVE_CUSTOM_OPTION',
      'RESET_STATE',
    ]);
  });
});
