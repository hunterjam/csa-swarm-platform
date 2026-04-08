// src/app/context/page.tsx — Grounding context management
'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { GroundingSource } from '@/lib/types';
import { useSession } from '@/lib/session-context';

function ContextContent() {
  const params = useSearchParams();
  const { activeSessionId, setActiveSessionId } = useSession();
  const sessionId = params.get('session') ?? activeSessionId;

  // Sync context whenever the URL carries an explicit session param
  useEffect(() => {
    const p = params.get('session');
    if (p) setActiveSessionId(p);
  }, [params]);

  const [sources, setSources] = useState<GroundingSource[]>([]);
  const [tab, setTab] = useState<'file' | 'url' | 'text' | 'github'>('file');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');  // e.g. "Uploading 2 of 5…"
  // file tab
  const [label, setLabel] = useState('');
  // url tab
  const [urlInput, setUrlInput] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  // paste tab
  const [pasteText, setPasteText] = useState('');
  const [pasteLabel, setPasteLabel] = useState('');
  // github tab
  const [ghRepo, setGhRepo] = useState('');
  const [ghPat, setGhPat] = useState('');
  const [ghPath, setGhPath] = useState('');
  const [ghLabel, setGhLabel] = useState('');
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
    const files = Array.from(fileRef.current?.files ?? []);
    if (!files.length || !sessionId) return;
    setUploading(true);
    setUploadProgress('');
    setError('');
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (files.length > 1) {
          setUploadProgress(`Uploading ${i + 1} of ${files.length}…`);
        }
        // Use custom label only when a single file is selected
        const fileLabel = files.length === 1 ? (label || file.name) : file.name;
        await api.context.upload(sessionId, file, fileLabel);
      }
      setLabel('');
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
      setUploadProgress('');
    }
  }

  async function handleAddUrl() {
    if (!urlInput.trim() || !sessionId) return;
    setUploading(true);
    setError('');
    try {
      await api.context.addUrl(sessionId, urlInput.trim(), urlLabel.trim());
      setUrlInput('');
      setUrlLabel('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleAddText() {
    if (!pasteText.trim() || !sessionId) return;
    setUploading(true);
    setError('');
    try {
      await api.context.addText(sessionId, pasteText.trim(), pasteLabel.trim() || 'Pasted text');
      setPasteText('');
      setPasteLabel('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleAddGitHub() {
    if (!ghRepo.trim() || !ghPat.trim() || !sessionId) return;
    setUploading(true);
    setError('');
    try {
      await api.context.addGitHub(sessionId, ghRepo.trim(), ghPat.trim(), ghPath.trim(), ghLabel.trim());
      setGhRepo('');
      setGhPat('');
      setGhPath('');
      setGhLabel('');
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(pos: string) {
    if (!sessionId) return;
    try {
      await api.context.delete(sessionId, pos);
      setSources(prev => prev.filter(s => s.position !== pos));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleTogglePin(pos: string) {
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

      {/* Tab selector */}
      <div className="border-b flex gap-0">
        {(['file', 'url', 'text', 'github'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'file' ? '📄 Upload File' : t === 'url' ? '🔗 URL' : t === 'github' ? '🐙 GitHub' : '📋 Paste Text'}
          </button>
        ))}
      </div>

      {/* Upload form */}
      <div className="border rounded p-4 bg-white space-y-3">
        {tab === 'file' && (
          <>
            <p className="text-sm font-medium text-gray-700">Upload grounding document</p>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept=".txt,.md,.csv,.pdf,.docx,.yaml,.json"
              className="text-sm file:mr-3 file:rounded file:border-0 file:bg-brand-600 file:text-white file:px-3 file:py-1 file:text-sm file:cursor-pointer hover:file:bg-brand-700"
            />
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="Label (optional, single file only)"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {uploadProgress || (uploading ? 'Uploading…' : 'Upload')}
            </button>
          </>
        )}

        {tab === 'url' && (
          <>
            <p className="text-sm font-medium text-gray-700">Fetch grounding content from a URL</p>
            <input
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://…"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <input
              value={urlLabel}
              onChange={e => setUrlLabel(e.target.value)}
              placeholder="Label (optional)"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              onClick={handleAddUrl}
              disabled={uploading || !urlInput.trim()}
              className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Fetching…' : 'Fetch & Add'}
            </button>
          </>
        )}

        {tab === 'text' && (
          <>
            <p className="text-sm font-medium text-gray-700">Paste text directly</p>
            <input
              value={pasteLabel}
              onChange={e => setPasteLabel(e.target.value)}
              placeholder="Label (e.g. Customer requirements)"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste your text here…"
              rows={6}
              className="border rounded px-3 py-2 w-full text-sm resize-y focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <button
              onClick={handleAddText}
              disabled={uploading || !pasteText.trim()}
              className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Adding…' : 'Add Text'}
            </button>
          </>
        )}

        {tab === 'github' && (
          <>
            <p className="text-sm font-medium text-gray-700">Fetch from a GitHub repository using a Personal Access Token</p>
            <input
              value={ghRepo}
              onChange={e => setGhRepo(e.target.value)}
              placeholder="owner/repo"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <input
              value={ghPat}
              onChange={e => setGhPat(e.target.value)}
              placeholder="GitHub PAT (github_pat_… or ghp_…)"
              type="password"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <input
              value={ghPath}
              onChange={e => setGhPath(e.target.value)}
              placeholder="Path within repo (optional, e.g. docs/spec.md)"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <input
              value={ghLabel}
              onChange={e => setGhLabel(e.target.value)}
              placeholder="Label (optional)"
              className="border rounded px-3 py-2 w-full text-sm focus:outline-none focus:ring-2 focus:ring-brand-600"
            />
            <p className="text-xs text-gray-400">
              Leave path empty to fetch all text files in the repo root. A PAT with <code>repo</code> (or <code>contents:read</code> for fine-grained) scope is required for private repos.
            </p>
            <button
              onClick={handleAddGitHub}
              disabled={uploading || !ghRepo.trim() || !ghPat.trim()}
              className="bg-brand-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {uploading ? 'Fetching…' : 'Fetch & Add'}
            </button>
          </>
        )}
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

      {/* Wizard footer */}
      <div className="flex justify-between pt-2 border-t">
        <a
          href="/"
          className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
        >
          ← Sessions
        </a>
        <a
          href={sessionId ? `/setup?session=${sessionId}` : '/setup'}
          className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          Next: Setup →
        </a>
      </div>
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
