// src/app/history/page.tsx — Session history (read-only rounds viewer)
'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { Round } from '@/lib/types';

const ROLE_COLORS: Record<string, string> = {
  csa_1:   'border-blue-400   bg-blue-50',
  csa_2:   'border-green-400  bg-green-50',
  csa_3:   'border-purple-400 bg-purple-50',
  dir_csa: 'border-orange-400 bg-orange-50',
};

function HistoryContent() {
  const params = useSearchParams();
  const sessionId = params.get('session') ?? '';

  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    api.debate
      .listRounds(sessionId)
      .then(setRounds)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  if (!sessionId) return <p className="text-gray-400 text-sm">Select a session first.</p>;
  if (loading) return <p className="text-gray-400 text-sm">Loading…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-brand-900">Debate History</h1>
      {error && <p className="text-red-600 text-sm">{error}</p>}
      {rounds.length === 0 ? (
        <p className="text-gray-400 text-sm">No rounds yet.</p>
      ) : (
        rounds.map(r => (
          <div key={r.round_number} className="border rounded p-4 bg-white space-y-3">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
              Round {r.round_number} · {new Date(r.created_at).toLocaleString()}
            </p>
            <div className="bg-gray-100 rounded p-3">
              <p className="text-xs font-semibold text-gray-500 mb-1">PM</p>
              <p className="text-sm">{r.pm_message}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.values(r.csa_responses).map(resp => (
                <div key={resp.role} className={`border-l-4 rounded p-3 ${ROLE_COLORS[resp.role] ?? 'border-gray-300 bg-gray-50'}`}>
                  <p className="text-xs font-bold text-gray-600 mb-1">{resp.display_name}</p>
                  <p className="text-sm whitespace-pre-wrap">{resp.text}</p>
                </div>
              ))}
            </div>
            <div className={`border-l-4 rounded p-3 ${ROLE_COLORS['dir_csa']}`}>
              <p className="text-xs font-bold text-gray-600 mb-1">{r.dir_response.display_name} (Director Review)</p>
              <p className="text-sm whitespace-pre-wrap">{r.dir_response.text}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function HistoryPage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <HistoryContent />
    </Suspense>
  );
}
