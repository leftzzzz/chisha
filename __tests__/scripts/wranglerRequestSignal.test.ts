/**
 * @jest-environment node
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('wrangler request signal configuration', () => {
  it('enables incoming request abort events for the chat stream bridge', () => {
    const raw = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8');
    const parsed = JSON.parse(
      raw
        .split('\n')
        .filter((line) => !line.trim().startsWith('//'))
        .join('\n')
    ) as { compatibility_flags?: string[] };

    expect(parsed.compatibility_flags).toContain('nodejs_compat');
    expect(parsed.compatibility_flags).toContain('enable_request_signal');
  });
});
