import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const AMAP_MAP_KEY_ENV_NAMES = [
  'NEXT_PUBLIC_AMAP_KEY',
  'AMAP_JS_API_KEY',
] as const;

function getAmapMapApiKey(): string {
  for (const envName of AMAP_MAP_KEY_ENV_NAMES) {
    const value = process.env[envName]?.trim();
    if (value) {
      return value;
    }
  }

  return '';
}

export async function GET() {
  const amapKey = getAmapMapApiKey();

  return NextResponse.json(
    { amapKey, configured: Boolean(amapKey) },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    }
  );
}
