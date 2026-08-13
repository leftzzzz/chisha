/**
 * 高德地图 JS API 安全代理
 *
 * 代理高德地图的安全验证请求，避免安全密钥暴露在前端
 * 参考: https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
 *
 * ⚠️ 这是一条**公开**路径：服务端会给转发出去的请求注入 AMAP_SECURITY_CODE。
 * 如果不限制可代理的路径，任何人都能拿本站域名当高德 API 的免费跳板，
 * 消耗本站配额。因此这里只放行 JS API 自己会请求的几条路径，其余一律 404。
 *
 * 前端只用到底图和地图样式（components/map/Map.tsx 不加载任何高德插件），
 * 逆地理编码、POI 搜索走的是 /api/geocode/* 和 /api/search，不经过这里。
 * 如果之后前端引入了新的高德插件而地图报错，把对应路径加进 ALLOWED_PATHS，
 * 不要改回通配转发。
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { rateLimit, getClientIP } from '@/lib/rateLimit';

const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE;

/** 允许代理的路径前缀（JS API v2 通过 serviceHost 请求的全部路径） */
const ALLOWED_PATHS = [
  'v3/vectormap', // 矢量底图瓦片
  'v4/map/styles', // 地图样式（amap://styles/*）
  'maps', // JS API 主脚本
] as const;

/** 只需回 204 的埋点路径，不转发给高德 */
const LOG_PATHS = ['v3/log/', 'v4/log/'] as const;

/**
 * 地图瓦片请求密集：一次首屏加载就可能拉几十张瓦片，平移还会继续拉。
 * 所以这里的额度要比业务接口（3 次/分钟）宽松得多，目的是挡住脚本化滥用，
 * 而不是精确计费。
 */
const PROXY_RATE_LIMIT = 300;
const PROXY_RATE_WINDOW_MS = 60 * 1000;

function isLogPath(pathStr: string): boolean {
  return LOG_PATHS.some((prefix) => pathStr.startsWith(prefix));
}

function isAllowedPath(pathStr: string): boolean {
  return ALLOWED_PATHS.some(
    (prefix) => pathStr === prefix || pathStr.startsWith(`${prefix}/`)
  );
}

function noContent(): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
}

function notFound(pathStr: string, method: string): NextResponse {
  logger.warn('Amap proxy rejected path', { path: pathStr, method });
  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

function tooManyRequests(resetTime: number): NextResponse {
  return NextResponse.json(
    { error: 'Too many requests' },
    {
      status: 429,
      headers: {
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(resetTime),
        'Retry-After': String(Math.ceil((resetTime - Date.now()) / 1000)),
      },
    }
  );
}

/**
 * 构造转发目标。
 *
 * 只有通过 isAllowedPath 的路径会走到这里，因此不存在"用户控制的任意路径
 * 拼进 URL"的问题。
 */
function buildTargetUrl(pathStr: string, searchParams: URLSearchParams): URL {
  const base = pathStr === 'maps'
    ? `https://webapi.amap.com/maps?${searchParams.toString()}`
    : `https://restapi.amap.com/${pathStr}?${searchParams.toString()}`;

  const url = new URL(base);

  if (AMAP_SECURITY_CODE) {
    url.searchParams.set('jscode', AMAP_SECURITY_CODE);
  }

  return url;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join('/');

  if (isLogPath(pathStr)) {
    return noContent();
  }

  if (!isAllowedPath(pathStr)) {
    return notFound(pathStr, 'GET');
  }

  const limit = rateLimit(getClientIP(request), PROXY_RATE_LIMIT, PROXY_RATE_WINDOW_MS);
  if (!limit.success) {
    return tooManyRequests(limit.resetTime);
  }

  const url = buildTargetUrl(pathStr, request.nextUrl.searchParams);

  try {
    const response = await fetch(url.toString(), {
      headers: {
        'User-Agent': request.headers.get('user-agent') || '',
        'Referer': request.headers.get('referer') || '',
      },
    });

    const contentType = response.headers.get('content-type') || 'application/json';
    const data = await response.arrayBuffer();

    return new NextResponse(data, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (error) {
    logger.error('Amap proxy error', { path: pathStr, error });
    return NextResponse.json(
      { error: 'Proxy request failed' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join('/');

  if (isLogPath(pathStr)) {
    return noContent();
  }

  if (!isAllowedPath(pathStr)) {
    return notFound(pathStr, 'POST');
  }

  const limit = rateLimit(getClientIP(request), PROXY_RATE_LIMIT, PROXY_RATE_WINDOW_MS);
  if (!limit.success) {
    return tooManyRequests(limit.resetTime);
  }

  const body = await request.text();
  const url = buildTargetUrl(pathStr, new URLSearchParams());

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': request.headers.get('content-type') || 'application/json',
        'User-Agent': request.headers.get('user-agent') || '',
      },
      body,
    });

    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    logger.error('Amap proxy error', { path: pathStr, error });
    return NextResponse.json(
      { error: 'Proxy request failed' },
      { status: 500 }
    );
  }
}
