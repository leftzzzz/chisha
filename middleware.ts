import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/_AMapService/')) {
    const rewriteUrl = request.nextUrl.clone();
    rewriteUrl.pathname = `/api/amap-service/${pathname.slice('/_AMapService/'.length)}`;
    return NextResponse.rewrite(rewriteUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: '/_AMapService/:path*',
};
