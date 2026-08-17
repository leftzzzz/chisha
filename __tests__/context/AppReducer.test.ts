/**
 * AppReducer 测试
 *
 * 测试所有 reducer actions 的状态转换逻辑
 */

import { appReducer, initialState } from '@/context/AppReducer';
import type { AppState, Restaurant, CustomOption, Location } from '@/types';

describe('AppReducer', () => {
  const mockLocation: Location = {
    lat: 39.9,
    lng: 116.4,
    address: '北京市',
  };

  const mockRestaurant: Restaurant = {
    id: 'r1',
    name: '测试餐厅',
    cuisineType: '川菜',
    address: '测试地址',
    location: mockLocation,
    source: 'amap',
    rating: 4.5,
    distance: 500,
  };

  const mockCustomOption: CustomOption = {
    id: 'c1',
    name: '自定义选项',
    isCustom: true,
  };

  const createRestaurants = (count: number, prefix = 'r'): Restaurant[] =>
    Array.from({ length: count }, (_, index) => ({
      ...mockRestaurant,
      id: `${prefix}${index}`,
      name: `${prefix}测试餐厅${index}`,
      location: {
        ...mockLocation,
        lat: mockLocation.lat + index * 0.001,
        lng: mockLocation.lng + index * 0.001,
      },
    }));

  describe('SET_QUERY', () => {
    it('should set user query and clear error', () => {
      const state = { ...initialState, error: '错误信息' };
      const action = { type: 'SET_QUERY' as const, payload: '我想吃火锅' };

      const newState = appReducer(state, action);

      expect(newState.userQuery).toBe('我想吃火锅');
      expect(newState.error).toBeNull();
    });
  });

  describe('SET_LOCATION', () => {
    it('should set user location and clear error', () => {
      const state = { ...initialState, error: '错误信息' };
      const action = { type: 'SET_LOCATION' as const, payload: mockLocation };

      const newState = appReducer(state, action);

      expect(newState.userLocation).toEqual(mockLocation);
      expect(newState.error).toBeNull();
    });

    it('should allow setting location to null', () => {
      const state = { ...initialState, userLocation: mockLocation };
      const action = { type: 'SET_LOCATION' as const, payload: null };

      const newState = appReducer(state, action);

      expect(newState.userLocation).toBeNull();
    });
  });

  describe('SET_STEP', () => {
    it('should set step and clear error when not ERROR', () => {
      const state = { ...initialState, error: '错误信息' };
      const action = { type: 'SET_STEP' as const, payload: 'READY' };

      const newState = appReducer(state, action);

      expect(newState.step).toBe('READY');
      expect(newState.error).toBeNull();
    });

    it('should preserve error when step is ERROR', () => {
      const state = { ...initialState, error: '错误信息' };
      const action = { type: 'SET_STEP' as const, payload: 'ERROR' };

      const newState = appReducer(state, action);

      expect(newState.step).toBe('ERROR');
      expect(newState.error).toBe('错误信息');
    });
  });

  describe('SET_PARSED_REQUIREMENT', () => {
    it('should set parsed requirement and clear error', () => {
      const parsed = {
        keywords: ['火锅'],
        cuisineTypes: ['火锅'],
        searchRadius: 2000,
      };
      const action = { type: 'SET_PARSED_REQUIREMENT' as const, payload: parsed };

      const newState = appReducer(initialState, action);

      expect(newState.parsedRequirement).toEqual(parsed);
      expect(newState.error).toBeNull();
    });
  });

  describe('SET_RESTAURANTS', () => {
    it('should set restaurants and reset selected index', () => {
      const state = { ...initialState, selectedIndex: 3 };
      const restaurants = [mockRestaurant];
      const action = { type: 'SET_RESTAURANTS' as const, payload: restaurants };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toEqual(restaurants);
      expect(newState.selectedIndex).toBe(-1);
      expect(newState.error).toBeNull();
    });

    it('should limit turntable restaurants to 8 items', () => {
      const restaurants = createRestaurants(10);
      const action = { type: 'SET_RESTAURANTS' as const, payload: restaurants };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants).toHaveLength(8);
      expect(newState.restaurants.map((restaurant) => restaurant.id)).toEqual(
        restaurants.slice(0, 8).map((restaurant) => restaurant.id)
      );
    });
  });

  describe('SET_RESTAURANTS_WITH_CANDIDATES', () => {
    it('should set turntable and candidate restaurants', () => {
      // 主推荐已达最低可转数量，候补不应被提上转盘。
      const turntable = createRestaurants(3, 'primary');
      const candidates = [{ ...mockRestaurant, id: 'r2', name: '候补餐厅' }];
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: { turntable, candidates },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants).toEqual(turntable);
      expect(newState.candidateRestaurants).toEqual(candidates);
      expect(newState.removedRestaurants).toEqual([]);
      expect(newState.customOptions).toEqual([]);
      expect(newState.selectedIndex).toBe(-1);
    });

    it('should keep candidates separate when primaries cannot fill a spin', () => {
      const turntable = [mockRestaurant];
      const candidates = createRestaurants(5, 'candidate');
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: { turntable, candidates },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants).toEqual(turntable);
      expect(newState.candidateRestaurants).toEqual(candidates);
    });

    it('should keep Agent explanation and unmet constraints', () => {
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: {
          turntable: [mockRestaurant],
          candidates: [],
          explanation: '已按你的需求排序。',
          unmetConstraints: ['预算无法完全验证。'],
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.agentExplanation).toBe('已按你的需求排序。');
      expect(newState.agentUnmetConstraints).toEqual(['预算无法完全验证。']);
    });

    it('should dedupe restaurants across turntable and candidate pool', () => {
      const duplicate = {
        ...mockRestaurant,
        id: 'osm_duplicate',
        name: mockRestaurant.name,
        location: {
          lat: mockRestaurant.location.lat + 0.0001,
          lng: mockRestaurant.location.lng + 0.0001,
        },
        source: 'osm' as const,
      };
      const uniqueCandidate = {
        ...mockRestaurant,
        id: 'r2',
        name: '另一家餐厅',
      };
      const filler = createRestaurants(2, 'filler');
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: {
          turntable: [mockRestaurant, duplicate, ...filler],
          candidates: [duplicate, uniqueCandidate],
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants.map((restaurant) => restaurant.id)).toEqual([
        'r1',
        'filler0',
        'filler1',
      ]);
      expect(newState.candidateRestaurants.map((restaurant) => restaurant.id)).toEqual(['r2']);
    });

    it('should keep different locations from the same brand', () => {
      const first = {
        ...mockRestaurant,
        id: 'brand-1',
        name: '同品牌（人民广场店）',
      };
      const second = {
        ...mockRestaurant,
        id: 'brand-2',
        name: '同品牌（陆家嘴店）',
        location: { lat: 31.2404, lng: 121.5037 },
      };
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: { turntable: [first, second], candidates: [] },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants.map((restaurant) => restaurant.id))
        .toEqual(['brand-1', 'brand-2']);
    });

    it('should trim overflow primaries without relabeling them as candidates', () => {
      const turntable = createRestaurants(10, 'primary');
      const candidates = createRestaurants(2, 'candidate');
      const action = {
        type: 'SET_RESTAURANTS_WITH_CANDIDATES' as const,
        payload: {
          turntable,
          candidates,
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants.map((restaurant) => restaurant.id)).toEqual(
        turntable.slice(0, 8).map((restaurant) => restaurant.id)
      );
      expect(newState.candidateRestaurants.map((restaurant) => restaurant.id)).toEqual(
        candidates.map((restaurant) => restaurant.id)
      );
    });

    it('should support Agent question step', () => {
      const action = { type: 'SET_STEP' as const, payload: 'AGENT_QUESTION' };

      const newState = appReducer(initialState, action);

      expect(newState.step).toBe('AGENT_QUESTION');
    });
  });

  describe('SET_SELECTED_INDEX', () => {
    it('should set valid index', () => {
      const state = { ...initialState, restaurants: [mockRestaurant] };
      const action = { type: 'SET_SELECTED_INDEX' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(0);
      expect(newState.error).toBeNull();
    });

    it('should allow selecting a custom option by global option index', () => {
      const state = {
        ...initialState,
        restaurants: [mockRestaurant],
        customOptions: [mockCustomOption],
      };
      const action = { type: 'SET_SELECTED_INDEX' as const, payload: 1 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(1);
      expect(newState.error).toBeNull();
    });

    it('should reject invalid index less than -1', () => {
      const state = { ...initialState, restaurants: [mockRestaurant] };
      const action = { type: 'SET_SELECTED_INDEX' as const, payload: -2 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(-1); // unchanged
    });

    it('should reject index >= total option count', () => {
      const state = {
        ...initialState,
        restaurants: [mockRestaurant],
        customOptions: [mockCustomOption],
      };
      const action = { type: 'SET_SELECTED_INDEX' as const, payload: 2 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(-1); // unchanged
    });
  });

  describe('SET_ERROR', () => {
    it('should set error and change step to ERROR', () => {
      const action = { type: 'SET_ERROR' as const, payload: '发生错误' };

      const newState = appReducer(initialState, action);

      expect(newState.error).toBe('发生错误');
      expect(newState.step).toBe('ERROR');
    });

    it('should clear error when payload is null', () => {
      const state = { ...initialState, error: '错误', step: 'ERROR' };
      const action = { type: 'SET_ERROR' as const, payload: null };

      const newState = appReducer(state, action);

      expect(newState.error).toBeNull();
      expect(newState.step).toBe('ERROR'); // step unchanged
    });
  });

  describe('Agent session state', () => {
    it('should set Agent session id', () => {
      const action = { type: 'SET_AGENT_SESSION_ID' as const, payload: 'session_1' };

      const newState = appReducer(initialState, action);

      expect(newState.agentSessionId).toBe('session_1');
    });

    it('should set Agent question and move to question step', () => {
      const question = {
        sessionId: 'session_1',
        question: '要扩大范围吗？',
        options: ['扩大范围'],
        allowFreeText: true,
      };
      const action = { type: 'SET_AGENT_QUESTION' as const, payload: question };

      const newState = appReducer(initialState, action);

      expect(newState.agentQuestion).toEqual(question);
      expect(newState.step).toBe('AGENT_QUESTION');
      expect(newState.error).toBeNull();
    });

    it('should append and clear Agent trace refs', () => {
      const trace = {
        traceId: 'trace_1',
        type: 'action',
        message: '搜索「日料」',
        createdAt: 123,
      };
      const withTrace = appReducer(initialState, {
        type: 'APPEND_AGENT_TRACE' as const,
        payload: trace,
      });

      expect(withTrace.agentTrace).toEqual([trace]);

      const cleared = appReducer(withTrace, { type: 'CLEAR_AGENT_TRACE' as const });
      expect(cleared.agentTrace).toEqual([]);
    });
  });

  describe('DELETE_RESTAURANT', () => {
    it('should remove restaurant and add to removed list', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const state = { ...initialState, restaurants, step: 'READY' };
      const action = { type: 'DELETE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1);
      expect(newState.removedRestaurants).toHaveLength(1);
      expect(newState.removedRestaurants[0]).toEqual(mockRestaurant);
    });

    it('should reset selected index when deleting selected restaurant', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const state = { ...initialState, restaurants, selectedIndex: 0, step: 'READY' };
      const action = { type: 'DELETE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(-1);
    });

    it('should adjust selected index when deleting before selected', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }, { ...mockRestaurant, id: 'r3' }];
      const state = { ...initialState, restaurants, selectedIndex: 2, step: 'READY' };
      const action = { type: 'DELETE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(1);
    });

    it('should set error when total options < 3', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const state = { ...initialState, restaurants, step: 'READY' };
      const action = { type: 'DELETE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.step).toBe('INPUT');
      expect(newState.error).toContain('选项数量不足');
    });

    it('should reject invalid index', () => {
      const state = { ...initialState, restaurants: [mockRestaurant], step: 'READY' };
      const action = { type: 'DELETE_RESTAURANT' as const, payload: 5 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1); // unchanged
    });
  });

  describe('RESTORE_RESTAURANT', () => {
    it('should restore restaurant from removed list', () => {
      const removed = [mockRestaurant];
      const state = { ...initialState, removedRestaurants: removed, step: 'READY' };
      const action = { type: 'RESTORE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1);
      expect(newState.restaurants[0]).toEqual(mockRestaurant);
      expect(newState.removedRestaurants).toHaveLength(0);
      expect(newState.error).toBeNull();
    });

    it('should set error when turntable is full (8 restaurants)', () => {
      const restaurants = Array(8).fill(null).map((_, i) => ({ ...mockRestaurant, id: `r${i}` }));
      const removed = [mockRestaurant];
      const state = { ...initialState, restaurants, removedRestaurants: removed };
      const action = { type: 'RESTORE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(8); // unchanged
      expect(newState.error).toContain('转盘已满');
    });

    it('should set error when turntable is full including custom options', () => {
      const restaurants = createRestaurants(7);
      const removed = [mockRestaurant];
      const state = {
        ...initialState,
        restaurants,
        customOptions: [mockCustomOption],
        removedRestaurants: removed,
      };
      const action = { type: 'RESTORE_RESTAURANT' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(7);
      expect(newState.error).toContain('转盘已满');
    });

    it('should reject invalid index', () => {
      const state = { ...initialState, removedRestaurants: [mockRestaurant] };
      const action = { type: 'RESTORE_RESTAURANT' as const, payload: 5 };

      const newState = appReducer(state, action);

      expect(newState.removedRestaurants).toHaveLength(1); // unchanged
    });
  });

  describe('ADD_FROM_CANDIDATES', () => {
    it('should move restaurant from candidates to turntable', () => {
      const candidates = [mockRestaurant];
      const state = { ...initialState, candidateRestaurants: candidates, step: 'READY' };
      const action = { type: 'ADD_FROM_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1);
      expect(newState.restaurants[0]).toEqual(mockRestaurant);
      expect(newState.candidateRestaurants).toHaveLength(0);
      expect(newState.error).toBeNull();
    });

    it('should set error when turntable is full', () => {
      const restaurants = Array(8).fill(null).map((_, i) => ({ ...mockRestaurant, id: `r${i}` }));
      const candidates = [mockRestaurant];
      const state = { ...initialState, restaurants, candidateRestaurants: candidates };
      const action = { type: 'ADD_FROM_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(8); // unchanged
      expect(newState.error).toContain('转盘已满');
    });

    it('should set error when turntable is full including custom options', () => {
      const restaurants = createRestaurants(7);
      const candidates = [mockRestaurant];
      const state = {
        ...initialState,
        restaurants,
        customOptions: [mockCustomOption],
        candidateRestaurants: candidates,
      };
      const action = { type: 'ADD_FROM_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(7);
      expect(newState.candidateRestaurants).toHaveLength(1);
      expect(newState.error).toContain('转盘已满');
    });

    it('should reject invalid index', () => {
      const state = { ...initialState, candidateRestaurants: [mockRestaurant] };
      const action = { type: 'ADD_FROM_CANDIDATES' as const, payload: 5 };

      const newState = appReducer(state, action);

      expect(newState.candidateRestaurants).toHaveLength(1); // unchanged
    });
  });

  describe('REMOVE_TO_CANDIDATES', () => {
    it('should move restaurant from turntable to candidates', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }, { ...mockRestaurant, id: 'r3' }];
      const state = { ...initialState, restaurants, step: 'READY' };
      const action = { type: 'REMOVE_TO_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(2);
      expect(newState.candidateRestaurants).toHaveLength(1);
      expect(newState.candidateRestaurants[0]).toEqual(mockRestaurant);
    });

    it('should reset selected index when removing selected restaurant', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }, { ...mockRestaurant, id: 'r3' }];
      const state = { ...initialState, restaurants, selectedIndex: 0, step: 'READY' };
      const action = { type: 'REMOVE_TO_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(-1);
    });

    it('should set error when total options < 3', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const state = { ...initialState, restaurants, step: 'READY' };
      const action = { type: 'REMOVE_TO_CANDIDATES' as const, payload: 0 };

      const newState = appReducer(state, action);

      expect(newState.step).toBe('INPUT');
      expect(newState.error).toContain('选项数量不足');
    });

    it('should reject invalid index', () => {
      const state = { ...initialState, restaurants: [mockRestaurant] };
      const action = { type: 'REMOVE_TO_CANDIDATES' as const, payload: 5 };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1); // unchanged
    });
  });

  describe('ADD_CUSTOM_OPTION', () => {
    it('should add custom option', () => {
      const action = { type: 'ADD_CUSTOM_OPTION' as const, payload: mockCustomOption };

      const newState = appReducer(initialState, action);

      expect(newState.customOptions).toHaveLength(1);
      expect(newState.customOptions[0]).toEqual(mockCustomOption);
      expect(newState.error).toBeNull();
    });

    it('should set error when total options >= 8', () => {
      const restaurants = Array(8).fill(null).map((_, i) => ({ ...mockRestaurant, id: `r${i}` }));
      const state = { ...initialState, restaurants };
      const action = { type: 'ADD_CUSTOM_OPTION' as const, payload: mockCustomOption };

      const newState = appReducer(state, action);

      expect(newState.customOptions).toHaveLength(0); // unchanged
      expect(newState.error).toContain('转盘已满');
    });
  });

  describe('ADD_RESTAURANT', () => {
    it('should add restaurant to turntable', () => {
      const action = { type: 'ADD_RESTAURANT' as const, payload: mockRestaurant };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants).toHaveLength(1);
      expect(newState.restaurants[0]).toEqual(mockRestaurant);
      expect(newState.error).toBeNull();
    });

    it('should set error when turntable is full', () => {
      const restaurants = Array(8).fill(null).map((_, i) => ({ ...mockRestaurant, id: `r${i}` }));
      const state = { ...initialState, restaurants };
      const action = { type: 'ADD_RESTAURANT' as const, payload: mockRestaurant };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(8); // unchanged
      expect(newState.error).toContain('转盘已满');
    });

    it('should set error when restaurant already exists', () => {
      const state = { ...initialState, restaurants: [mockRestaurant] };
      const action = { type: 'ADD_RESTAURANT' as const, payload: mockRestaurant };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(1); // unchanged
      expect(newState.error).toContain('已在转盘上');
    });

    it('should set error when turntable is full including custom options', () => {
      const restaurants = createRestaurants(7);
      const state = {
        ...initialState,
        restaurants,
        customOptions: [mockCustomOption],
      };
      const action = { type: 'ADD_RESTAURANT' as const, payload: { ...mockRestaurant, id: 'new' } };

      const newState = appReducer(state, action);

      expect(newState.restaurants).toHaveLength(7);
      expect(newState.error).toContain('转盘已满');
    });
  });

  describe('REMOVE_CUSTOM_OPTION', () => {
    it('should remove custom option', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }, { ...mockRestaurant, id: 'r3' }];
      const state = { ...initialState, restaurants, customOptions: [mockCustomOption], step: 'READY' };
      const action = { type: 'REMOVE_CUSTOM_OPTION' as const, payload: 'c1' };

      const newState = appReducer(state, action);

      expect(newState.customOptions).toHaveLength(0);
    });

    it('should reset selected index when removing the selected custom option', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }, { ...mockRestaurant, id: 'r3' }];
      const state = {
        ...initialState,
        restaurants,
        customOptions: [mockCustomOption],
        selectedIndex: 3,
        step: 'RESULT' as const,
      };
      const action = { type: 'REMOVE_CUSTOM_OPTION' as const, payload: 'c1' };

      const newState = appReducer(state, action);

      expect(newState.selectedIndex).toBe(-1);
    });

    it('should set error when total options < 3', () => {
      const restaurants = [mockRestaurant, { ...mockRestaurant, id: 'r2' }];
      const state = { ...initialState, restaurants, customOptions: [mockCustomOption], step: 'READY' };
      const action = { type: 'REMOVE_CUSTOM_OPTION' as const, payload: 'c1' };

      const newState = appReducer(state, action);

      expect(newState.step).toBe('INPUT');
      expect(newState.error).toContain('选项数量不足');
    });
  });

  describe('RESTORE_FROM_HISTORY', () => {
    it('should restore state from history record', () => {
      const restaurants = [
        mockRestaurant,
        { ...mockRestaurant, id: 'r2', name: '第二家餐厅' },
        { ...mockRestaurant, id: 'r3', name: '第三家餐厅' },
      ];
      const action = {
        type: 'RESTORE_FROM_HISTORY' as const,
        payload: {
          query: '火锅',
          location: mockLocation,
          restaurants,
          customOptions: [mockCustomOption],
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.step).toBe('READY');
      expect(newState.userQuery).toBe('火锅');
      expect(newState.userLocation).toEqual(mockLocation);
      expect(newState.restaurants).toEqual(restaurants);
      expect(newState.customOptions).toEqual([mockCustomOption]);
      expect(newState.selectedIndex).toBe(-1);
      expect(newState.error).toBeNull();
    });

    it('should limit restored history to 8 turntable options', () => {
      const restaurants = createRestaurants(7);
      const customOptions = [
        mockCustomOption,
        { ...mockCustomOption, id: 'c2', name: '第二个自定义选项' },
      ];
      const action = {
        type: 'RESTORE_FROM_HISTORY' as const,
        payload: {
          query: '火锅',
          location: mockLocation,
          restaurants,
          customOptions,
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.restaurants).toHaveLength(7);
      expect(newState.customOptions).toEqual([mockCustomOption]);
      expect(newState.restaurants.length + newState.customOptions.length).toBe(8);
    });

    it('should set error when total options < 3', () => {
      const restaurants = [mockRestaurant];
      const action = {
        type: 'RESTORE_FROM_HISTORY' as const,
        payload: {
          query: '火锅',
          location: mockLocation,
          restaurants,
        },
      };

      const newState = appReducer(initialState, action);

      expect(newState.error).toContain('选项数量不足');
    });
  });

  describe('RESET_STATE', () => {
    it('should reset to initial state', () => {
      const state: AppState = {
        step: 'RESULT',
        userQuery: '测试',
        userLocation: mockLocation,
        parsedRequirement: { keywords: ['test'], cuisineTypes: [], searchRadius: 2000 },
        restaurants: [mockRestaurant],
        candidateRestaurants: [],
        agentUnmetConstraints: [],
        agentSessionId: 'session_1',
        agentQuestion: {
          sessionId: 'session_1',
          question: '要扩大范围吗？',
          allowFreeText: true,
        },
        agentTrace: [{
          traceId: 'trace_1',
          type: 'action',
          createdAt: 123,
        }],
        removedRestaurants: [],
        customOptions: [mockCustomOption],
        selectedIndex: 0,
        error: '错误',
      };
      const action = { type: 'RESET_STATE' as const };

      const newState = appReducer(state, action);

      expect(newState).toEqual(initialState);
    });
  });
});
