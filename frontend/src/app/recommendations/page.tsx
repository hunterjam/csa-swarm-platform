// src/app/recommendations/page.tsx — Generate and view deliverables
'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import { api, streamRecommendation, streamDiagram } from '@/lib/api';
import type { DocType, Recommendation, RecommendationEvent } from '@/lib/types';
import { useSession } from '@/lib/session-context';
import { Markdown } from '@/components/Markdown';

const MermaidDiagram = dynamic(() => import('@/components/MermaidDiagram'), { ssr: false });

function RecsContent() {
  const params = useSearchParams();
  const { activeSessionId, setActiveSessionId } = useSession();
  const sessionId = params.get('session') ?? activeSessionId;

  // Sync context whenever the URL carries an explicit session param
  useEffect(() => {
    const p = params.get('session');
    if (p) setActiveSessionId(p);
  }, [params]);

  const [docTypes, setDocTypes] = useState<DocType[]>([]);
  const [selected, setSelected] = useState('architecture');
  const [existing, setExisting] = useState<Recommendation[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateAllProgress, setGenerateAllProgress] = useState<string>('');
  const [streamText, setStreamText] = useState('');
  const streamTextRef = useRef('');
  const streamFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [activeRec, setActiveRec] = useState<Recommendation | null>(null);
  const [diagramSource, setDiagramSource] = useState('');
  const [generatingDiagram, setGeneratingDiagram] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.recommendations.docTypes().then(d => {
      setDocTypes(d);
      if (d.length > 0) setSelected(d[0].key);
    });
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    api.recommendations.list(sessionId).then(recs => {
      setExisting(recs);
      const diagramRec = recs.find(r => r.doc_type === 'architecture_diagram');
      if (diagramRec) setDiagramSource(diagramRec.content);
    }).catch(() => {});
  }, [sessionId]);

  function selectRec(rec: Recommendation) {
    setActiveRec(rec);
    setStreamText('');
  }

  async function generateOne(docType: string): Promise<Recommendation | null> {
    streamTextRef.current = '';
    setStreamText('');

    // Flush accumulated SSE chunks to state at most every 150ms to avoid
    // blocking React's message-channel scheduler with full markdown re-parses.
    streamFlushRef.current = setInterval(() => {
      setStreamText(streamTextRef.current);
    }, 150);

    return new Promise((resolve, reject) => {
      let done: Recommendation | null = null;
      streamRecommendation(sessionId, docType, (raw) => {
        const evt = raw as RecommendationEvent;
        if (evt.type === 'chunk') {
          streamTextRef.current += evt.text;  // accumulate without triggering render
        } else if (evt.type === 'done') {
          if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
          setExisting(prev => {
            const filtered = prev.filter(r => r.doc_type !== evt.rec.doc_type);
            return [...filtered, evt.rec];
          });
          done = evt.rec;
          setActiveRec(evt.rec);
          streamTextRef.current = '';
          setStreamText('');
        } else if (evt.type === 'error') {
          if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
          reject(new Error(evt.message));
        }
      }).then(() => resolve(done)).catch(err => {
        if (streamFlushRef.current) { clearInterval(streamFlushRef.current); streamFlushRef.current = null; }
        reject(err);
      });
    });
  }

  async function handleGenerate() {
    if (!sessionId || generating) return;
    setGenerating(true);
    setError('');
    setStreamText('');
    setActiveRec(null);
    try {
      await generateOne(selected);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateAll() {
    if (!sessionId || generating) return;
    setGenerating(true);
    setError('');
    setActiveRec(null);
    for (let i = 0; i < docTypes.length; i++) {
      const dt = docTypes[i];
      setGenerateAllProgress(`Generating ${i + 1}/${docTypes.length}: ${dt.label}…`);
      setStreamText('');
      try {
        await generateOne(dt.key);
      } catch (e: unknown) {
        setError(`Failed on ${dt.label}: ${e instanceof Error ? e.message : String(e)}`);
        break;
      }
    }
    setGenerateAllProgress('');
    setGenerating(false);
  }

  async function handleGenerateDiagram() {
    if (!sessionId || generatingDiagram) return;
    setGeneratingDiagram(true);
    setDiagramSource('');
    setShowDiagram(true);
    setError('');
    let accumulated = '';
    try {
      await streamDiagram(sessionId, (raw) => {
        const evt = raw as { type: string; text?: string; diagram?: string };
        if (evt.type === 'chunk' && evt.text) {
          accumulated += evt.text;
          setDiagramSource(accumulated);
        } else if (evt.type === 'done' && evt.diagram) {
          setDiagramSource(evt.diagram);
        } else if (evt.type === 'error') {
          setError(String((evt as { message?: string }).message));
        }
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeneratingDiagram(false);
    }
  }

  async function handleExportZip() {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (const rec of existing) {
      const dt = docTypes.find(d => d.key === rec.doc_type);
      const filename = dt?.filename ?? `${rec.doc_type}.md`;
      zip.file(filename, rec.content);
    }
    if (diagramSource) {
      zip.file('oge_architecture_diagram.mmd', diagramSource);
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'oge_deliverables.zip';
    a.click();
    URL.revokeObjectURL(url);
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
          {generating && !generateAllProgress ? 'Generating…' : 'Generate'}
        </button>
        <button
          onClick={handleGenerateAll}
          disabled={generating}
          className="bg-brand-700 text-white px-5 py-2 rounded text-sm font-medium hover:bg-brand-800 disabled:opacity-50 transition-colors"
        >
          {generateAllProgress || 'Generate All'}
        </button>
        <button
          onClick={handleGenerateDiagram}
          disabled={generatingDiagram}
          className="border border-brand-600 text-brand-600 px-5 py-2 rounded text-sm font-medium hover:bg-brand-50 disabled:opacity-50 transition-colors"
        >
          {generatingDiagram ? 'Generating diagram…' : '🏗️ Architecture Diagram'}
        </button>
        {existing.length > 0 && (
          <button
            onClick={handleExportZip}
            className="border border-gray-300 text-gray-600 px-4 py-2 rounded text-sm font-medium hover:bg-gray-50 transition-colors"
          >
            ↓ Export ZIP
          </button>
        )}
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
          {diagramSource && (
            <button
              onClick={() => setShowDiagram(v => !v)}
              className={`px-3 py-1 rounded text-sm border transition-colors ${
                showDiagram ? 'bg-brand-600 text-white border-brand-600' : 'bg-white hover:bg-brand-50 border-gray-200'
              }`}
            >
              🏗️ Architecture Diagram
            </button>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Mermaid diagram */}
      {showDiagram && diagramSource && (
        <div className="border rounded bg-white p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-sm font-semibold text-gray-700">Architecture Diagram</h2>
            <a
              href={`data:text/plain;charset=utf-8,${encodeURIComponent(diagramSource)}`}
              download="oge_architecture_diagram.mmd"
              className="text-xs text-brand-600 hover:text-brand-700 underline"
            >
              ↓ Download .mmd
            </a>
          </div>
          <MermaidDiagram source={diagramSource} />
        </div>
      )}

      {/* Content viewer */}
      {content && !showDiagram && (
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
          <Markdown>{content}</Markdown>
        </div>
      )}

      {/* Show streaming content even when a doc is selected */}
      {content && showDiagram && streamText && (
        <div className="border rounded bg-white p-6">
          <Markdown>{streamText}</Markdown>
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
