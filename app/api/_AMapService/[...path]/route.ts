/**
 * 高德地图 JS API 安全代理
 *
 * 代理高德地图的安全验证请求，避免安全密钥暴露在前端
 * 参考: https://lbs.amap.com/api/javascript-api-v2/guide/abc/jscode
 */

import { NextRequest, NextResponse } from 'next/server';

const AMAP_API_KEY = process.env.NEXT_PUBLIC_AMAP_KEY;
const AMAP_SECURITY_CODE = process.env.AMAP_SECURITY_CODE;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathStr = path.join('/');
  const searchParams = request.nextUrl.searchParams;

  // 构建目标 URL
  let targetUrl: string;

  if (pathStr.startsWith('v4')) {
    // v4 接口
    targetUrl = `https://restapi.amap.com/${pathStr}?${searchParams.toString()}`;
  } else if (pathStr.startsWith('v3')) {
    // v3 接口
    targetUrl = `https://restapi.amap.com/${pathStr}?${searchParams.toString()}`;
  } else if (pathStr === 'maps') {
    // 地图 JS 文件
    targetUrl = `https://webapi.amap.com/maps?${searchParams.toString()}`;
  } else {
    // 其他接口
    targetUrl = `https://restapi.amap.com/${pathStr}?${searchParams.toString()}`;
  }

  // 添加安全密钥
  const url = new URL(targetUrl);
  if (AMAP_SECURITY_CODE) {
    url.searchParams.set('jscode', AMAP_SECURITY_CODE);
  }

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
    console.error('Amap proxy error:', error);
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
  const body = await request.text();

  const targetUrl = `https://restapi.amap.com/${pathStr}`;
  const url = new URL(targetUrl);

  // 添加安全密钥
  if (AMAP_SECURITY_CODE) {
    url.searchParams.set('jscode', AMAP_SECURITY_CODE);
  }

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
    console.error('Amap proxy error:', error);
    return NextResponse.json(
      { error: 'Proxy request failed' },
      { status: 500 }
    );
  }
}
