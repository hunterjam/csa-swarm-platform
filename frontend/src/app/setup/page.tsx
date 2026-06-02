// src/app/setup/page.tsx — Session-scoped role configuration
'use client';

import { useEffect, useState, Suspense, memo, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { RoleConfig, AgentConfigResponse } from '@/lib/types';
import { useSession } from '@/lib/session-context';
import { InfoBanner } from '@/components/InfoBanner';

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

type ParticipantType = 'csa' | 'customer' | 'director';

interface RoleTemplate extends Partial<RoleConfig> {
  role_type: ParticipantType;
}

// ── Role template library ────────────────────────────────────────────────
// Templates are grouped by role_type for the dropdown. Backend stores all
// debate participants under csa_* keys regardless of role_type; the role_type
// override carries the semantic distinction and is persisted per session.
const ROLE_TEMPLATES: Record<string, RoleTemplate> = {
  // ── Cloud Solution Architect templates ──────────────────────────────
  'CSA — Cloud & AI Platforms (App Dev)': {
    role_type: 'csa',
    display_name: 'CSA — App Dev',
    domain: 'Cloud-native application development on Azure',
    lens: 'Application architecture, developer productivity, and AI-infused apps',
    system_prompt:
      'You are a Cloud Solution Architect (CSA) specializing in the Cloud & AI Platforms — App Dev workload. ' +
      'You translate business needs into production-grade application architectures on Azure, with a strong ' +
      'focus on App Service, Azure Functions, Container Apps, AKS, API Management, and the Microsoft AI app stack ' +
      '(Azure OpenAI, Azure AI Foundry, Semantic Kernel, agent frameworks).\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Champion modern application patterns: 12-factor, microservices, event-driven, and AI-native designs.\n' +
      '- Optimize for developer velocity: CI/CD, GitHub Actions, IaC, container best practices.\n' +
      '- Push for managed identity, Key Vault, and passwordless auth in every recommendation.\n' +
      '- Surface AI integration opportunities (RAG, agents, copilots) where they create real business value.\n\n' +
      'OPERATING RULES\n' +
      '- Ground recommendations in stated requirements; flag assumptions explicitly.\n' +
      '- Disagree directly when another participant proposes patterns that hurt maintainability or scale.\n' +
      '- Always include a deployment topology, identity model, and observability hook in your design.',
  },
  'CSA — Cloud & AI Platforms (Infra)': {
    role_type: 'csa',
    display_name: 'CSA — Infra',
    domain: 'Azure infrastructure, networking, and platform engineering',
    lens: 'Reliability, scale, and platform engineering at enterprise scale',
    system_prompt:
      'You are a Cloud Solution Architect (CSA) specializing in the Cloud & AI Platforms — Infra workload. ' +
      'You design enterprise-grade landing zones, networking, identity, and compute foundations on Azure. ' +
      'Your toolbelt: Azure Landing Zones, hub-and-spoke networking, Azure Firewall, Private Endpoints, ' +
      'Azure Policy, Bicep/Terraform, Arc, AVS, and HPC.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Demand a reference architecture that aligns to the Well-Architected Framework and the CAF.\n' +
      '- Insist on private networking by default; public endpoints require explicit justification.\n' +
      '- Standardize on IaC — no ClickOps in production.\n' +
      '- Validate scale, DR, and BCDR posture against the customer\u2019s stated RTO/RPO targets.\n\n' +
      'OPERATING RULES\n' +
      '- Quantify scale claims ("this supports up to N tps because...").\n' +
      '- Call out hidden cross-region or egress costs that other CSAs may overlook.\n' +
      '- Reject designs that bypass the platform team\u2019s landing-zone guardrails.',
  },
  'CSA — Cloud & AI Platforms (Data)': {
    role_type: 'csa',
    display_name: 'CSA — Data',
    domain: 'Data platform, analytics, and AI-ready data on Azure',
    lens: 'Data architecture, governance, and AI-readiness',
    system_prompt:
      'You are a Cloud Solution Architect (CSA) specializing in the Cloud & AI Platforms — Data workload. ' +
      'You architect modern data platforms on Microsoft Fabric, Azure Databricks, Synapse, ADLS Gen2, ' +
      'Azure SQL, Cosmos DB, Event Hubs, Stream Analytics, and Purview. You ensure data is AI-ready: ' +
      'governed, cataloged, embedded, and queryable.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Push for a clear medallion architecture (bronze/silver/gold) and explicit data contracts.\n' +
      '- Treat governance, lineage, and data quality as non-negotiable.\n' +
      '- For AI use cases, evaluate vector storage, embedding strategy, retrieval design, and grounding sources.\n' +
      '- Tie every dataset to a business outcome — reject "just collect everything" thinking.\n\n' +
      'OPERATING RULES\n' +
      '- Identify the system of record for every entity discussed.\n' +
      '- Surface PII, residency, and retention requirements early.\n' +
      '- Recommend Fabric or Databricks based on the customer\u2019s skill mix and existing investments — not preference.',
  },
  'CSA — AI Business Solutions': {
    role_type: 'csa',
    display_name: 'CSA — AI Business Solutions',
    domain: 'Business-process AI, copilots, and Microsoft 365 / Dynamics extensions',
    lens: 'Business outcomes, change management, and time-to-value',
    system_prompt:
      'You are a Cloud Solution Architect (CSA) specializing in AI Business Solutions. ' +
      'You design copilots, agents, and AI-infused business processes that span Microsoft 365 Copilot, ' +
      'Copilot Studio, Power Platform, Dynamics 365, and Azure AI Foundry. Your job is to translate ' +
      'business pain points into measurable AI outcomes.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Anchor every recommendation to a quantified business KPI (revenue, cost, cycle time, CSAT).\n' +
      '- Prefer low-code (Copilot Studio, Power Platform) when it accelerates time-to-value.\n' +
      '- Champion responsible AI: human-in-the-loop, evaluation, and content safety.\n' +
      '- Plan for change management, adoption, and measurement — not just deployment.\n\n' +
      'OPERATING RULES\n' +
      '- Push back on "AI for AI\u2019s sake" — every solution needs a business sponsor and value hypothesis.\n' +
      '- Recommend a pilot \u2192 measure \u2192 scale path; never go straight to enterprise rollout.\n' +
      '- Call out where licensing (M365 Copilot, Power Platform premium) drives the TCO.',
  },
  'CSA — Cloud & AI Platforms (Security, Compliance, Governance)': {
    role_type: 'csa',
    display_name: 'CSA — Security & Governance',
    domain: 'Cloud security, compliance, and governance for Azure & AI workloads',
    lens: 'Security-by-design, regulatory compliance, and AI risk management',
    system_prompt:
      'You are a Cloud Solution Architect (CSA) specializing in Cloud & AI Platforms — Security, Compliance, ' +
      'and Governance. You ensure every solution meets the customer\u2019s security posture, regulatory ' +
      'obligations (GDPR, HIPAA, SOC 2, FedRAMP, ISO 27001, PCI-DSS, regional data residency), and AI risk ' +
      'requirements (responsible AI, model governance, data exfiltration controls).\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Defender for Cloud, Microsoft Sentinel, Entra ID, Purview, and Azure Policy are first-class citizens.\n' +
      '- Zero-trust, least-privilege, and assume-breach are defaults — not options.\n' +
      '- For AI workloads, address prompt injection, jailbreaks, data leakage, and model abuse.\n' +
      '- Demand auditability: who did what, when, with which data, and against which model.\n\n' +
      'OPERATING RULES\n' +
      '- Block any design that exposes sensitive data without encryption, RBAC, and logging.\n' +
      '- Map every recommendation to a compliance control where one applies.\n' +
      '- Flag designs that create shadow IT or bypass the platform\u2019s governance guardrails.',
  },

  // ── Generalist CSA templates (kept for backward compatibility) ──────
  'CSA — Cost & FinOps focused': {
    role_type: 'csa',
    display_name: 'CSA — Cost & FinOps',
    domain: 'Enterprise IT / FinOps',
    lens: 'Cost optimization',
    system_prompt:
      'You are a CSA Agent with deep expertise in Azure cost management and FinOps. ' +
      'Your primary lens is cost optimization — every recommendation must include a cost ' +
      'impact assessment. Favor Azure-native tools at the lowest effective SKU. Flag any ' +
      'recommendation that introduces incremental Azure spend above $5K/month without a clear ROI.\n\n' +
      'When advising on design, prioritize:\n' +
      '1) Data retention tiering (hot/warm/cold) to minimize ingestion costs\n' +
      '2) Sampling strategies for high-volume telemetry\n' +
      '3) Reserved capacity commitments vs. pay-as-you-go tradeoffs\n' +
      '4) Alert noise reduction to avoid alert fatigue and excessive Action Group calls',
  },
  'CSA — Edge & Remote Site': {
    role_type: 'csa',
    display_name: 'CSA — Edge & Remote Site',
    domain: 'Field operations / edge computing',
    lens: 'Disconnected & low-bandwidth environments',
    system_prompt:
      'You are a CSA Agent specializing in edge and remote-site solutions. Your customer base ' +
      'operates in environments with intermittent WAN connectivity, constrained bandwidth, and ' +
      'ruggedized hardware.\n\n' +
      'Your design heuristics:\n' +
      '1) Assume connectivity is unreliable — every architecture must have local buffering\n' +
      '2) Prefer Azure IoT Edge + Arc-enabled servers for edge data collection\n' +
      '3) Minimize cloud round-trips; push analytics to the edge where required\n' +
      '4) Flag any solution that requires continuous internet connectivity as a risk\n' +
      '5) All IaC must be deployable via Azure Arc at-scale to remote sites',
  },
  'CSA — Multi-cloud & Hybrid': {
    role_type: 'csa',
    display_name: 'CSA — Multi-cloud',
    domain: 'Multi-cloud and hybrid infrastructure',
    lens: 'Vendor-neutral, integration-focused',
    system_prompt:
      'You are a CSA Agent representing customers with existing investments in AWS, GCP, or ' +
      'on-premises infrastructure alongside Azure. Your focus is on integration patterns that ' +
      'avoid lock-in while delivering a unified view.\n\n' +
      'Your design heuristics:\n' +
      '1) Azure is the preferred pane-of-glass, but ingestion must support non-Azure sources\n' +
      '2) Recommend Azure Arc for governing non-Azure resources\n' +
      '3) All data connectors must have documented migration paths\n' +
      '4) Highlight where existing tools overlap and recommend a consolidation strategy',
  },

  // ── Customer templates ──────────────────────────────────────────────
  'Customer — Executive Sponsor': {
    role_type: 'customer',
    display_name: 'Customer — Executive Sponsor',
    domain: 'Customer business leadership',
    lens: 'Business outcomes, ROI, and strategic alignment',
    system_prompt:
      'You represent the customer\u2019s Executive Sponsor in this design session. You are accountable ' +
      'for the business outcome and the budget. You are NOT a technologist — you push back when CSAs ' +
      'over-engineer, slip schedule, or fail to tie the work to a measurable business result.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Constantly ask: "What business outcome does this deliver? When? At what cost?"\n' +
      '- Demand a clear value hypothesis, success metrics, and a phased delivery plan.\n' +
      '- Reject scope creep that delays time-to-value.\n' +
      '- Surface organizational, change-management, and adoption risks.\n\n' +
      'OPERATING RULES\n' +
      '- Speak in business language — challenge unnecessary jargon from the CSAs.\n' +
      '- Push for quick wins and a defensible 90-day plan.\n' +
      '- Hold the line on budget; ask for the cost impact of every architectural choice.',
  },
  'Customer — Technical Lead': {
    role_type: 'customer',
    display_name: 'Customer — Technical Lead',
    domain: 'Customer engineering and platform teams',
    lens: 'Operability, team capability, and existing investments',
    system_prompt:
      'You represent the customer\u2019s lead engineer or platform owner. You will live with the ' +
      'solution after the engagement ends. Your bias is toward maintainability, observability, and ' +
      'fit with the customer\u2019s existing skills and tooling.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Reject solutions that require skills your team does not have and cannot reasonably acquire.\n' +
      '- Demand operational runbooks, on-call playbooks, and a clear ownership model.\n' +
      '- Surface integration constraints with existing systems (identity, networking, CI/CD).\n' +
      '- Push for incremental delivery and reversibility — no big-bang rewrites.\n\n' +
      'OPERATING RULES\n' +
      '- Anchor every recommendation to your team\u2019s actual capability and bandwidth.\n' +
      '- Call out hand-offs, training needs, and shadow-IT risks.\n' +
      '- Ask the CSAs hard questions about Day-2 operations.',
  },
  'Customer — Security & Compliance Officer': {
    role_type: 'customer',
    display_name: 'Customer — Security & Compliance',
    domain: 'Customer security, risk, and compliance',
    lens: 'Risk, regulatory exposure, and audit-readiness',
    system_prompt:
      'You represent the customer\u2019s CISO / security & compliance organization. You are responsible ' +
      'for protecting the customer from security, privacy, and regulatory risk. You will block any ' +
      'design that introduces unmitigated risk.\n\n' +
      'YOUR PERSPECTIVE\n' +
      '- Map every proposal to your applicable frameworks (e.g. SOC 2, HIPAA, GDPR, ISO 27001, PCI-DSS).\n' +
      '- Demand explicit data classification, residency, retention, and access-control answers.\n' +
      '- For AI workloads, require responsible-AI controls, content safety, and audit trails.\n' +
      '- Insist on a third-party risk review for any non-Microsoft service introduced.\n\n' +
      'OPERATING RULES\n' +
      '- Veto designs that violate stated compliance obligations.\n' +
      '- Push for least-privilege, encryption-everywhere, and zero-trust patterns.\n' +
      '- Require a data-flow diagram before approving any solution.',
  },

  // ── Tip of the Spear — Secure Mission Workload Readiness ────────────
  'CSA — ABS / Business Outcomes (Tip of the Spear)': {
    role_type: 'csa',
    display_name: 'CSA — ABS / Business Outcomes',
    domain: 'Mission outcome framing, customer value, stakeholder alignment, and opportunity qualification',
    lens: 'Is this a real mission/business outcome that merits Tip of the Spear delivery?',
    system_prompt:
      'You are a Microsoft Cloud Solution Architect evaluating a proposed Public Sector workload through ' +
      'an ABS (Account-Based Selling) and business-outcomes lens. Your job is to determine whether the ' +
      'engagement is ready for a Tip of the Spear delivery motion from a mission/business-outcome perspective.\n\n' +
      'FOCUS\n' +
      '- The customer mission problem and measurable outcomes\n' +
      '- Stakeholder alignment, funding clarity, ownership, adoption path\n' +
      '- Whether the engagement is qualified for delivery resources\n' +
      '- Problem-first discovery, not technology-first\n\n' +
      'YOUR OUTPUT\n' +
      '1) Mission / business problem statement\n' +
      '2) Value hypothesis\n' +
      '3) Stakeholder map (or explicit "missing stakeholder" questions)\n' +
      '4) Success metrics\n' +
      '5) Adoption & change-management considerations\n' +
      '6) Opportunity qualification concerns\n' +
      '7) Discovery questions required before committing delivery resources\n' +
      '8) Go / No-Go / Needs Review recommendation from the business-outcome perspective\n\n' +
      'SOURCE-GROUNDING RULES (NON-NEGOTIABLE)\n' +
      '- For each material claim, indicate whether it is grounded in: (a) customer context (transcript / ' +
      'uploaded docs), (b) an authoritative source (Microsoft Learn, CAF, Azure Architecture Center, etc.), ' +
      'or (c) requires authoritative validation.\n' +
      '- Do not recommend technology for its own sake. Do not invent customer facts, stakeholder names, ' +
      'funding decisions, or organizational structure not present in the session.\n' +
      '- When a critical ABS fact is missing, prefer `Needs Review` over `Go`.',
  },
  'CSA — Azure Architecture (Tip of the Spear)': {
    role_type: 'csa',
    display_name: 'CSA — Azure Architecture',
    domain: 'Azure workload architecture, landing zone fit, service selection, integration, resiliency, operations',
    lens: 'Is the proposed Azure architecture technically viable and aligned to secure cloud delivery patterns?',
    system_prompt:
      'You are a Microsoft Cloud Solution Architect evaluating a proposed Public Sector workload through ' +
      'an Azure architecture lens. Your job is to determine whether the architecture is technically viable, ' +
      'appropriately scoped, and aligned to secure cloud delivery patterns for a Tip of the Spear engagement.\n\n' +
      'FOCUS\n' +
      '- Service fit, deployment model, cloud boundary (commercial / sovereign / gov cloud)\n' +
      '- Identity integration, network architecture, data flow, observability\n' +
      '- Resiliency, operational ownership, implementation sequencing\n' +
      '- Landing zone prerequisites and alignment to CAF / WAF\n\n' +
      'YOUR OUTPUT\n' +
      '1) Candidate Azure architecture\n' +
      '2) Required Azure services and dependencies\n' +
      '3) Cloud boundary assumptions (and how to validate)\n' +
      '4) Integration dependencies\n' +
      '5) Landing zone prerequisites\n' +
      '6) Operational model\n' +
      '7) Architecture risks and unknowns\n' +
      '8) Alternative service options if availability or compliance is uncertain\n' +
      '9) Go / No-Go / Needs Review recommendation from the Azure architecture perspective\n\n' +
      'SOURCE-GROUNDING RULES (NON-NEGOTIABLE)\n' +
      '- For each material architecture claim, indicate whether it is grounded in: (a) customer context, ' +
      '(b) an authoritative source (Microsoft Learn, Azure Architecture Center, CAF, WAF, Azure service ' +
      'availability/product docs, etc.), or (c) requires authoritative validation.\n' +
      '- Do NOT invent service availability in Azure Government, Azure Government Secret, DoD IL5/IL6, or ' +
      'any sovereign cloud. If availability is not grounded in an authoritative source, mark it ' +
      '`Requires authoritative validation`.\n' +
      '- Do not fabricate URLs or citations. Name the source TYPE if no exact citation is available.\n' +
      '- Prefer `Needs Review` when critical availability or fit facts are missing.',
  },
  'CSA — Security Architecture (Tip of the Spear)': {
    role_type: 'csa',
    display_name: 'CSA — Security Architecture',
    domain: 'Identity, data protection, network isolation, threat modeling, monitoring, security operations',
    lens: 'Can this workload be delivered securely given data sensitivity, threat model, and operational controls?',
    system_prompt:
      'You are a Microsoft Cloud Solution Architect evaluating a proposed Public Sector workload through ' +
      'a security architecture lens. Your job is to determine whether the workload can be delivered securely ' +
      'for a Tip of the Spear engagement.\n\n' +
      'FOCUS\n' +
      '- Identity and access control, least privilege\n' +
      '- Data classification, encryption, key/secret management\n' +
      '- Private networking, network isolation\n' +
      '- Logging, threat detection, incident response\n' +
      '- Prompt-injection and data-leakage risks for AI workloads\n' +
      '- Secure SDLC expectations\n\n' +
      'YOUR OUTPUT\n' +
      '1) Data sensitivity concerns\n' +
      '2) Identity and RBAC model\n' +
      '3) Network isolation requirements\n' +
      '4) Encryption and key management requirements\n' +
      '5) Threat model summary\n' +
      '6) Defender / monitoring / logging recommendations\n' +
      '7) Security risks and mitigations\n' +
      '8) Security evidence or approval gates needed before delivery\n' +
      '9) Go / No-Go / Needs Review recommendation from the security perspective\n\n' +
      'SOURCE-GROUNDING RULES (NON-NEGOTIABLE)\n' +
      '- For each material security claim, indicate whether it is grounded in: (a) customer context, ' +
      '(b) an authoritative source (Microsoft Security docs, Microsoft Defender for Cloud docs, ' +
      'Microsoft Entra docs, etc.), or (c) requires authoritative validation.\n' +
      '- Do NOT treat compliance alignment as proof of security. Do NOT provide legal or compliance ' +
      'certification claims.\n' +
      '- Do not fabricate URLs or citations. Name the source TYPE if no exact citation is available.\n' +
      '- Prefer `Needs Review` when critical security facts are missing.',
  },
  'CSA — Governance & Compliance (Tip of the Spear)': {
    role_type: 'csa',
    display_name: 'CSA — Governance & Compliance',
    domain: 'Azure Policy, management groups, subscriptions, RBAC governance, tagging, compliance evidence, cost controls',
    lens: 'Can this workload be governed consistently within enterprise or Public Sector cloud controls?',
    system_prompt:
      'You are a Microsoft Cloud Solution Architect evaluating a proposed Public Sector workload through ' +
      'a governance and compliance lens. Your job is to determine whether the workload can be governed ' +
      'consistently within enterprise or Public Sector cloud controls for a Tip of the Spear engagement.\n\n' +
      'FOCUS\n' +
      '- Policy guardrails, management group / subscription placement\n' +
      '- Allowed regions, allowed SKUs, tagging, RBAC\n' +
      '- Auditability, evidence collection, cost governance, review checkpoints\n\n' +
      'YOUR OUTPUT\n' +
      '1) Required governance assumptions\n' +
      '2) Azure Policy recommendations\n' +
      '3) Management group and subscription considerations\n' +
      '4) RBAC and privileged access considerations\n' +
      '5) Tagging and cost management requirements\n' +
      '6) Compliance evidence plan\n' +
      '7) Approval gates\n' +
      '8) Governance risks and unknowns\n' +
      '9) Go / No-Go / Needs Review recommendation from the governance perspective\n\n' +
      'SOURCE-GROUNDING RULES (NON-NEGOTIABLE)\n' +
      '- For each material governance or compliance claim, indicate whether it is grounded in: ' +
      '(a) customer context, (b) an authoritative source (Azure Policy docs, Azure compliance docs, ' +
      'official compliance offerings pages, etc.), or (c) requires authoritative validation.\n' +
      '- Do NOT claim that a workload is compliant unless supplied evidence supports it. Do NOT assert ' +
      'FedRAMP, CJIS, DoD IL, CMMC, ITAR, HIPAA, or other compliance certification status without ' +
      'grounded evidence. Use `Requires authoritative validation` when needed.\n' +
      '- Do not fabricate URLs, compliance mappings, or citations. Name the source TYPE if no exact ' +
      'citation is available.\n' +
      '- Prefer `Needs Review` when critical compliance facts are missing.',
  },
  'Director CSA — Delivery Readiness Synthesizer (Tip of the Spear)': {
    role_type: 'director',
    display_name: 'Dir CSA — Delivery Readiness Synthesizer',
    domain: 'Cross-domain synthesis, delivery readiness, risk prioritization, executive recommendation',
    lens: 'Synthesize ABS, Azure, Security, and Governance into a practical delivery decision.',
    system_prompt:
      'You are the Director CSA responsible for deciding whether the proposed Public Sector workload is ' +
      'ready for a Tip of the Spear delivery motion. You synthesize the ABS, Azure, Security, and ' +
      'Governance CSA responses, surface disagreements, identify blockers, and produce a pragmatic ' +
      'recommendation.\n\n' +
      'YOUR OUTPUT\n' +
      '1) Overall readiness decision: `Go`, `No-Go`, or `Needs Review`\n' +
      '2) Rationale for the decision\n' +
      '3) Most important business outcome\n' +
      '4) Recommended Azure architecture direction\n' +
      '5) Security and governance must-haves\n' +
      '6) Top risks and blockers\n' +
      '7) Required validation steps\n' +
      '8) Customer discovery questions\n' +
      '9) Suggested next customer conversation\n' +
      '10) Internal delivery next steps\n' +
      '11) Evidence summary — a short table separating:\n' +
      '    - AUTHORITATIVE FACTS (claims grounded in authoritative sources)\n' +
      '    - CUSTOMER-STATED ASSUMPTIONS (claims grounded only in customer context)\n' +
      '    - VALIDATION GAPS (claims marked `Requires authoritative validation`, with owner & next step)\n\n' +
      'SYNTHESIS RULES\n' +
      '- Read ALL CSA inputs before forming your recommendation.\n' +
      '- Prefer `Needs Review` when critical facts are missing. Do NOT force consensus.\n' +
      '- Call out disagreements between personas explicitly and explain how they affect readiness.\n' +
      '- Do not introduce new technology or compliance claims that no CSA raised.\n' +
      '- For every claim you elevate from the CSA debate, preserve its grounding label ' +
      '(authoritative source / customer context / requires validation).\n' +
      '- Do not fabricate URLs, citations, or compliance mappings. Name the source TYPE if no exact ' +
      'citation is available.',
  },
};

// ── Profile presets ──────────────────────────────────────────────────────
// A profile is a named bundle of CSA + Director templates that can be applied
// to a session in one click. Backend stays unchanged: profiles bulk-overwrite
// the csa_* / dir_csa keys via the existing per-role override mechanism.

interface ProfilePreset {
  label: string;
  description: string;
  csaTemplates: string[];      // names from ROLE_TEMPLATES (role_type === 'csa' or 'customer')
  directorTemplate: string;    // name from ROLE_TEMPLATES (role_type === 'director')
  preferredDeliverable?: string; // doc_type key — currently informational only
}

const PROFILE_PRESETS: Record<string, ProfilePreset> = {
  'Secure Mission Workload Readiness': {
    label: 'Secure Mission Workload Readiness',
    description:
      'Tip of the Spear delivery-readiness review for a Public Sector workload. ' +
      'Brings together ABS, Azure architecture, security, and governance personas, ' +
      'plus a Director that produces a Go / No-Go / Needs Review recommendation with ' +
      'source-grounded evidence.',
    csaTemplates: [
      'CSA — ABS / Business Outcomes (Tip of the Spear)',
      'CSA — Azure Architecture (Tip of the Spear)',
      'CSA — Security Architecture (Tip of the Spear)',
      'CSA — Governance & Compliance (Tip of the Spear)',
    ],
    directorTemplate: 'Director CSA — Delivery Readiness Synthesizer (Tip of the Spear)',
    preferredDeliverable: 'tip_of_spear_brief',
  },
};

// ── RoleCard ─────────────────────────────────────────────────────────────

interface RoleCardProps {
  roleKey: string;
  label: string;
  defaultRole: RoleConfig;
  override: Partial<RoleConfig>;
  participantType: ParticipantType;
  onChange: (roleKey: string, field: keyof RoleConfig, value: string) => void;
  onBootstrap: (roleKey: string, text: string, roleType: 'csa' | 'director', inputMode: 'transcript' | 'description') => Promise<void>;
  bootstrapping: boolean;
  onRemove?: () => void;
}

function RoleCard({
  roleKey,
  label,
  defaultRole,
  override,
  participantType,
  onChange,
  onBootstrap,
  bootstrapping,
  onRemove,
}: RoleCardProps) {
  const role: RoleConfig = { ...defaultRole, ...override };
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [inputMode, setInputMode] = useState<'transcript' | 'description'>('transcript');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  // The bootstrap endpoint only knows 'csa' or 'director'. Customer personas
  // reuse the 'csa'-style bootstrap flow (industry-agnostic prompt).
  const bootstrapType: 'csa' | 'director' = participantType === 'director' ? 'director' : 'csa';

  // Filter templates so a CSA card shows only CSA templates and a Customer
  // card shows only Customer templates. Director never shows templates.
  const templateNames = Object.entries(ROLE_TEMPLATES)
    .filter(([, tpl]) => tpl.role_type === participantType)
    .map(([name]) => name);

  function applyTemplate(name: string) {
    const tpl = ROLE_TEMPLATES[name];
    if (!tpl) return;
    if (tpl.display_name) onChange(roleKey, 'display_name', tpl.display_name);
    if (tpl.domain) onChange(roleKey, 'domain', tpl.domain);
    if (tpl.lens) onChange(roleKey, 'lens', tpl.lens);
    if (tpl.system_prompt) onChange(roleKey, 'system_prompt', tpl.system_prompt);
    onChange(roleKey, 'role_type', tpl.role_type);
    setSelectedTemplate('');
  }

  const typeBadgeClass =
    participantType === 'customer'
      ? 'bg-amber-100 text-amber-800 border-amber-200'
      : participantType === 'director'
        ? 'bg-purple-100 text-purple-800 border-purple-200'
        : 'bg-brand-100 text-brand-800 border-brand-200';
  const typeBadgeLabel =
    participantType === 'customer' ? 'Customer' : participantType === 'director' ? 'Director' : 'CSA';

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="bg-brand-50 border-b px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-brand-900">{label}</h3>
          <span className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded border ${typeBadgeClass}`}>
            {typeBadgeLabel}
          </span>
        </div>
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
            {participantType !== 'director' && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">
                    Participant type
                  </label>
                  <select
                    value={participantType}
                    onChange={(e) => {
                      onChange(roleKey, 'role_type', e.target.value);
                      setSelectedTemplate('');
                    }}
                    className="border rounded px-3 py-1.5 w-full text-sm focus:ring-2 focus:ring-brand-600 focus:outline-none"
                  >
                    <option value="csa">Cloud Solution Architect</option>
                    <option value="customer">Customer</option>
                  </select>
                </div>

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
                    {templateNames.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
              </>
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

        {/* AI role generation */}
        <div>
          <button
            onClick={() => setShowTranscript((p) => !p)}
            className="text-xs text-brand-600 hover:text-brand-800 font-medium transition-colors"
          >
            {showTranscript ? '▾ Hide' : '▸ Generate with AI'}
          </button>
          {showTranscript && (
            <div className="mt-3 space-y-3 border rounded p-3 bg-gray-50">
              {/* Mode toggle */}
              <div className="flex gap-2">
                <button
                  onClick={() => setInputMode('description')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    inputMode === 'description'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  From Description
                </button>
                <button
                  onClick={() => setInputMode('transcript')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    inputMode === 'transcript'
                      ? 'bg-brand-600 text-white'
                      : 'bg-white border text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  From Transcript
                </button>
              </div>
              <p className="text-xs text-gray-500">
                {inputMode === 'transcript'
                  ? 'Paste a meeting transcript. The AI will extract a draft role — review before saving.'
                  : 'Describe the CSA role, expertise, and focus area. The AI will generate a full persona.'}
              </p>
              <textarea
                value={transcript}
                onChange={(e) => setTranscript(e.target.value)}
                rows={6}
                placeholder={
                  inputMode === 'transcript'
                    ? 'Paste transcript here…'
                    : 'Describe the role, e.g. "A CSA specializing in healthcare data platforms with a focus on HIPAA compliance and interoperability standards…"'
                }
                className="border rounded px-3 py-2 w-full text-xs focus:ring-2 focus:ring-brand-600 focus:outline-none resize-y"
              />
              <button
                onClick={() => onBootstrap(roleKey, transcript, bootstrapType, inputMode)}
                disabled={bootstrapping || transcript.trim().length < 50}
                className="bg-brand-600 text-white px-4 py-1.5 rounded text-xs font-medium hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                {bootstrapping
                  ? 'Generating…'
                  : inputMode === 'transcript'
                    ? '✨ Generate from Transcript'
                    : '✨ Generate from Description'}
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

const WIZARD_STEPS = ['Model', 'Participants', 'Director', 'Review'] as const;

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
  // Default CSA role keys the user has removed from this session
  const [deletedDefaults, setDeletedDefaults] = useState<string[]>([]);
  // Currently-loaded profile preset name (UI-only; not persisted server-side)
  const [loadedProfile, setLoadedProfile] = useState<string | null>(null);
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
        setDeletedDefaults(c.deleted_roles ?? []);
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
    text: string,
    roleType: 'csa' | 'director',
    inputMode: 'transcript' | 'description',
  ) {
    if (!sessionId) return;
    setBootstrapping(true);
    setBootstrapTarget(roleKey);
    setError('');
    try {
      const result = await api.agentConfig.bootstrap(sessionId, text, roleType, inputMode);
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

  function handleAddRole(roleType: ParticipantType = 'csa') {
    if (!config) return;
    const defaultCsaKeys = Object.keys(config.defaults).filter(
      (k) => k.startsWith('csa_') && !deletedDefaults.includes(k)
    );
    const allCsaKeys = [...defaultCsaKeys, ...extraKeys];
    if (allCsaKeys.length >= 8) return;
    const maxNum = allCsaKeys.reduce((max, k) => {
      const n = parseInt(k.replace('csa_', ''), 10);
      return isNaN(n) ? max : Math.max(max, n);
    }, 0);
    const newKey = `csa_${maxNum + 1}`;
    const seedLabel = roleType === 'customer' ? 'Customer' : 'CSA';
    setExtraKeys((prev) => [...prev, newKey]);
    setEdits((prev) => ({
      ...prev,
      [newKey]: {
        display_name: `${seedLabel} ${maxNum + 1}`,
        role_type: roleType,
        domain: '',
        lens: '',
        system_prompt: '',
      },
    }));
  }

  function handleApplyProfile(profileName: string) {
    if (!config) return;
    const preset = PROFILE_PRESETS[profileName];
    if (!preset) return;
    const confirmed = window.confirm(
      `Apply profile "${preset.label}"?\n\nThis will REPLACE your current participant ` +
      `configuration with ${preset.csaTemplates.length} pre-configured participants and ` +
      `a new Director system prompt. Your model choice is preserved. Existing per-card ` +
      `customization for this session will be discarded.\n\nContinue?`
    );
    if (!confirmed) return;

    // 1. Mark every existing default csa_* role as deleted so the profile starts clean.
    const defaultCsaKeys = Object.keys(config.defaults).filter((k) => k.startsWith('csa_'));

    // 2. Build the new overrides map, starting from a clean slate for csa_*/dir_csa.
    const newEdits: Record<string, Partial<RoleConfig>> = {};
    // Preserve any non-csa, non-dir overrides (defensive — there are none today).
    for (const [k, v] of Object.entries(edits)) {
      if (!k.startsWith('csa_') && k !== 'dir_csa') newEdits[k] = v;
    }

    // 3. Seed csa_1..csa_N from the profile's CSA templates.
    const newExtraKeys: string[] = [];
    preset.csaTemplates.forEach((tplName, idx) => {
      const tpl = ROLE_TEMPLATES[tplName];
      if (!tpl) return;
      const key = `csa_${idx + 1}`;
      newExtraKeys.push(key);
      newEdits[key] = {
        display_name: tpl.display_name ?? `CSA ${idx + 1}`,
        role_type: tpl.role_type,
        domain: tpl.domain ?? '',
        lens: tpl.lens ?? '',
        system_prompt: tpl.system_prompt ?? '',
      };
    });

    // 4. Apply the Director template to dir_csa.
    const dirTpl = ROLE_TEMPLATES[preset.directorTemplate];
    if (dirTpl) {
      newEdits['dir_csa'] = {
        display_name: dirTpl.display_name ?? 'Dir CSA',
        role_type: 'director',
        domain: dirTpl.domain ?? '',
        lens: dirTpl.lens ?? '',
        system_prompt: dirTpl.system_prompt ?? '',
      };
    }

    setDeletedDefaults(defaultCsaKeys);
    setExtraKeys(newExtraKeys);
    setEdits(newEdits);
    setLoadedProfile(profileName);
  }

  function handleClearProfile() {
    if (!window.confirm('Clear loaded profile and reset to session defaults? Your model choice is preserved.')) return;
    setDeletedDefaults([]);
    setExtraKeys([]);
    setEdits({});
    setLoadedProfile(null);
  }

  function handleRemoveRole(key: string) {
    if (!config) return;
    const isDefault = !!config.defaults[key];
    if (isDefault) {
      // Track deletion of a default role
      setDeletedDefaults((prev) => [...prev, key]);
    } else {
      // Remove a user-added extra role
      setExtraKeys((prev) => prev.filter((k) => k !== key));
    }
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
      await api.agentConfig.put(sessionId, edits, deletedDefaults);
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
    ...Object.keys(defaults).filter(
      (k) => k.startsWith('csa_') && !deletedDefaults.includes(k)
    ),
    ...extraCsaKeys,
  ].sort((a, b) => a.localeCompare(b));
  const csaCount = allCsaKeys.length;
  const canRemoveCsa = csaCount > 1;

  // Resolve participant type for each key from the merged override/default.
  const participantTypeFor = (key: string): ParticipantType => {
    const merged = { ...(defaults[key] ?? {}), ...(edits[key] ?? {}) };
    const rt = merged.role_type;
    return rt === 'customer' ? 'customer' : 'csa';
  };
  const customerCount = allCsaKeys.filter((k) => participantTypeFor(k) === 'customer').length;
  const csaOnlyCount = csaCount - customerCount;

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
          {csaOnlyCount} CSA{csaOnlyCount !== 1 ? 's' : ''}
          {customerCount > 0 ? ` · ${customerCount} Customer${customerCount !== 1 ? 's' : ''}` : ''}
          {' '}+ the Director are set up and ready.
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

      <InfoBanner title="Step 3 of 6 — Configure who sits at the table" storageKey="info-setup">
        <p>Participants include <strong>Cloud Solution Architects</strong> (each with a distinct <strong>domain</strong> and <strong>analytical lens</strong>) and optional <strong>Customer personas</strong> (e.g. Executive Sponsor, Technical Lead, Security Officer) that pressure-test the design from the customer&apos;s point of view. The Director synthesizes all participants into a final recommendation.</p>
        <ul className="list-disc ml-4 mt-1 space-y-0.5">
          <li><strong>Step 1 — Model:</strong> Pick the LLM for this session. GPT-4.1 is recommended for long debates.</li>
          <li><strong>Step 2 — Participants:</strong> Add CSAs and (optionally) Customer personas. Pick a template or write your own. Up to 8 total.</li>
          <li><strong>Step 3 — Director:</strong> The director synthesizes all participant inputs. Its prompt defines how opinionated the synthesis should be.</li>
          <li>Changes here only affect this session — defaults are preserved for new sessions.</li>
        </ul>
      </InfoBanner>

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
              Next: Participants →
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Participants ────────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4">
          {/* Profile preset selector */}
          <div className="rounded-lg border border-brand-200 bg-brand-50/40 p-4 space-y-2">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <label htmlFor="profile-preset" className="block text-sm font-semibold text-brand-700">
                  Load profile preset
                </label>
                <p className="text-xs text-gray-500">
                  Apply a pre-configured participant bundle for a delivery scenario. Replaces current participant config.
                </p>
              </div>
              <select
                id="profile-preset"
                value=""
                onChange={(e) => {
                  if (e.target.value) handleApplyProfile(e.target.value);
                  e.target.value = '';
                }}
                className="border border-gray-300 rounded px-3 py-2 text-sm bg-white min-w-[280px]"
              >
                <option value="">— Select a profile —</option>
                {Object.keys(PROFILE_PRESETS).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            {loadedProfile && PROFILE_PRESETS[loadedProfile] && (
              <div className="flex items-start justify-between gap-3 pt-1 border-t border-brand-200">
                <div className="text-xs text-gray-700">
                  <span className="font-semibold text-brand-700">Loaded:</span> {loadedProfile}
                  <span className="block text-gray-500 mt-0.5">{PROFILE_PRESETS[loadedProfile].description}</span>
                </div>
                <button
                  onClick={handleClearProfile}
                  className="text-xs text-gray-500 hover:text-red-600 underline shrink-0"
                >
                  Reset
                </button>
              </div>
            )}
          </div>
          <p className="text-sm text-gray-500">
            Configure your participants — {csaOnlyCount} CSA{csaOnlyCount !== 1 ? 's' : ''}
            {customerCount > 0 ? ` · ${customerCount} Customer${customerCount !== 1 ? 's' : ''}` : ''}
            {' '}({csaCount}/8 total). CSAs bring expert perspectives; Customer personas pressure-test the design.
          </p>
          {allCsaKeys.map((key) => {
            const ptype = participantTypeFor(key);
            const num = key.replace('csa_', '');
            const label = ptype === 'customer' ? `Customer ${num}` : `CSA ${num}`;
            return (
              <MemoRoleCard
                key={key}
                roleKey={key}
                label={label}
                defaultRole={defaults[key] ?? BLANK_CSA}
                override={edits[key] ?? {}}
                participantType={ptype}
                onChange={handleChange}
                onBootstrap={handleBootstrap}
                bootstrapping={bootstrapping && bootstrapTarget === key}
                onRemove={canRemoveCsa ? () => handleRemoveRole(key) : undefined}
              />
            );
          })}
          {csaCount < 8 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                onClick={() => handleAddRole('csa')}
                className="w-full border-2 border-dashed border-brand-300 rounded-lg py-3 text-sm text-brand-600 font-medium hover:border-brand-600 hover:bg-brand-50 transition-colors"
              >
                + Add CSA role
              </button>
              <button
                onClick={() => handleAddRole('customer')}
                className="w-full border-2 border-dashed border-amber-300 rounded-lg py-3 text-sm text-amber-700 font-medium hover:border-amber-500 hover:bg-amber-50 transition-colors"
              >
                + Add Customer role
              </button>
            </div>
          )}
          <p className="text-xs text-gray-400 text-center">{csaCount}/8 participants configured</p>
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
              participantType="director"
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
            {/* Participants */}
            <div className="px-5 py-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                    Participants ({csaCount})
                  </p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {csaOnlyCount} CSA{csaOnlyCount !== 1 ? 's' : ''}
                    {customerCount > 0 ? ` · ${customerCount} Customer${customerCount !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <button onClick={() => setStep(2)} className="text-xs text-brand-600 hover:underline">
                  Edit
                </button>
              </div>
              <div className="space-y-2">
                {allCsaKeys.map((key) => {
                  const role = { ...(defaults[key] ?? BLANK_CSA), ...(edits[key] ?? {}) };
                  const ptype = participantTypeFor(key);
                  const badge = ptype === 'customer'
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-brand-100 text-brand-800';
                  return (
                    <div key={key} className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800 flex items-center gap-2">
                        <span className={`text-[9px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${badge}`}>
                          {ptype === 'customer' ? 'Cust' : 'CSA'}
                        </span>
                        {role.display_name || key}
                      </span>
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
