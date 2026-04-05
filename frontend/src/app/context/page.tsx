// src/app/context/page.tsx — Grounding context management
'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { GroundingSource } from '@/lib/types';

function ContextContent() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';

  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    if (!sessionId) return;
    try {
      setSources(await api.context.list(sessionId));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => { load(); }, [sessionId]);

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !sessionId) return;
    setUploading(true);
    setError('');
    try {
      await api.context.upload(sessionId, file, label || file.name);
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(pos: number) {
    if (!sessionId) return;
    try {
      await api.context.delete(sessionId, pos);
      setSources(prev => prev.filter(s => s.position !== pos));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleTogglePin(pos: number) {
    if (!sessionId) return;
    try {
      const updated = await api.context.togglePin(sessionId, pos);
      setSources(prev => prev.map(s => s.position === pos ? updated : s));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (!sessionId) {
    return <p className="text-gray-400 text-sm">Select or create a session first.</p>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-900">Context / Grounding</h1>

      {/* Upload form */}
      <div className="border rounded p-4 bg-white space-y-3">
        <p className="text-sm font-medium text-gray-700">Upload grounding document</p>
        <input
          ref={fileRef}
          type="file"
          accept=".txt,.md,.csv,.pdf,.docx,.yaml,.json"
          className="text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1 file:text-sm file:cursor-pointer hover:file:bg-brand-700"
        />
        <input
          value={label}
          onChange={e => setLabel(e.target.value)}
          placeholder="Label (optional)"
          className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
        <button
          onClick={handleUpload}
          disabled={uploading}
          className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Source list */}
      {sources.length === 0 ? (
        <p className="text-gray-400 text-sm">No grounding documents yet.</p>
      ) : (
        <ul className="divide-y divide-gray-200 border rounded bg-white">
          {sources.map(s => (
            <li key={s.id} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{s.label}</p>
                <p className="text-xs text-gray-400">{s.filename} · {s.content.length.toLocaleString()} chars</p>
              </div>
              <button
                onClick={() => handleTogglePin(s.position)}
                title={s.pinned ? 'Unpin' : 'Pin to all rounds'}
                className={`text-lg transition-opacity ${s.pinned ? 'opacity-100' : 'opacity-30 hover:opacity-70'}`}
              >
                📌
              </button>
              <button
                onClick={() => handleDelete(s.position)}
                className="text-red-400 hover:text-red-600 text-xs transition-colors"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ContextPage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <ContextContent />
    </Suspense>
  );
}
