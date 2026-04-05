// src/components/MsalProvider.tsx
// Thin client wrapper — MSAL requires a Client Component context
'use client';

import { MsalProvider as _MsalProvider } from '@azure/msal-react';
import { msalInstance, AUTH_ENABLED } from '@/lib/auth';

export default function MsalProvider({ children }: { children: React.ReactNode }) {
  if (!AUTH_ENABLED || !msalInstance) {
    return <>{children}</>;
  }
  return <_MsalProvider instance={msalInstance}>{children}</_MsalProvider>;
}
