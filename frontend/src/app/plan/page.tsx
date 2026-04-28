// src/app/plan/page.tsx — Generate Architecture Decision Record
'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, streamRecommendation } from '@/lib/api';
import type { Recommendation, RecommendationEvent } from '@/lib/types';
import { useSession } from '@/lib/session-context';
import { Markdown } from '@/components/Markdown';
import { InfoBanner } from '@/components/InfoBanner';

const DOC_TYPE = 'adr';

function PlanContent() {
  const params = useSearchParams();
  const { activeSessionId, setActiveSessionId } = useSession();
  const sessionId = params.get('session') ?? activeSessionId;

  useEffect(() => {
    const p = params.get('session');
    if (p) setActiveSessionId(p);
  }, [params]);

  const [generating, setGenerating] = useState(false);
  const [streamText, setStreamText] = useState('');
  const streamTextRef = useRef('');
  const streamFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [savedRec, setSavedRec] = useState<Recommendation | null>(null);
  const [error, setError] = useState('');

  // Load existing ADR on mount
  useEffect(() => {
    if (!sessionId) return;
    api.recommendations.list(sessionId).then(recs => {
      const adr = recs.find(r => r.doc_type === DOC_TYPE);
      if (adr) setSavedRec(adr);
    }).catch(() => {});
  }, [sessionId]);

  async function handleGenerate() {
    if (!sessionId || generating) return;
    setGenerating(true);
    setError('');
    setStreamText('');
    setSavedRec(null);
    streamTextRef.current = '';

    streamFlushRef.current = setInterval(() => {
      setStreamText(streamTextRef.current);
    }, 150);

    try {
      await new Promise<void>((resolve, reject) => {
        streamRecommendation(sessionId, DOC_TYPE, (raw) => {
          const evt = raw as RecommendationEvent;
          if (evt.type === 'chunk') {
            streamTextRef.current += evt.text;
          } else if (evt.type === 'done') {
            if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
            setSavedRec(evt.rec);
            streamTextRef.current = '';
            setStreamText('');
          } else if (evt.type === 'error') {
            if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
            reject(new Error(evt.message));
          }
        }).then(() => resolve()).catch(err => {
          if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
          reject(err);
        });
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

  const content = streamText || savedRec?.content || '';

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-900">Plan</h1>

      <InfoBanner title="Architecture Decision Record" storageKey="info-plan">
        <p>Generate a structured Architecture Decision Record (ADR) from your debate session. The ADR captures key decisions made, alternatives considered, and the rationale behind each choice.</p>
        <ul className="list-disc ml-4 mt-1 space-y-0.5">
          <li><strong>Complete at least one debate round</strong> before generating.</li>
          <li>The ADR is saved per session and can be re-generated after additional rounds.</li>
          <li>Use the download button to export the document as Markdown.</li>
        </ul>
      </InfoBanner>

      <div className="flex flex-wrap gap-3 items-center">
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="bg-brand-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {generating ? 'Generating…' : savedRec ? 'Re-generate ADR' : 'Generate ADR'}
        </button>

        {savedRec && (
          <a
            href={`data:text/markdown;charset=utf-8,${encodeURIComponent(savedRec.content)}`}
            download="architecture_decision_record.md"
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ↓ Download .md
          </a>
        )}

        {savedRec && (
          <span className="text-xs text-gray-400">
            Generated {new Date(savedRec.created_at).toLocaleString()}
          </span>
        )}
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {content && (
        <div className="border rounded bg-white p-6">
          <Markdown>{content}</Markdown>
        </div>
      )}

      {!content && !generating && (
        <div className="border border-dashed border-gray-300 rounded p-8 text-center text-gray-400 text-sm">
          📐 No Architecture Decision Record generated yet. Click &quot;Generate ADR&quot; to create one from your debate session.
        </div>
      )}
    </div>
  );
}

export default function PlanPage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <PlanContent />
    </Suspense>
  );
}
