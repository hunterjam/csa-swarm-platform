// src/components/MsalProvider.tsx
// Fetches MSAL config from /api/config at runtime (server reads env vars fresh),
// then initializes PublicClientApplication. This avoids the build-time bake-in
// of NEXT_PUBLIC_* values which aren't available when `azd package` runs.
'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { MsalProvider as _MsalProvider } from '@azure/msal-react';
import { PublicClientApplication, type Configuration } from '@azure/msal-browser';
import { _initMsal } from '@/lib/auth';

interface AuthConfig {
  clientId: string;
  tenantId: string;
  authEnabled: boolean;
  loginRequest: { scopes: string[] };
}

const defaultConfig: AuthConfig = {
  clientId: '',
  tenantId: '',
  authEnabled: false,
  loginRequest: { scopes: [] },
};

const AuthConfigContext = createContext<AuthConfig>(defaultConfig);

export function useAuthConfig() {
  return useContext(AuthConfigContext);
}

export default function MsalProvider({ children }: { children: React.ReactNode }) {
  const [instance, setInstance] = useState<PublicClientApplication | null>(null);
  const [config, setConfig] = useState<AuthConfig>(defaultConfig);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(async (data: { clientId: string; tenantId: string; authEnabled: boolean }) => {
        if (!data.authEnabled || !data.clientId) {
          setReady(true);
          return;
        }
        const msalConfig: Configuration = {
          auth: {
            clientId: data.clientId,
            authority: `https://login.microsoftonline.com/${data.tenantId}`,
            redirectUri: window.location.origin,
          },
          cache: { cacheLocation: 'sessionStorage', storeAuthStateInCookie: false },
        };
        const msal = new PublicClientApplication(msalConfig);
        await msal.initialize();
        const loginReq = { scopes: [`api://${data.clientId}/access_as_user`] };
        _initMsal(msal, loginReq);
        setConfig({
          clientId: data.clientId,
          tenantId: data.tenantId,
          authEnabled: true,
          loginRequest: loginReq,
        });
        setInstance(msal);
        setReady(true);
      })
      .catch(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <AuthConfigContext.Provider value={config}>
      {instance ? (
        <_MsalProvider instance={instance}>{children}</_MsalProvider>
      ) : (
        <>{children}</>
      )}
    </AuthConfigContext.Provider>
  );
}
