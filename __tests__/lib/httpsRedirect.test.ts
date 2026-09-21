import { redirectPublicHttpToHttps } from '@/lib/httpsRedirect';

class TestResponse {
  readonly status: number;
  readonly headers: Map<string, string>;

  private constructor(status: number, location: string) {
    this.status = status;
    this.headers = new Map([['location', location]]);
  }

  static redirect(location: string, status: number): TestResponse {
    return new TestResponse(status, location);
  }
}

beforeAll(() => {
  globalThis.Response = TestResponse as unknown as typeof globalThis.Response;
});

function request(url: string): Request {
  return { url } as Request;
}

describe('redirectPublicHttpToHttps', () => {
  it('redirects public HTTP requests to the same HTTPS URL with 308', () => {
    const response = redirectPublicHttpToHttps(request(
      'http://chisha.leftzzzz.top/api/agent/chat?source=mobile'
    ));

    expect(response?.status).toBe(308);
    expect(response?.headers.get('location')).toBe(
      'https://chisha.leftzzzz.top/api/agent/chat?source=mobile'
    );
  });

  it('does not redirect HTTPS requests', () => {
    expect(redirectPublicHttpToHttps(
      request('https://chisha.leftzzzz.top/api/agent/chat')
    )).toBeNull();
  });

  it.each([
    'http://localhost:3000/',
    'http://app.localhost:3000/',
    'http://127.0.0.1:8787/',
    'http://0.0.0.0:8787/',
    'http://[::1]:8787/',
  ])('keeps local development over HTTP for %s', (url) => {
    expect(redirectPublicHttpToHttps(
      request(url)
    )).toBeNull();
  });
});
