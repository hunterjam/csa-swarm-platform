// src/components/AuthWrapper.tsx
'use client';

import { useMsal, MsalAuthenticationTemplate } from '@azure/msal-react';
import { InteractionType } from '@azure/msal-browser';
import { loginRequest, AUTH_ENABLED } from '@/lib/auth';

interface Props {
  children: React.ReactNode;
}

export default function AuthWrapper({ children }: Props) {
  if (!AUTH_ENABLED) {
    return <>{children}</>;
  }

  return (
    <MsalAuthenticationTemplate
      interactionType={InteractionType.Redirect}
      authenticationRequest={loginRequest}
      errorComponent={({ error }) => (
        <div className="flex items-center justify-center h-screen">
          <p className="text-red-600">Auth error: {error?.errorMessage}</p>
        </div>
      )}
      loadingComponent={() => (
        <div className="flex items-center justify-center h-screen">
          <p className="text-gray-500">Signing in…</p>
        </div>
      )}
    >
      {children}
    </MsalAuthenticationTemplate>
  );
}
