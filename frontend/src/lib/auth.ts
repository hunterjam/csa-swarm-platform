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

// ── Microsoft Graph token acquisition ─────────────────────────────────
// Used for incremental-consent flows (e.g. Teams transcript loader).
// Tries silent acquisition first, falls back to a popup so the user can
// consent to the requested Graph scopes.

export const GRAPH_TEAMS_TRANSCRIPT_SCOPES = [
  'OnlineMeetings.Read',
  'OnlineMeetingArtifact.Read.All',
];

export class GraphTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphTokenError';
  }
}

export async function acquireGraphToken(scopes: string[]): Promise<string> {
  const { instance } = msalStore;
  if (!AUTH_ENABLED || !instance) {
    throw new GraphTokenError(
      'Authentication is not enabled in this deployment, so a Microsoft Graph token cannot be acquired.',
    );
  }
  const accounts = instance.getAllAccounts();
  if (accounts.length === 0) {
    throw new GraphTokenError('You must be signed in to acquire a Microsoft Graph token.');
  }
  const request = { scopes, account: accounts[0] };
  try {
    const result = await instance.acquireTokenSilent(request);
    return result.accessToken;
  } catch {
    // Silent failed — fall through to interactive popup so the user can consent.
    try {
      const result = await instance.acquireTokenPopup({ scopes });
      return result.accessToken;
    } catch (e) {
      throw new GraphTokenError(
        `Could not acquire Microsoft Graph token: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
