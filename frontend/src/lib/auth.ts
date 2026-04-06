// src/lib/auth.ts
// MSAL is initialized at runtime via MsalProvider — see MsalProvider.tsx.
// NEXT_PUBLIC_* vars are baked in at Docker build time, before the Entra app
// registration exists. We use a store object so MsalProvider can set the
// instance and api.ts can read it without stale closure issues.

import type { PublicClientApplication } from '@azure/msal-browser';

// AUTH_ENABLED: NEXT_PUBLIC_AUTH_ENABLED is not set at build time, so
// `undefined !== 'false'` → true. Auth is always on in deployed containers.
export const AUTH_ENABLED = process.env.NEXT_PUBLIC_AUTH_ENABLED !== 'false';

// Mutable store — MsalProvider calls _initMsal() at runtime after fetching config.
export const msalStore: {
  instance: PublicClientApplication | null;
  loginRequest: { scopes: string[] };
} = {
  instance: null,
  loginRequest: { scopes: [] },
};

export function _initMsal(
  instance: PublicClientApplication,
  loginReq: { scopes: string[] },
) {
  msalStore.instance = instance;
  msalStore.loginRequest = loginReq;
}

// Backward-compat — types are correct now so api.ts compiles.
export const msalInstance: PublicClientApplication | null = null;
export const loginRequest: { scopes: string[] } = { scopes: [] };
