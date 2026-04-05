// src/app/debate/page.tsx
'use client';

import { useEffect, useRef, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, streamDebateRound } from '@/lib/api';
import type { Round, DebateEvent, CsaResponse } from '@/lib/types';

// ── Role display config ──────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  csa_1:   'border-blue-400   bg-blue-50',
  csa_2:   'border-green-400  bg-green-50',
  csa_3:   'border-purple-400 bg-purple-50',
  dir_csa: 'border-orange-400 bg-orange-50',
};

function RoundCard({ round }: { round: Round }) {
  return (
    <div className="border rounded p-4 bg-white space-y-3">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
        Round {round.round_number}
      </p>
      <div className="bg-gray-100 rounded p-3">
        <p className="text-xs font-semibold text-gray-500 mb-1">PM</p>
        <p className="text-sm">{round.pm_message}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.values(round.csa_responses).map(r => (
          <AgentCard key={r.role} resp={r} />
        ))}
      </div>
      <AgentCard resp={round.dir_response} full />
    </div>
  );
}

function AgentCard({ resp, full }: { resp: CsaResponse; full?: boolean }) {
  return (
    <div className={`border-l-4 rounded p-3 ${ROLE_COLORS[resp.role] ?? 'border-gray-300 bg-gray-50'} ${full ? 'col-span-3' : ''}`}>
      <p className="text-xs font-bold text-gray-600 mb-1">{resp.display_name}</p>
      <p className="text-sm whitespace-pre-wrap">{resp.text}</p>
    </div>
  );
}

function DebateContent() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';

  const [rounds, setRounds] = useState<Round[]>([]);
  const [pm, setPm] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [dirBuffer, setDirBuffer] = useState('');
  const [pendingCsa, setPendingCsa] = useState<Record<string, CsaResponse>>({});
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  function scrollBottom() {
    setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }

  useEffect(() => {
    if (!sessionId) return;
    api.debate.listRounds(sessionId).then(setRounds).catch(() => {});
  }, [sessionId]);

  async function runRound() {
    if (!pm.trim() || running || !sessionId) return;
    setRunning(true);
    setError('');
    setDirBuffer('');
    setPendingCsa({});
    setStatus('CSA agents thinking…');
    scrollBottom();

    try {
      await streamDebateRound(sessionId, pm.trim(), (raw) => {
        const evt = raw as DebateEvent;
        if (evt.type === 'csa_done') {
          setPendingCsa(prev => ({
            ...prev,
            [evt.role]: { role: evt.role, display_name: evt.display_name, text: evt.text },
          }));
          setStatus('Dir CSA reviewing…');
        } else if (evt.type === 'dir_chunk') {
          setDirBuffer(prev => prev + evt.text);
        } else if (evt.type === 'round_complete') {
          setRounds(prev => [...prev, evt.round]);
          setDirBuffer('');
          setPendingCsa({});
          setStatus('');
          scrollBottom();
        } else if (evt.type === 'error') {
          setError(evt.message);
          setStatus('');
        }
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      setPm('');
    }
  }

  if (!sessionId) {
    return <p className="text-gray-400 text-sm">Select or create a session first.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">Debate</h1>

      {/* Completed rounds */}
      <div className="space-y-4">
        {rounds.map(r => <RoundCard key={r.round_number} round={r} />)}
      </div>

      {/* Live streaming preview */}
      {running && (
        <div className="border rounded p-4 bg-white space-y-3 animate-pulse-once">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{status}</p>
          {Object.values(pendingCsa).map(r => <AgentCard key={r.role} resp={r} />)}
          {dirBuffer && (
            <div className={`border-l-4 rounded p-3 ${ROLE_COLORS['dir_csa']}`}>
              <p className="text-xs font-bold text-gray-600 mb-1">Dir CSA (streaming…)</p>
              <p className="text-sm whitespace-pre-wrap">{dirBuffer}</p>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* PM input */}
      <div className="flex gap-3 mt-2">
        <textarea
          value={pm}
          onChange={e => setPm(e.target.value)}
          placeholder="Enter your PM message…"
          rows={3}
          disabled={running}
          className="border rounded px-3 py-2 flex-1 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-50"
        />
        <button
          onClick={runRound}
          disabled={running || !pm.trim()}
          className="self-end bg-brand-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
        >
          {running ? 'Running…' : 'Run Round'}
        </button>
      </div>

      <div ref={bottomRef} />
    </div>
  );
}

export default function DebatePage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <DebateContent />
    </Suspense>
  );
}
