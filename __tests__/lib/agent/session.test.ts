import {
  createAgentSession,
  createAgentSessionToken,
  getAgentSession,
} from '@/lib/agent/session';
import type { Location } from '@/types';

const location: Location = {
  lat: 31.2304,
  lng: 121.4737,
  address: '上海市黄浦区',
};

describe('agent session tokens', () => {
  it('can restore a session from a resumable token', () => {
    const session = createAgentSession('随便吃点', location);
    session.goal = {
      intent: 'find_restaurants',
      rawQuery: '随便吃点',
      requestedItems: [],
      acceptableCategories: [],
      alternativeGroups: [],
      primaryKeywords: ['餐厅'],
      relatedKeywords: [],
      broadenedKeywords: [],
      hardConstraints: [],
      softPreferences: [],
      exclusions: [],
      ambiguity: [],
      clarificationNeeded: [],
      allowBroaden: true,
    };

    const token = createAgentSessionToken(session);
    const restored = getAgentSession(token);

    expect(token.startsWith('agent_state_')).toBe(true);
    expect(restored?.messages[0].content).toBe('随便吃点');
    expect(restored?.goal?.primaryKeywords).toEqual(['餐厅']);
  });
});
