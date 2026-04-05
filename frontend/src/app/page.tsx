// src/app/page.tsx  — Sessions landing page
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { Session } from '@/lib/types';

export default function SessionsPage() {
  const router = useRouter();
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
      router.push(`/debate?session=${s.id}`);
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
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-900">Sessions</h1>

      {/* Create new session */}
      <div className="flex gap-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleCreate()}
          placeholder="New session title…"
          className="border rounded px-3 py-2 flex-1 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        <button
          onClick={handleCreate}
          disabled={creating || !title.trim()}
          className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {creating ? 'Creating…' : '+ New Session'}
        </button>
      </div>

      {error && (
        <p className="text-red-600 text-sm">{error}</p>
      )}

      {/* Session list */}
      {loading ? (
        <p className="text-gray-500 text-sm">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="text-gray-400 text-sm">No sessions yet. Create one above.</p>
      ) : (
        <ul className="divide-y divide-gray-200 border rounded bg-white">
          {sessions.map(s => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50">
              <button
                onClick={() => router.push(`/debate?session=${s.id}`)}
                className="text-left flex-1"
              >
                <p className="font-medium text-sm text-brand-700">{s.title}</p>
                <p className="text-xs text-gray-400">
                  {new Date(s.created_at).toLocaleString()}
                </p>
              </button>
              <button
                onClick={() => handleDelete(s.id)}
                className="text-red-400 hover:text-red-600 text-xs ml-4 transition-colors"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
