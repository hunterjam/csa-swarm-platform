// src/app/setup/page.tsx — Session-scoped role configuration
'use client';

import { useEffect, useState, Suspense, memo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { RoleConfig, AgentConfigResponse } from '@/lib/types';
import { useSession } from '@/lib/session-context';

const AVAILABLE_MODELS = [
  { value: 'gpt-4o',       label: 'GPT-4o (128K)' },
  { value: 'gpt-4.1',      label: 'GPT-4.1 (1M) — recommended' },
  { value: 'gpt-4.1-mini', label: 'GPT-4.1 mini (1M) — budget' },
  { value: 'o4-mini',      label: 'o4-mini (200K) — reasoning' },
  { value: 'gpt-5',        label: 'GPT-5' },
  { value: 'gpt-5.1',      label: 'GPT-5.1' },
] as const;

type ModelValue = typeof AVAILABLE_MODELS[number]['value'];

const BLANK_CSA: RoleConfig = {
  display_name: '',
  role_type: 'csa',
  domain: '',
  lens: '',
  system_prompt: '',
};

// ── Role template library (mirrors MVP 1_Role_Setup.py) ──────────────────
const ROLE_TEMPLATES: Record<string, Partial<RoleConfig>> = {
  'Azure-native Cost-focused CSA': {
    domain: 'Enterprise IT / FinOps',
    lens: 'Cost optimization',
    system_prompt:
      'You are an OGE CSA Agent with deep expertise in Azure cost management and FinOps. ' +
      'Your primary lens is cost optimization — every recommendation must include a cost ' +
      'impact assessment. Favor Azure-native tools (Azure Monitor, Log Analytics, AMBA) ' +
      'at the lowest effective SKU. Flag any recommendation that introduces incremental ' +
      'Azure spend above $5K/month without a clear ROI justification.\n\n' +
      'When advising on observability design, prioritize:\n' +
      '1) Data retention tiering (hot/warm/cold) to minimize Log Analytics ingestion costs\n' +
      '2) Sampling strategies for high-volume telemetry (e.g. OPC-UA, SCADA)\n' +
      '3) Reserved capacity commitments vs. pay-as-you-go tradeoffs\n' +
      '4) Alert noise reduction to avoid alert fatigue and excessive Action Group calls',
  },
  'Edge & Remote Site CSA': {
    domain: 'Upstream field operations / edge computing',
    lens: 'Disconnected & low-bandwidth environments',
    system_prompt:
      'You are an OGE CSA Agent specializing in edge and remote-site observability. ' +
      'Your customer base operates in environments with intermittent WAN connectivity, ' +
      'constrained bandwidth, and ruggedized hardware.\n\n' +
      'Your design heuristics:\n' +
      '1) Assume connectivity is unreliable — every architecture must have local buffering ' +
      'and store-and-forward telemetry collection\n' +
      '2) Prefer Azure IoT Edge + Arc-enabled servers for edge data collection\n' +
      '3) Minimize cloud round-trips: push analytics to the edge where latency or ' +
      'connectivity constraints require it\n' +
      '4) Flag any solution that requires continuous internet connectivity as a risk\n' +
      '5) All IaC must be deployable via Azure Arc at-scale to remote sites',
  },
  'Security & Compliance CSA': {
    domain: 'OT/IT security and regulatory compliance',
    lens: 'Security-first, compliance-aware',
    system_prompt:
      "You are an OGE CSA Agent with a security and compliance focus. " +
      "Your mandate is to ensure the observability accelerator meets OGE's security " +
      "posture and relevant regulatory requirements (NERC CIP, ISO 27001, GDPR).\n\n" +
      "Your design heuristics:\n" +
      "1) All telemetry pipelines must enforce encryption in transit and at rest\n" +
      "2) RBAC must be granular: field operators should see only their site's data\n" +
      "3) Audit logging must be comprehensive — who accessed what alert data, when\n" +
      "4) Sensitive operational data must have data sovereignty controls for cross-border sites\n" +
      "5) Flag any recommendation that creates an internet-exposed diagnostic endpoint " +
      "without WAF or Private Endpoint controls",
  },
  'Multi-cloud & Hybrid CSA': {
    domain: 'Multi-cloud and hybrid infrastructure',
    lens: 'Vendor-neutral, integration-focused',
    system_prompt:
      'You are an OGE CSA Agent representing customers with existing investments in ' +
      'AWS, GCP, or on-premises infrastructure alongside Azure. Your focus is on ' +
      'integration patterns that avoid lock-in while delivering a unified observability view.\n\n' +
      'Your design heuristics:\n' +
      '1) Azure Monitor is the preferred pane-of-glass, but ingestion must support ' +
      'non-Azure sources (OpenTelemetry, Prometheus, syslog)\n' +
      '2) Recommend Azure Monitor Managed Grafana as the visualization layer\n' +
      '3) All data connectors must have documented migration paths\n' +
      '4) Highlight where Splunk or Datadog overlaps exist and recommend a ' +
      'consolidation or coexistence strategy',
  },
};

// ── RoleCard ─────────────────────────────────────────────────────────────

interface RoleCardProps {
  roleKey: string;
  label: string;
  defaultRole: RoleConfig;
  override: Partial<RoleConfig>;
  onChange: (roleKey: string, field: keyof RoleConfig, value: string) => void;
  onBootstrap: (roleKey: string, transcript: string, roleType: 'csa' | 'director') => Promise<void>;
  bootstrapping: boolean;
  onRemove?: () => void;
}

function RoleCard({
  roleKey,
  label,
  defaultRole,
  override,
  onChange,
  onBootstrap,
  bootstrapping,
  onRemove,
}: RoleCardProps) {
  const role: RoleConfig = { ...defaultRole, ...override };
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const roleType: 'csa' | 'director' = roleKey === 'dir_csa' ? 'director' : 'csa';

  function applyTemplate(name: string) {
    const tpl = ROLE_TEMPLATES[name];
    if (!tpl) return;
    if (tpl.domain) onChange(roleKey, 'domain', tpl.domain);
    if (tpl.lens) onChange(roleKey, 'lens', tpl.lens);
    if (tpl.system_prompt) onChange(roleKey, 'system_prompt', tpl.system_prompt);
    setSelectedTemplate('');
  }

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="bg-brand-50 border-b px-5 py-3 flex items-center justify-between">
        <h3 className="font-semibold text-brand-900">{label}</h3>
        <div className="flex items-center gap-3">
          {onRemove && (
            <button
              onClick={onRemove}
              className="text-xs text-red-400 hover:text-red-600 transition-colors"
            >
              Remove
            </button>
          )}
          <span className="text-xs text-gray-400 font-mono">{roleKey}</span>
        </div>
      </div>
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left column */}
          <div className="space-y-3">
            {roleKey !== 'dir_csa' && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Load from template
                </label>
                <select
                  value={selectedTemplate}
                  onChange={(e) => {
                    setSelectedTemplate(e.target.value);
                    if (e.target.value) applyTemplate(e.target.value);
                  }}
                  className="border rounded px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none"
                >
                  <option value="">— Select a template —</option>
                  {Object.keys(ROLE_TEMPLATES).map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Display Name</label>
              <input
                value={role.display_name}
                onChange={(e) => onChange(roleKey, 'display_name', e.target.value)}
                className="border rounded px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Domain</label>
              <input
                value={role.domain}
                onChange={(e) => onChange(roleKey, 'domain', e.target.value)}
                placeholder="e.g. Upstream field operations"
                className="border rounded px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Analytical Lens</label>
              <input
                value={role.lens}
                onChange={(e) => onChange(roleKey, 'lens', e.target.value)}
                placeholder="e.g. Cost optimization"
                className="border rounded px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none"
              />
            </div>
          </div>

          {/* Right column: system prompt */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">System Prompt</label>
              <textarea
                value={role.system_prompt}
                onChange={(e) => onChange(roleKey, 'system_prompt', e.target.value)}
                rows={8}
                className="border rounded px-3 py-2 w-full text-xs font-mono focus:ring-2 focus:ring-brand-600 focus:outline-none resize-y"
              />
            </div>
          </div>
        </div>

        {/* Transcript bootstrap */}
        <div>
          <button
            onClick={() => setShowTranscript((p) => !p)}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium transition-colors"
          >
            {showTranscript ? '▾ Hide' : '▸ Generate from Transcript'}
          </button>
          {showTranscript && (
            <div className="mt-3 space-y-2 border rounded p-3 bg-gray-50">
              <p className="text-xs text-gray-500">
                Paste a meeting transcript. The AI will extract a draft role — review before saving.
              </p>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                placeholder="Paste transcript here…"
                className="border rounded px-3 py-2 w-full text-xs focus:ring-2 focus:ring-brand-600 focus:outline-none resize-y"
              />
              <button
                onClick={() => onBootstrap(roleKey, transcript, roleType)}
                disabled={bootstrapping || transcript.trim().length < 50}
                className="bg-brand-600 text-white px-4 py-1.5 rounded text-xs font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {bootstrapping ? 'Generating…' : '✨ Generate Role from Transcript'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Wizard steps ─────────────────────────────────────────────────────────

const MemoRoleCard = memo(RoleCard);

const WIZARD_STEPS = ['Model', 'CSA Roles', 'Director', 'Review'] as const;

const MODEL_DESCRIPTIONS: Record<string, string> = {
  '':            'Standard reasoning, 128K context',
  'gpt-4.1':     'Recommended — 1M context window',
  'gpt-4.1-mini':'Budget-friendly, 1M context window',
  'o4-mini':     'Chain-of-thought reasoning, 200K context',
  'gpt-5':       'Latest flagship model',
  'gpt-5.1':     'Next-generation model, 200K context',
};

// ── Main page ─────────────────────────────────────────────────────────────

function SetupContent() {
  const params = useSearchParams();
  const { activeSessionId, setActiveSessionId } = useSession();
  const sessionId = params.get('session') ?? activeSessionId;

  useEffect(() => {
    const p = params.get('session');
    if (p) setActiveSessionId(p);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const [config, setConfig] = useState<AgentConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapTarget, setBootstrapTarget] = useState<string | null>(null);
  const [error, setError] = useState('');
  // Local edits buffer: role_key → partial overrides
  const [edits, setEdits] = useState<Record<string, Partial<RoleConfig>>>({});
  // Extra CSA role keys added by the user (not in defaults)
  const [extraKeys, setExtraKeys] = useState<string[]>([]);
  // Model selector
  const [model, setModel] = useState<ModelValue | ''>('');
  // Wizard
  const [step, setStep] = useState(1);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    setLoading(true);
    Promise.all([
      api.agentConfig.get(sessionId),
      api.sessions.get(sessionId),
    ])
      .then(([c, s]) => {
        setConfig(c);
        setEdits(c.overrides ?? {});
        setModel((s.model as ModelValue) ?? '');
        const savedExtra = Object.keys(c.overrides ?? {}).filter(
          (k) => k.startsWith('csa_') && !c.defaults[k]
        );
        setExtraKeys(savedExtra);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const handleChange = useCallback((roleKey: string, field: keyof RoleConfig, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [roleKey]: { ...(prev[roleKey] ?? {}), [field]: value },
    }));
  }, []);

  async function handleBootstrap(
    roleKey: string,
    transcript: string,
    roleType: 'csa' | 'director',
  ) {
    if (!sessionId) return;
    setBootstrapping(true);
    setBootstrapTarget(roleKey);
    setError('');
    try {
      const result = await api.agentConfig.bootstrap(sessionId, transcript, roleType);
      setEdits((prev) => ({
        ...prev,
        [roleKey]: { ...(prev[roleKey] ?? {}), ...result },
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBootstrapping(false);
      setBootstrapTarget(null);
    }
  }

  function handleAddRole() {
    if (!config) return;
    const allCsaKeys = [
      ...Object.keys(config.defaults).filter((k) => k.startsWith('csa_')),
      ...extraKeys,
    ];
    if (allCsaKeys.length >= 8) return;
    const maxNum = allCsaKeys.reduce((max, k) => {
      const n = parseInt(k.replace('csa_', ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const newKey = `csa_${maxNum + 1}`;
    setExtraKeys((prev) => [...prev, newKey]);
    setEdits((prev) => ({
      ...prev,
      [newKey]: {
        display_name: `CSA ${maxNum + 1}`,
        role_type: 'csa',
        domain: '',
        lens: '',
        system_prompt: '',
      },
    }));
  }

  function handleRemoveRole(key: string) {
    setExtraKeys((prev) => prev.filter((k) => k !== key));
    setEdits((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  async function handleFinish() {
    if (!sessionId) return;
    setSaving(true);
    setError('');
    try {
      // Sequential: agent config does a full doc read→write, so model must be
      // persisted first — otherwise the parallel writes race and the later
      // agent config write stomps the just-saved model value.
      await api.sessions.patch(sessionId, { model: model || null });
      await api.agentConfig.put(sessionId, edits);
      setDone(true);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!sessionId) {
    return <p className="text-gray-400 text-sm">Select or create a session first.</p>;
  }
  if (loading) return <p className="text-gray-400 text-sm">Loading…</p>;
  if (!config) return error ? <p className="text-red-600 text-sm">{error}</p> : null;

  const defaults = config.defaults;
  const extraCsaKeys = extraKeys.filter((k) => !defaults[k]);
  const allCsaKeys = [
    ...Object.keys(defaults).filter((k) => k.startsWith('csa_')),
    ...extraCsaKeys,
  ].sort((a, b) => a.localeCompare(b));
  const csaCount = allCsaKeys.length;

  // ── Done state ────────────────────────────────────────────────────────
  if (done) {
    return (
      <div className="flex flex-col items-center justify-center py-16 space-y-5 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-brand-900">Session configured!</h2>
        <p className="text-sm text-gray-500 max-w-sm">
          {csaCount} CSA agent{csaCount !== 1 ? 's' : ''} + the Director are set up and ready.
        </p>
        <div className="flex gap-3">
          <button
            onClick={() => { setDone(false); setStep(1); }}
            className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
          >
            Edit setup
          </button>
          <a
            href={`/debate?session=${sessionId}`}
            className="bg-brand-600 text-white px-5 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
          >
            Go to Debate →
          </a>
        </div>
      </div>
    );
  }

  // ── Step indicator ────────────────────────────────────────────────────
  const StepBar = () => (
    <div className="flex items-start w-full">
      {WIZARD_STEPS.map((label, idx) => {
        const num = idx + 1;
        const isCompleted = step > num;
        const isCurrent = step === num;
        return (
          <div key={label} className="flex items-center flex-1 last:flex-none">
            <button
              onClick={() => { if (isCompleted) setStep(num); }}
              disabled={!isCompleted}
              className="flex flex-col items-center gap-1.5 disabled:cursor-default group"
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                ${isCompleted
                  ? 'bg-brand-600 border-brand-600 text-white group-hover:bg-brand-700 cursor-pointer'
                  : isCurrent
                    ? 'border-brand-600 text-brand-600 bg-white'
                    : 'border-gray-300 text-gray-400 bg-white'}`}
              >
                {isCompleted ? '✓' : num}
              </span>
              <span className={`text-xs font-medium hidden sm:block whitespace-nowrap
                ${isCurrent ? 'text-brand-700' : isCompleted ? 'text-brand-600' : 'text-gray-400'}`}>
                {label}
              </span>
            </button>
            {idx < WIZARD_STEPS.length - 1 && (
              <div className={`flex-1 h-0.5 mx-2 mb-5 transition-colors ${step > num ? 'bg-brand-600' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Role Setup</h1>
        <p className="text-sm text-gray-500 mt-1">
          Configure agents for this session — step {step} of {WIZARD_STEPS.length}.
        </p>
      </div>

      <StepBar />

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* ── Step 1: Model ────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="border rounded-lg bg-white overflow-hidden">
            <div className="bg-brand-50 border-b px-5 py-3">
              <h3 className="font-semibold text-brand-900">Choose AI Model</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                This model powers every agent in this session.
              </p>
            </div>
            <div className="p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {([
                  { value: '' as const, label: 'Default (gpt-4o)' },
                  ...AVAILABLE_MODELS,
                ] as { value: ModelValue | ''; label: string }[]).map((m) => (
                  <label
                    key={m.value}
                    className={`flex items-start gap-3 rounded-lg border-2 p-4 cursor-pointer transition-colors
                      ${model === m.value
                        ? 'border-brand-600 bg-brand-50'
                        : 'border-gray-200 hover:border-brand-300'}`}
                  >
                    <input
                      type="radio"
                      name="model"
                      value={m.value}
                      checked={model === m.value}
                      onChange={() => setModel(m.value)}
                      className="mt-0.5 accent-brand-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-800">{m.label}</p>
                      <p className="text-xs text-gray-500">{MODEL_DESCRIPTIONS[m.value] ?? ''}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setStep(2)}
              className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Next: CSA Roles →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: CSA Roles ────────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Configure your CSA agents ({csaCount}/8). Each brings a distinct perspective to the debate.
          </p>
          {allCsaKeys.map((key) => (
            <MemoRoleCard
              key={key}
              roleKey={key}
              label={`CSA ${key.replace('csa_', '')}`}
              defaultRole={defaults[key] ?? BLANK_CSA}
              override={edits[key] ?? {}}
              onChange={handleChange}
              onBootstrap={handleBootstrap}
              bootstrapping={bootstrapping && bootstrapTarget === key}
              onRemove={!defaults[key] ? () => handleRemoveRole(key) : undefined}
            />
          ))}
          {csaCount < 8 && (
            <button
              onClick={handleAddRole}
              className="w-full border-2 border-dashed border-brand-300 rounded-lg py-3 text-sm text-brand-600 font-medium hover:border-brand-600 hover:bg-brand-50 transition-colors"
            >
              + Add CSA role ({csaCount}/8 configured)
            </button>
          )}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(1)}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(3)}
              className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Next: Director →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 3: Director ─────────────────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            The Director synthesizes all CSA inputs into a final round summary.
          </p>
          {defaults['dir_csa'] && (
            <MemoRoleCard
              roleKey="dir_csa"
              label="Dir CSA (Director)"
              defaultRole={defaults['dir_csa']}
              override={edits['dir_csa'] ?? {}}
              onChange={handleChange}
              onBootstrap={handleBootstrap}
              bootstrapping={bootstrapping && bootstrapTarget === 'dir_csa'}
            />
          )}
          <div className="flex justify-between">
            <button
              onClick={() => setStep(2)}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={() => setStep(4)}
              className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 transition-colors"
            >
              Next: Review →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 4: Review & Save ────────────────────────────────────── */}
      {step === 4 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-500">
            Review your configuration before saving. Click any section to edit.
          </p>
          <div className="border rounded-lg bg-white overflow-hidden divide-y">
            {/* Model */}
            <div className="px-5 py-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Model</p>
                <p className="text-sm font-semibold text-gray-800">
                  {AVAILABLE_MODELS.find((m) => m.value === model)?.label ?? 'Default (gpt-4o)'}
                </p>
              </div>
              <button onClick={() => setStep(1)} className="text-xs text-brand-600 hover:underline">
                Edit
              </button>
            </div>
            {/* CSA Agents */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  CSA Agents ({csaCount})
                </p>
                <button onClick={() => setStep(2)} className="text-xs text-brand-600 hover:underline">
                  Edit
                </button>
              </div>
              <div className="space-y-2">
                {allCsaKeys.map((key) => {
                  const role = { ...(defaults[key] ?? BLANK_CSA), ...(edits[key] ?? {}) };
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{role.display_name || key}</span>
                      <span className="text-xs text-gray-400 truncate ml-4 max-w-xs text-right">{role.domain || '—'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            {/* Director */}
            {defaults['dir_csa'] && (
              <div className="px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-0.5">Director</p>
                  <p className="text-sm font-semibold text-gray-800">
                    {edits['dir_csa']?.display_name ?? defaults['dir_csa'].display_name}
                  </p>
                </div>
                <button onClick={() => setStep(3)} className="text-xs text-brand-600 hover:underline">
                  Edit
                </button>
              </div>
            )}
          </div>
          <div className="flex justify-between">
            <button
              onClick={() => setStep(3)}
              className="text-sm text-gray-500 hover:text-gray-700 px-4 py-2 rounded border hover:bg-gray-50 transition-colors"
            >
              ← Back
            </button>
            <button
              onClick={handleFinish}
              disabled={saving}
              className="bg-brand-600 text-white px-6 py-2 rounded text-sm font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving…' : 'Save & Finish'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SetupPage() {
  return (
    <Suspense fallback={<p className="text-gray-400 text-sm">Loading…</p>}>
      <SetupContent />
    </Suspense>
  );
}
