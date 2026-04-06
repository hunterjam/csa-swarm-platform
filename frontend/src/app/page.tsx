// src/app/page.tsx  — Sessions landing page
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Session } from '@/lib/types';
import { useSession } from '@/lib/session-context';

export default function SessionsPage() {
  const router = useRouter();
  const { setActiveSessionId } = useSession();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      setSessions(await api.sessions.list());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    if (!title.trim()) return;
    setCreating(true);
    try {
      const s = await api.sessions.create(title.trim());
      setActiveSessionId(s.id);
      router.push(`/context?session=${s.id}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this session and all its data?')) return;
    try {
      await api.sessions.delete(id);
      setSessions(prev => prev.filter(s => s.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Sessions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Create a new session to start the workflow, or continue an existing one.
        </p>
      </div>

      {/* Create new session */}
      <div className="border rounded-lg bg-white overflow-hidden">
        <div className="bg-brand-50 border-b px-5 py-3">
          <h3 className="font-semibold text-brand-900 text-sm">Start a new session</h3>
        </div>
        <div className="p-5 flex gap-3">
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            placeholder="Session title… e.g. OGE Observability Design Sprint"
            className="border rounded px-3 py-2 flex-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
          />
          <button
            onClick={handleCreate}
            disabled={creating || !title.trim()}
            className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {creating ? 'Creating…' : '+ New Session'}
          </button>
        </div>
      </div>

      {error && (
        <p className="text-red-600 text-sm">{error}</p>
      )}

      {/* Session list */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-400 text-sm">No sessions yet — create one above to begin.</p>
      ) : (
        <div>
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">
            Continue an existing session
          </p>
          <ul className="divide-y divide-gray-200 border rounded-lg bg-white overflow-hidden">
            {sessions.map(s => (
              <li key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors">
                <button
                  onClick={() => {
                    setActiveSessionId(s.id);
                    router.push(`/context?session=${s.id}`);
                  }}
                  className="text-left flex-1 min-w-0"
                >
                  <p className="font-medium text-sm text-brand-700">{s.title}</p>
                  <p className="text-xs text-gray-400">
                    {new Date(s.created_at).toLocaleString()}
                  </p>
                </button>
                <div className="flex items-center gap-3 ml-4 shrink-0">
                  <button
                    onClick={() => {
                      setActiveSessionId(s.id);
                      router.push(`/context?session=${s.id}`);
                    }}
                    className="text-xs text-brand-600 font-medium hover:text-brand-800 transition-colors"
                  >
                    Continue →
                  </button>
                  <button
                    onClick={() => handleDelete(s.id)}
                    className="text-red-400 hover:text-red-600 text-xs transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
