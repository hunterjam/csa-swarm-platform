// Server-side route — reads env vars at runtime, NOT baked in at build time.
// The browser client fetches this to get MSAL config after the container starts.
import { NextResponse } from 'next/server';

export function GET() {
  return NextResponse.json({
    clientId: process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '',
    tenantId: process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? '',
    authEnabled: process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'false',
  });
}
