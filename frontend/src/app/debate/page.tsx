// src/app/debate/page.tsx
'use client';

import { useEffect, useRef, useState, Suspense, memo } from 'react';
import { flushSync } from 'react-dom';
import { useSearchParams } from 'next/navigation';
import { api, streamDebateRound } from '@/lib/api';
import type { Round, DebateEvent, CsaResponse } from '@/lib/types';
import { useSession } from '@/lib/session-context';
import { Markdown } from '@/components/Markdown';
import { InfoBanner } from '@/components/InfoBanner';

// ── Starter prompts ─────────────────────────────────────────────────────
const STARTER_PROMPTS: { label: string; text: string }[] = [
  {
    label: 'Baseline Azure monitoring architecture',
    text:
      "What should the baseline Azure-native monitoring architecture look like for OGE customers? " +
      "Focus on AMBA, Azure Monitor, and Log Analytics as the foundation, and define what 'done' looks like for the MVP.",
  },
  {
    label: 'Alert routing & operational handoff',
    text:
      "How should alerts be routed from Azure Monitor to field operations teams? " +
      "Define the handoff process between automated alerting and human escalation, including on-call integration patterns.",
  },
  {
    label: 'Multi-region & edge observability',
    text:
      "How do we extend observability to edge sites and remote field locations with intermittent connectivity? " +
      "What are the data collection and buffering patterns for upstream production environments?",
  },
  {
    label: 'IaC deployment strategy',
    text:
      "What Infrastructure-as-Code approach should we adopt for the observability accelerator? " +
      "Compare Bicep vs. Terraform for this OGE use case and recommend a reusable module structure.",
  },
  {
    label: 'Third-party tool integration',
    text:
      "Several OGE customers already use Splunk or Datadog. How should the accelerator handle integration with " +
      "existing third-party observability tools while keeping Azure-native as the baseline?",
  },
  {
    label: 'Cost optimization & governance',
    text:
      "What are the main cost drivers in Azure Monitor and Log Analytics at OGE scale? " +
      "Recommend a data retention and sampling strategy that balances observability completeness with cost governance.",
  },
  {
    label: 'Security & compliance requirements',
    text:
      "What security and compliance controls must be baked into the observability accelerator for OGE? " +
      "Consider NERC CIP, data sovereignty for international sites, and RBAC for sensitive operational data.",
  },
  {
    label: 'SRE Agent enablement',
    text:
      "How do we layer SRE Agent capabilities on top of the Azure-native baseline? " +
      "Define the trigger conditions, autonomy boundaries, and human-in-the-loop escalation paths for automated remediation.",
  },
];

// ── Role display config ──────────────────────────────────────────────────
const ROLE_COLORS: Record<string, string> = {
  csa_1:   'border-blue-400   bg-blue-50',
  csa_2:   'border-green-400  bg-green-50',
  csa_3:   'border-purple-400 bg-purple-50',
  dir_csa: 'border-orange-400 bg-orange-50',
};

const RoundCard = memo(function RoundCard({ round }: { round: Round }) {
  return (
    <div className="border rounded p-4 bg-white space-y-3">
      <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
        Round {round.round_number}{round.created_at ? ` · ${new Date(round.created_at).toLocaleString()}` : ''}
      </p>
      <div className="bg-gray-100 rounded p-3">
        <p className="text-xs font-semibold text-gray-500 mb-1">PM</p>
        <p className="text-sm">{round.pm_message}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {Object.entries(round.csa_responses).map(([roleKey, r]) => (
          <AgentCard key={roleKey} resp={r} />
        ))}
      </div>
      <AgentCard resp={round.dir_response} full />
    </div>
  );
});

const AgentCard = memo(function AgentCard({ resp, full }: { resp: CsaResponse; full?: boolean }) {
  return (
    <div className={`border-l-4 rounded p-3 ${ROLE_COLORS[resp.role] ?? 'border-gray-300 bg-gray-50'} ${full ? 'col-span-3' : ''}`}>
      <p className="text-xs font-bold text-gray-600 mb-2">{resp.display_name}</p>
      <Markdown size="compact">{resp.text}</Markdown>
    </div>
  );
});

function DebateContent() {
  const params = useSearchParams();
  const { activeSessionId, setActiveSessionId } = useSession();
  const sessionId = params.get('session') ?? activeSessionId;

  // Sync context whenever the URL carries an explicit session param
  useEffect(() => {
    const p = params.get('session');
    if (p) setActiveSessionId(p);
  }, [params]);

  const [rounds, setRounds] = useState<Round[]>([]);
  const [pm, setPm] = useState('');
  const [selectedStarter, setSelectedStarter] = useState('');
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState('');
  const [dirBuffer, setDirBuffer] = useState('');
  const dirBufferRef = useRef('');
  const dirFlushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const csaBufferRef = useRef<Record<string, { display_name: string; text: string; done: boolean }>>({});
  const [csaBuffers, setCsaBuffers] = useState<Record<string, { display_name: string; text: string; done: boolean }>>({});
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
    dirBufferRef.current = '';
    csaBufferRef.current = {};
    setCsaBuffers({});
    setStatus('CSA agents responding…');
    scrollBottom();

    // Flush accumulated chunks to state at most every 150ms to avoid
    // blocking React's message-channel scheduler with full markdown re-parses.
    dirFlushRef.current = setInterval(() => {
      setDirBuffer(dirBufferRef.current);
      setCsaBuffers({ ...csaBufferRef.current });
    }, 150);

    try {
      await streamDebateRound(sessionId, pm.trim(), (raw) => {
        const evt = raw as DebateEvent;
        if (evt.type === 'csa_chunk') {
          const prev = csaBufferRef.current[evt.role] ?? { display_name: evt.display_name, text: '', done: false };
          csaBufferRef.current[evt.role] = { ...prev, text: prev.text + evt.text };
        } else if (evt.type === 'csa_done') {
          csaBufferRef.current[evt.role] = { display_name: evt.display_name, text: evt.text, done: true };
          // flushSync forces React to commit this render BEFORE the for-loop continues
          // to dir_chunk events, even if they arrived in the same TCP read chunk.
          flushSync(() => setCsaBuffers({ ...csaBufferRef.current }));
          if (Object.values(csaBufferRef.current).every(v => v.done)) {
            setStatus('Dir CSA synthesizing…');
          }
        } else if (evt.type === 'dir_chunk') {
          dirBufferRef.current += evt.text;  // accumulate without triggering render
        } else if (evt.type === 'round_complete') {
          if (dirFlushRef.current) { clearInterval(dirFlushRef.current); dirFlushRef.current = null; }
          setRounds(prev => [...prev, evt.round]);
          setDirBuffer('');
          dirBufferRef.current = '';
          csaBufferRef.current = {};
          setCsaBuffers({});
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
      if (dirFlushRef.current) { clearInterval(dirFlushRef.current); dirFlushRef.current = null; }
      setRunning(false);
      setPm('');
      setSelectedStarter('');
    }
  }

  if (!sessionId) {
    return <p className="text-gray-400 text-sm">Select or create a session first.</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-brand-900">Debate</h1>

      <InfoBanner title="Step 4 of 5 — Run the multi-agent debate" storageKey="info-debate">
        <p>Enter a <strong>PM message</strong> — a design question or scenario for the agents to debate. Each round, all CSA agents respond in parallel, then the Director CSA synthesizes their views.</p>
        <ul className="list-disc ml-4 mt-1 space-y-0.5">
          <li>Use the <strong>quick-start prompts</strong> dropdown to load a pre-written scenario.</li>
          <li>Run <strong>multiple rounds</strong> to drill deeper — agents see prior rounds and build on them.</li>
          <li>Each round is saved automatically and will be used to generate your deliverables.</li>
          <li>Watch for the three CSA cards to appear first, then the Director CSA synthesis below them.</li>
        </ul>
      </InfoBanner>

      {/* Completed rounds */}
      <div className="space-y-4">
        {rounds.map(r => <RoundCard key={r.round_number} round={r} />)}
      </div>

      {/* Live streaming preview */}
      {running && (
        <div className="border rounded p-4 bg-white space-y-3 animate-pulse-once">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">{status}</p>
          {Object.keys(csaBuffers).length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {Object.entries(csaBuffers).map(([role, buf]) => (
                <div key={role} className={`border-l-4 rounded p-3 ${ROLE_COLORS[role] ?? 'border-gray-300 bg-gray-50'}`}>
                  <p className="text-xs font-bold text-gray-600 mb-2">
                    {buf.display_name}{!buf.done ? ' (streaming…)' : ''}
                  </p>
                  <Markdown size="compact">{buf.text}</Markdown>
                </div>
              ))}
            </div>
          )}
          {dirBuffer && (
            <div className={`border-l-4 rounded p-3 ${ROLE_COLORS['dir_csa']}`}>
              <p className="text-xs font-bold text-gray-600 mb-2">Dir CSA (streaming…)</p>
              <Markdown size="compact">{dirBuffer}</Markdown>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Starter prompts + PM input */}
      <div className="space-y-2 mt-2">
        <div className="flex items-center gap-2">
          <select
            value={selectedStarter}
            onChange={e => {
              const val = e.target.value;
              setSelectedStarter(val);
              if (val) setPm(val);
            }}
            disabled={running}
            className="border rounded px-3 py-1.5 text-sm text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-600 disabled:opacity-50 flex-1 max-w-xs"
          >
            <option value="">Quick-start prompt…</option>
            {STARTER_PROMPTS.map(p => (
              <option key={p.label} value={p.text}>{p.label}</option>
            ))}
          </select>
          {selectedStarter && (
            <button
              onClick={() => { setSelectedStarter(''); setPm(''); }}
              className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex gap-3">
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
      </div>

      <div ref={bottomRef} />

      {/* Wizard footer */}
      <div className="flex justify-between pt-2 border-t mt-4">
        <a
          href={sessionId ? `/setup?session=${sessionId}` : '/setup'}
          className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
        >
          ← Setup
        </a>
        <a
          href={sessionId ? `/recommendations?session=${sessionId}` : '/recommendations'}
          className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
        >
          Next: Deliverables →
        </a>
      </div>
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
