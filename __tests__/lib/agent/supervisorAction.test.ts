import type {
  AgentContext,
  UserGoal,
} from '@/lib/agent/types';
import type { SearchSupervisorActionInput } from '@/lib/agent/supervisorAction';
import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

function goal(overrides: Partial<UserGoal> = {}): UserGoal {
  return {
    intent: 'find_restaurants',
    rawQuery: '你看着办',
    requestedItems: [],
    acceptableCategories: [],
    alternativeGroups: [],
    primaryKeywords: [],
    relatedKeywords: [],
    broadenedKeywords: [],
    hardConstraints: [],
    softPreferences: [{ name: '默认多样性', weight: 1, verifiable: true }],
    exclusions: [],
    ambiguity: [],
    clarificationNeeded: [],
    allowBroaden: true,
    ...overrides,
  };
}

describe('SearchSupervisorAgent action controller', () => {
  it('forces fallback search for open exploration goals before asking the model', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const fetchWithTimeout = jest.fn();
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { decideSearchSupervisorAction } = await import('@/lib/agent/supervisorAction');
      const searchGoal = goal();
      const context: AgentContext = {
        query: '你看着办',
        location,
        goal: searchGoal,
        attempts: [],
        candidates: [],
        unmetConstraints: [],
        maxSteps: 8,
        maxSearchCalls: 4,
        targetCount: 8,
      };
      const input: SearchSupervisorActionInput = {
        message: '你看着办',
        goal: searchGoal,
        messages: [],
        attempts: [],
        observations: [],
        candidates: [],
        limits: {
          maxSearchCalls: 4,
          remainingSearchCalls: 4,
          targetCount: 8,
        },
      };

      const action = await decideSearchSupervisorAction(input, context);

      expect(action.type).toBe('search');
      if (action.type === 'search') {
        expect(action.plan).toEqual(expect.objectContaining({
          keywords: ['餐厅', '美食'],
          searchIntent: 'fallback',
          allowedForPrimary: true,
        }));
      }
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      jest.dontMock('@/lib/withTimeout');
      jest.resetModules();
    }
  });

  it('keeps generic fallback before specific open-exploration targets', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalApiKey = process.env.OPENAI_API_KEY;
    const fetchWithTimeout = jest.fn();
    process.env.NODE_ENV = 'production';
    process.env.OPENAI_API_KEY = 'test-key';
    jest.resetModules();
    jest.doMock('@/lib/withTimeout', () => ({ fetchWithTimeout }));

    try {
      const { decideSearchSupervisorAction } = await import('@/lib/agent/supervisorAction');
      const searchGoal = goal({
        broadenedKeywords: ['日料'],
        broadenedTargets: [{ keyword: '日料', poiTypes: ['050202'], confidence: 0.9 }],
      });
      const context: AgentContext = {
        query: '你看着办',
        location,
        goal: searchGoal,
        attempts: [],
        candidates: [],
        unmetConstraints: [],
        maxSteps: 8,
        maxSearchCalls: 4,
        targetCount: 8,
      };
      const input: SearchSupervisorActionInput = {
        message: '你看着办',
        goal: searchGoal,
        messages: [],
        attempts: [],
        observations: [],
        candidates: [],
        limits: {
          maxSearchCalls: 4,
          remainingSearchCalls: 4,
          targetCount: 8,
        },
      };

      const action = await decideSearchSupervisorAction(input, context);

      expect(action.type).toBe('search');
      if (action.type === 'search') {
        expect(action.plan).toEqual(expect.objectContaining({
          keywords: ['餐厅', '美食'],
          searchIntent: 'fallback',
          allowedForPrimary: true,
        }));
      }
      expect(fetchWithTimeout).not.toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalNodeEnv;
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
      jest.dontMock('@/lib/withTimeout');
      jest.resetModules();
    }
  });
});
