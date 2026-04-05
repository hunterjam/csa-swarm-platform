// src/app/recommendations/page.tsx — Generate and view deliverables
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { api, streamRecommendation } from '@/lib/api';
import type { DocType, Recommendation, RecommendationEvent } from '@/lib/types';

function RecsContent() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';

  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [selected, setSelected] = useState('architecture');
  const [existing, setExisting] = useState<Recommendation[]>([]);
  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [activeRec, setActiveRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.recommendations.docTypes().then(d => {
      setDocTypes(d);
      if (d.length > 0) setSelected(d[0].key);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    api.recommendations.list(sessionId).then(setExisting).catch(() => {});
  }, [sessionId]);

  function selectRec(rec: Recommendation) {
    setActiveRec(rec);
    setStreamText('');
  }

  async function handleGenerate() {
    if (!sessionId || generating) return;
    setGenerating(true);
    setError('');
    setStreamText('');
    setActiveRec(null);

    try {
      await streamRecommendation(sessionId, selected, (raw) => {
        const evt = raw as RecommendationEvent;
        if (evt.type === 'chunk') {
          setStreamText(prev => prev + evt.text);
        } else if (evt.type === 'done') {
          setExisting(prev => {
            const filtered = prev.filter(r => r.doc_type !== evt.rec.doc_type);
            return [...filtered, evt.rec];
          });
          setActiveRec(evt.rec);
          setStreamText('');
        } else if (evt.type === 'error') {
          setError(evt.message);
        }
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  if (!sessionId) {
    return <p className="text-gray-400 text-sm">Select or create a session first.</p>;
  }

  const content = streamText || activeRec?.content || '';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-900">Deliverables</h1>

      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-gray-500 mb-1">Document type</label>
          <select
            value={selected}
            onChange={e => setSelected(e.target.value)}
            disabled={generating}
            className="border rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-50"
          >
            {docTypes.map(d => (
              <option key={d.key} value={d.key}>{d.icon} {d.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-brand-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {/* Existing deliverables */}
      {existing.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {existing.map(r => {
            const dt = docTypes.find(d => d.key === r.doc_type);
            return (
              <button
                key={r.id}
                onClick={() => selectRec(r)}
                className={`px-3 py-1 rounded text-sm border transition-colors ${
                  activeRec?.id === r.id
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white hover:bg-brand-50 border-gray-200'
                }`}
              >
                {dt?.icon ?? '📄'} {dt?.label ?? r.doc_type}
              </button>
            );
          })}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Content viewer */}
      {content && (
        <div className="border rounded bg-white p-6">
          {activeRec && (
            <div className="flex justify-end mb-4">
              <a
                href={`data:text/markdown;charset=utf-8,${encodeURIComponent(activeRec.content)}`}
                download={docTypes.find(d => d.key === activeRec.doc_type)?.filename ?? `${activeRec.doc_type}.md`}
                className="text-xs text-brand-600 hover:text-brand-700 underline"
              >
                ↓ Download .md
              </a>
            </div>
          )}
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecommendationsPage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <RecsContent />
    </Suspense>
  );
}
