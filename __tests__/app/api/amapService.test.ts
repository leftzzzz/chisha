/**
 * @jest-environment node
 */

import { NextRequest } from 'next/server';
import { GET, POST } from '@/app/api/amap-service/[...path]/route';

/**
 * 这条路由是公开的，并且服务端会给转发出去的请求注入 AMAP_SECURITY_CODE。
 * 一旦放开成通配转发，任何人都能拿本站当高德 API 的免费跳板，
 * 所以"非白名单路径必须 404"是安全约束，不是风格问题。
 */

function makeRequest(path: string, ip: string, method: 'GET' | 'POST' = 'GET'): {
  request: NextRequest;
  params: Promise<{ path: string[] }>;
} {
  const request = new NextRequest(`https://example.com/_AMapService/${path}`, {
    method,
    headers: { 'x-forwarded-for': ip },
    ...(method === 'POST' ? { body: '{}' } : {}),
  });

  return { request, params: Promise.resolve({ path: path.split('?')[0].split('/') }) };
}

describe('/api/amap-service/[...path]', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    // 每次调用返回新的 Response：body 只能被消费一次，复用同一个实例会让
    // 第二次 arrayBuffer() 抛错
    fetchMock.mockImplementation(async () =>
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it.each([
    'v3/place/around',
    'v3/geocode/regeo',
    'v3/direction/driving',
    'v4/grasproad/driving',
    'v5/place/text',
  ])('rejects non-whitelisted path %s without forwarding', async (path) => {
    const { request, params } = makeRequest(path, `10.0.0.${path.length}`);

    const response = await GET(request, { params });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-whitelisted paths on POST as well', async () => {
    const { request, params } = makeRequest('v3/place/around', '10.0.1.1', 'POST');

    const response = await POST(request, { params });

    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['v3/vectormap', 'v4/map/styles'])('forwards whitelisted path %s', async (path) => {
    const { request, params } = makeRequest(path, `10.0.2.${path.length}`);

    const response = await GET(request, { params });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain(`restapi.amap.com/${path}`);
  });

  it('answers log pings with 204 instead of forwarding them', async () => {
    const { request, params } = makeRequest('v3/log/init', '10.0.3.1');

    const response = await GET(request, { params });

    expect(response.status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rate limits a single IP that floods the proxy', async () => {
    const ip = '10.0.4.1';
    let lastStatus = 0;

    for (let i = 0; i < 320; i += 1) {
      const { request, params } = makeRequest('v3/vectormap', ip);
      lastStatus = (await GET(request, { params })).status;
    }

    expect(lastStatus).toBe(429);
  });
});
