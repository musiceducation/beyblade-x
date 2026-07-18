import { NextRequest, NextResponse } from 'next/server';

/** Allow Mac arena (different origin) to call rooms API. */
export function corsHeaders(req?: NextRequest): HeadersInit {
  const origin = req?.headers.get('origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin === 'null' ? '*' : origin,
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-referee-token',
    'Access-Control-Max-Age': '86400',
  };
}

export function jsonWithCors(
  req: NextRequest | undefined,
  body: unknown,
  init?: { status?: number },
) {
  return NextResponse.json(body, {
    status: init?.status ?? 200,
    headers: corsHeaders(req),
  });
}

export function optionsResponse(req?: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}
