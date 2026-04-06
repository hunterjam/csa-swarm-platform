// src/components/AuthWrapper.tsx
'use client';

import { MsalAuthenticationTemplate } from '@azure/msal-react';
import { InteractionType } from '@azure/msal-browser';
import { useAuthConfig } from '@/components/MsalProvider';

interface Props {
  children: React.ReactNode;
}

export default function AuthWrapper({ children }: Props) {
  const { authEnabled, loginRequest } = useAuthConfig();

  if (!authEnabled) {
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
