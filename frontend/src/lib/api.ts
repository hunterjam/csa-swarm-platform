// src/lib/api.ts
// Typed API client — acquires MSAL token when auth is enabled

import { msalStore, AUTH_ENABLED } from './auth';
import type {
  Session,
  Round,
  Recommendation,
  GroundingSource,
  DocType,
  RoleConfig,
  AgentConfigResponse,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL}`
  : '';  // falls through to Next.js rewrites in production

async function _token(): Promise<string | null> {
  const { instance, loginRequest } = msalStore;
  if (!AUTH_ENABLED || !instance) return null;
  const accounts = instance.getAllAccounts();
  if (accounts.length === 0) return null;
  const result = await instance.acquireTokenSilent({
    ...loginRequest,
    account: accounts[0],
  });
  return result.accessToken;
}

async function _fetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await _token();
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (!headers['Content-Type'] && !(init?.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${init?.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

// ── Sessions ─────────────────────────────────────────────────────────────
export const api = {
  sessions: {
    list: () => _fetch<Session[]>('/api/sessions'),
    create: (title: string) =>
      _fetch<Session>('/api/sessions', {
        method: 'POST',
        body: JSON.stringify({ title }),
      }),
    get: (id: string) => _fetch<Session>(`/api/sessions/${id}`),
    delete: (id: string) =>
      _fetch<void>(`/api/sessions/${id}`, { method: 'DELETE' }),
    patch: (id: string, body: { model?: string | null }) =>
      _fetch<Session>(`/api/sessions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
  },

  debate: {
    listRounds: (sessionId: string) =>
      _fetch<Round[]>(`/api/sessions/${sessionId}/rounds`),
  },

  context: {
    list: (sessionId: string) =>
      _fetch<GroundingSource[]>(`/api/sessions/${sessionId}/context`),
    upload: async (sessionId: string, file: File, label?: string): Promise<GroundingSource> => {
      const fd = new FormData();
      fd.append('file', file);
      if (label) fd.append('label', label);
      return _fetch<GroundingSource>(`/api/sessions/${sessionId}/context`, {
        method: 'POST',
        body: fd,
      });
    },
    delete: (sessionId: string, pos: string) =>
      _fetch<void>(`/api/sessions/${sessionId}/context/${pos}`, { method: 'DELETE' }),
    togglePin: (sessionId: string, pos: string) =>
      _fetch<GroundingSource>(`/api/sessions/${sessionId}/context/${pos}/pin`, {
        method: 'PATCH',
      }),
    addUrl: (sessionId: string, url: string, label?: string) =>
      _fetch<GroundingSource>(`/api/sessions/${sessionId}/context/url`, {
        method: 'POST',
        body: JSON.stringify({ url, label: label || url }),
      }),
    addText: (sessionId: string, text: string, label: string) =>
      _fetch<GroundingSource>(`/api/sessions/${sessionId}/context/text`, {
        method: 'POST',
        body: JSON.stringify({ text, label }),
      }),
  },

  recommendations: {
    list: (sessionId: string) =>
      _fetch<Recommendation[]>(`/api/sessions/${sessionId}/recommendations`),
    get: (sessionId: string, docType: string) =>
      _fetch<Recommendation>(`/api/sessions/${sessionId}/recommendations/${docType}`),
    docTypes: () => _fetch<DocType[]>('/api/doc-types'),
  },

  diagram: {
    get: (sessionId: string) =>
      _fetch<Recommendation>(`/api/sessions/${sessionId}/diagram`).catch(e => {
        if (String(e).includes('404')) return null;
        throw e;
      }),
  },

  roles: {
    listDefaults: () => _fetch<Record<string, RoleConfig>>('/api/roles'),
  },

  agentConfig: {
    get: (sessionId: string) =>
      _fetch<AgentConfigResponse>(`/api/sessions/${sessionId}/agent-config`),
    put: (sessionId: string, overrides: Record<string, Partial<RoleConfig>>) =>
      _fetch<AgentConfigResponse>(`/api/sessions/${sessionId}/agent-config`, {
        method: 'PUT',
        body: JSON.stringify({ overrides }),
      }),
    bootstrap: (sessionId: string, transcript: string, roleType: 'csa' | 'director' = 'csa') =>
      _fetch<Partial<RoleConfig>>(`/api/sessions/${sessionId}/agent-config/bootstrap`, {
        method: 'POST',
        body: JSON.stringify({ transcript, role_type: roleType }),
      }),
  },
};

// ── SSE helpers ───────────────────────────────────────────────────────────
export async function streamDebateRound(
  sessionId: string,
  pmMessage: string,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const token = await _token();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/rounds`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ pm_message: pmMessage }),
  });

  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try { onEvent(JSON.parse(payload)); } catch { /* skip malformed */ }
      }
    }
  }
}

export async function streamRecommendation(
  sessionId: string,
  docType: string,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const token = await _token();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/recommendations`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ doc_type: docType }),
  });

  if (!res.ok) throw new Error(`Stream failed: ${res.status}`);

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try { onEvent(JSON.parse(payload)); } catch { /* skip malformed */ }
      }
    }
  }
}

export async function streamDiagram(
  sessionId: string,
  onEvent: (event: unknown) => void,
): Promise<void> {
  const token = await _token();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/diagram`, {
    method: 'POST',
    headers,
  });

  if (!res.ok) throw new Error(`Diagram stream failed: ${res.status}`);

  const reader2 = res.body!.getReader();
  const decoder2 = new TextDecoder();
  let buffer2 = '';

  while (true) {
    const { done, value } = await reader2.read();
    if (done) break;
    buffer2 += decoder2.decode(value, { stream: true });
    const lines = buffer2.split('\n');
    buffer2 = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try { onEvent(JSON.parse(payload)); } catch { /* skip malformed */ }
      }
    }
  }
}
