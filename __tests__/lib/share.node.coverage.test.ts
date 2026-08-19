/**
 * @jest-environment node
 */

import {
  clearShareParamFromUrl,
  generateShareUrl,
  getShareParamFromUrl,
} from '@/lib/share';

describe('share helpers without a browser', () => {
  it('generates a relative URL and treats browser-only state as absent', () => {
    expect(generateShareUrl('午饭', [])).toMatch(/^\?s=[A-Za-z0-9_-]+$/);
    expect(getShareParamFromUrl()).toBeNull();
    expect(() => clearShareParamFromUrl()).not.toThrow();
  });
});
