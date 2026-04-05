// src/lib/auth.ts
// MSAL PublicClientApplication configuration

import { Configuration, LogLevel, PublicClientApplication } from '@azure/msal-browser';

const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'false';

const msalConfig: Configuration = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID ?? '',
    authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_ENTRA_TENANT_ID ?? 'common'}`,
    redirectUri: typeof window !== 'undefined' ? window.location.origin : '/',
  },
  cache: {
    cacheLocation: 'sessionStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error('[MSAL]', message);
      },
      logLevel: LogLevel.Error,
    },
  },
};

export const msalInstance = AUTH_ENABLED
  ? new PublicClientApplication(msalConfig)
  : null;

export const loginRequest = {
  scopes: [`api://${process.env.NEXT_PUBLIC_ENTRA_CLIENT_ID}/access_as_user`],
};

export { AUTH_ENABLED };
