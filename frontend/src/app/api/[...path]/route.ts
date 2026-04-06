/**
 * Catch-all runtime proxy for /api/* → backend.
 *
 * process.env.BACKEND_URL is evaluated per-request (NOT baked at build time),
 * so the backend URL injected by the Container App env var is always current.
 *
 * /api/config is handled by the sibling route.ts and takes precedence because
 * Next.js resolves exact/static segments before catch-all segments.
 */
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000';

type Context = { params: Promise<{ path: string[] }> };

async function proxy(req: NextRequest, ctx: Context): Promise<NextResponse> {
  const { path } = await ctx.params;
  const targetUrl = `${BACKEND_URL}/api/${path.join('/')}${req.nextUrl.search}`;

  // Forward all headers except 'host' (would confuse the backend).
  const headers = new Headers(req.headers);
  headers.delete('host');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';

  const upstream = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // Required for streaming request bodies in Node 18+ fetch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ...(hasBody ? { duplex: 'half' as any } : {}),
  });

  // Stream the response body back (supports SSE debate endpoint).
  const responseHeaders = new Headers(upstream.headers);
  // Remove transfer-encoding — Next.js / node-fetch handles chunking itself.
  responseHeaders.delete('transfer-encoding');

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET     = proxy;
export const POST    = proxy;
export const PUT     = proxy;
export const PATCH   = proxy;
export const DELETE  = proxy;

// Disable Next.js body-parsing so we can stream the raw body to the backend.
export const dynamic = 'force-dynamic';
