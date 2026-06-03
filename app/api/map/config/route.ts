import { NextResponse } from 'next/server';

export async function GET() {
  const amapKey = process.env.NEXT_PUBLIC_AMAP_KEY || '';

  return NextResponse.json(
    { amapKey },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
