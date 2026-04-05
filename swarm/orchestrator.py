"""
swarm/orchestrator.py

System prompts, document type registry, and recommendation generation
for csa-swarm-platform.

generate_recommendation() uses Agent Framework AzureAIClient (not raw AzureOpenAI)
to stay consistent with the rest of the platform and benefit from Foundry tracing.
"""
from __future__ import annotations

import asyncio
import re

from azure.identity.aio import DefaultAzureCredential
from agent_framework.azure import AzureAIClient

from config import settings

# ---------------------------------------------------------------------------
# System prompts (verbatim from csa-agentic-swarm MVP)
# ---------------------------------------------------------------------------

_SYNTHESIS_SYSTEM_PROMPT = """\
You are a technical architect synthesizing a multi-stakeholder design session.
Based on the debate history provided, produce a structured Observability Architecture
Recommendation document for an Oil & Gas Energy end-to-end observability MVP.

Use the following document structure:

# OGE End-to-End Observability — Architecture Recommendation

## Executive Summary
(2-3 sentences)

## Agreed Principles
(Bullet list of points all CSAs and the Director converged on)

## Recommended Architecture
### Data Collection Layer
### Transport & Ingestion Layer
### Storage & Indexing Layer
### Visualization & Alerting Layer
### Governance & Security

## Open Questions / Risks
(Items flagged by the Dir CSA or unresolved CSA disagreements)

## Next Steps (MVP Scope)
(Concrete, actionable items for the PM to prioritize)

Be specific. Reference the CSA domains and lenses by name where relevant.
Do not add generic filler. This document will be used as a real MVP design artifact.
"""

_PROJECT_PLAN_SYSTEM_PROMPT = """\
You are a technical program manager synthesizing a multi-stakeholder design session.
Based on the debate history provided, produce a detailed Project Plan for implementing
the OGE End-to-End Observability solution agreed upon in the debate.

CRITICAL INSTRUCTION — TIMELINE:
Read the debate carefully. If the PM or any participant stated a specific project
duration or deadline (e.g. "6-week plan", "Q3 deadline", "8 weeks"), you MUST
honour that constraint exactly. Do NOT default to arbitrary phase durations —
derive all week ranges from the stated timeline. If no duration is mentioned,
use a reasonable estimate based on architecture complexity and state your assumption.

Use the following document structure:

# OGE End-to-End Observability — Project Plan

## Project Overview
(Scope, objectives, definition of done, and total duration in 3–5 sentences.
State the timeline explicitly: "This plan delivers the MVP in X weeks.")

## Timeline Assumptions
(List any timeline constraints stated in the debate, or state "No explicit timeline
was given; estimated X weeks based on [rationale].")

## Project Phases
(Divide the agreed total duration into logical phases. Each phase heading must show
the actual week numbers derived from the stated or estimated timeline.)

For each phase:
### Phase N: [Name] (Weeks X–Y)
| Work Item | Owner | Acceptance Criteria | Dependencies |
|-----------|-------|---------------------|--------------|

## Resource Requirements
| Role | Allocation | Phase(s) |
|------|------------|---------|

## Milestones & Decision Gates
| Milestone | Description | Target Week | Go/No-Go Criteria |
|-----------|-------------|-------------|-------------------|

## Assumptions & Constraints
(Bullet list — include the timeline constraint here if stated)

## Out of Scope
(Explicitly excluded items — bullet list)

Be specific. Never use week ranges from a template — always derive them from the
total project duration discussed.
"""

_TECHNICAL_SPECS_SYSTEM_PROMPT = """\
You are a solution architect synthesizing a multi-stakeholder design session.
Based on the debate history provided, produce Technical Specifications for the
OGE End-to-End Observability solution.

Use the following document structure:

# OGE End-to-End Observability — Technical Specifications

## 1. System Overview
(Purpose, scope, and high-level component list in 3–5 sentences)

## 2. Component Specifications
For each major component agreed upon in the debate:

### [Component Name]
- **Purpose**: what it does in this solution
- **Technology**: specific tool/service selected (with version where relevant)
- **Interfaces**: inputs received, outputs emitted, protocols used
- **Configuration**: key configuration parameters and decisions
- **Scalability**: expected data volumes, scaling approach
- **Responsible team**: who owns this component

## 3. Data Flow Specifications
(Describe each major data flow: source → sink, data format, protocol, latency SLA)

## 4. Integration Points
| System | Direction | Protocol | Auth Method |
|--------|-----------|----------|-------------|

## 5. Non-Functional Requirements
| Requirement | Target | Notes |
|-------------|--------|-------|
| Availability | ≥ 99.9% | |
| Data retention (hot) | | |
| Data retention (archive) | | |
| Ingestion latency | | |

## 6. Technical Decisions Log
| Decision | Options Considered | Choice Made | Rationale |
|----------|-------------------|-------------|----------|

Be specific. Reference exact technology names, versions, and configuration choices
from the debate. Every component should map to something discussed by the CSAs.
"""

_ROADMAP_SYSTEM_PROMPT = """\
You are a technical strategist synthesizing a multi-stakeholder design session.
Based on the debate history, produce a Detailed Implementation Roadmap for the
OGE End-to-End Observability solution.

Use the following document structure:

# OGE End-to-End Observability — Implementation Roadmap

## Executive Overview
(2–3 sentences summarising the roadmap strategy and guiding principles)

## Roadmap Lanes
(List the parallel workstreams, e.g. Infrastructure, Data Pipeline, Visualization,
Governance & Security, Organisational Enablement)

CRITICAL INSTRUCTION — TIMELINE:
Before writing any phase headers, read the debate transcript for any stated project
duration or deadline. All short-/mid-/long-term phase boundaries MUST be derived
from that stated duration. If no duration is mentioned, estimate based on complexity
and state your assumption.

## Short-Term ([derive dates from debate]): Foundation & MVP
| Workstream | Deliverable | Why Now | Expected Outcome |
|------------|-------------|---------|------------------|

## Mid-Term ([derive dates from debate]): Expansion & Hardening
| Workstream | Deliverable | Key Dependencies | Expected Outcome |
|------------|-------------|------------------|------------------|

## Long-Term ([derive dates from debate]): Scale & Optimise
| Workstream | Deliverable | Key Dependencies | Expected Outcome |
|------------|-------------|------------------|------------------|

## Critical Path & Dependencies
(List the 5–10 most critical dependencies between deliverables)

## Key Decision Points
| Decision | Must Be Made By | Impact of Delay |
|----------|-----------------|-----------------|

## Success Metrics by Phase
| Phase | Metric | Target |
|-------|--------|--------|

Be specific. Do not include generic filler — every row should reference something
discussed by the agents.
"""

_RISK_REGISTER_SYSTEM_PROMPT = """\
You are a technical risk manager synthesizing a multi-stakeholder design session.
Based on the debate history, produce a Risk Register for the OGE End-to-End
Observability project.

Use the following document structure:

# OGE End-to-End Observability — Risk Register

## Risk Summary
(2–3 sentences describing the overall risk profile and top concerns)

## Risk Register
| ID | Risk | Category | Probability | Impact | Score | Mitigation Strategy | Owner |
|----|------|----------|-------------|--------|-------|---------------------|-------|

Categories: Technical | Organisational | Vendor/Cloud | Security | Compliance | Schedule
Probability: High / Medium / Low
Impact: High / Medium / Low
Score: H+H=Critical • H+M or M+H=High • M+M=Medium • L+any=Low

Aim for 10–15 risks covering:
- Technical risks (integration complexity, data quality, performance at OT/IT boundary)
- Organisational risks (skills gaps, change management, OT network access)
- Vendor/cloud risks (service limits, pricing model changes, lock-in)
- Security/compliance risks specific to Oil & Gas OT environments

## Critical Risks — Detailed Mitigation Plans
For each risk scored Critical, provide a 4–6 sentence mitigation plan with specific
actions, owners, and timeline.

## Assumptions Underpinning This Assessment
(Bullet list)

Be specific. Derive all risks from the debate — note where CSAs or the Director raised
concerns, gaps, or unresolved questions.
"""

_GSA_ASSESSMENT_SYSTEM_PROMPT = """\
You are a Microsoft Gold Standard Solution Accelerator (GSA) governance and review agent.

Your primary responsibility is to evaluate the solution design described in the debate
transcript below against Microsoft's Gold Standard Solution Accelerator requirements
("The Gold Standard Recipe").

CORE GOLD STANDARD REQUIREMENTS (MANDATORY — evaluate ALL seven)

1. Responsible AI & Legal Compliance
2. Secure Future Initiative (SFI) Compliance
3. Proven & Trusted Technical Patterns
4. Production-Ready, Deployable Code
5. Complete Supporting Documentation
6. Active Maintenance & Lifecycle Ownership
7. Strategic Alignment & Accountability

OUTPUT FORMAT (use this structure exactly):

# OGE End-to-End Observability — GSA Compliance Assessment

## Executive Summary
**Overall Status:** COMPLIANT / PARTIALLY COMPLIANT / NON-COMPLIANT

## Compliance Matrix
| # | Requirement | Status | Evidence from Debate | Gap / Action Required |
|---|-------------|--------|----------------------|----------------------|

Status key: ✅ Met  ⚠️ Partially met  ❌ Not addressed

## Detailed Findings
For each requirement: Status, Evidence, Gaps, Required Actions.

## Critical Gaps Summary
## Recommended Next Steps
## Gold Standard Readiness Verdict

Do NOT assume compliance — require explicit evidence from the debate.
Where a requirement was not discussed, mark it ❌ and note it as unaddressed.
"""

# ---------------------------------------------------------------------------
# Document type registry (exported for API and frontend)
# ---------------------------------------------------------------------------

DOC_TYPES: list[dict] = [
    {"key": "architecture",    "label": "Architecture Recommendation",  "icon": "🏗️", "filename": "oge_architecture_recommendation.md"},
    {"key": "project_plan",    "label": "Project Plan",                 "icon": "📋", "filename": "oge_project_plan.md"},
    {"key": "technical_specs", "label": "Technical Specifications",     "icon": "⚙️", "filename": "oge_technical_specs.md"},
    {"key": "roadmap",         "label": "Detailed Roadmap",             "icon": "🗺️", "filename": "oge_roadmap.md"},
    {"key": "risk_register",   "label": "Risk Register",                "icon": "⚠️", "filename": "oge_risk_register.md"},
    {"key": "gsa_assessment",  "label": "GSA Compliance Assessment",    "icon": "🏅", "filename": "oge_gsa_assessment.md"},
]

_DOC_TYPE_PROMPTS: dict[str, str] = {
    "architecture":    _SYNTHESIS_SYSTEM_PROMPT,
    "project_plan":    _PROJECT_PLAN_SYSTEM_PROMPT,
    "technical_specs": _TECHNICAL_SPECS_SYSTEM_PROMPT,
    "roadmap":         _ROADMAP_SYSTEM_PROMPT,
    "risk_register":   _RISK_REGISTER_SYSTEM_PROMPT,
    "gsa_assessment":  _GSA_ASSESSMENT_SYSTEM_PROMPT,
}

_TIMELINE_RE = re.compile(
    r'\b(\d+)[\s\-]?(?:week|wk|month|sprint|day)s?\b'
    r'|\bQ[1-4](?:\s+\d{4})?\b'
    r'|\bend[\s\-]of[\s\-](?:Q[1-4]|\w+)\b',
    re.IGNORECASE,
)

_TIMELINE_SENSITIVE_DOCS = {"project_plan", "roadmap"}


def _extract_timeline_hint(round_history: list[dict]) -> str:
    found: list[str] = []
    for r in round_history:
        pm = r.get("pm_message", "")
        for m in _TIMELINE_RE.finditer(pm):
            start = max(0, m.start() - 60)
            end = min(len(pm), m.end() + 60)
            snippet = pm[start:end].strip().replace("\n", " ")
            found.append(f"  • Round {r.get('round_number', '?')} PM: \"...{snippet}...\"")
    if not found:
        return ""
    return (
        "=== STATED TIMELINE CONSTRAINTS (MUST BE HONOURED) ===\n"
        + "\n".join(found)
        + "\n\nDerive ALL phase date ranges from the above constraints.\n"
        + "=" * 55 + "\n\n"
    )


async def generate_recommendation(
    round_history: list[dict],
    doc_type: str = "architecture",
) -> str:
    """
    Synthesize all debate rounds into a deliverable using Agent Framework.
    Uses AzureAIClient (Foundry) — consistent with debate agents.
    """
    if not round_history:
        return "No debate rounds found. Complete at least one round before generating."

    system_prompt = _DOC_TYPE_PROMPTS.get(doc_type, _SYNTHESIS_SYSTEM_PROMPT)

    # Build transcript
    transcript_parts = ["=== Debate Transcript ===\n"]
    for r in round_history:
        transcript_parts.append(f"--- Round {r['round_number']} ---")
        transcript_parts.append(f"PM: {r['pm_message']}\n")
        for resp in r.get("csa_responses", {}).values():
            transcript_parts.append(f"{resp['display_name']}:\n{resp['text']}\n")
        dir_resp = r.get("dir_response", {})
        if dir_resp:
            transcript_parts.append(
                f"{dir_resp.get('display_name', 'Dir CSA')} (Director Review):\n{dir_resp['text']}\n"
            )

    debate_transcript = "\n".join(transcript_parts)

    if doc_type in _TIMELINE_SENSITIVE_DOCS:
        hint = _extract_timeline_hint(round_history)
        if hint:
            debate_transcript = hint + debate_transcript

    credential = DefaultAzureCredential()
    async with AzureAIClient(
        project_endpoint=settings.FOUNDRY_PROJECT_ENDPOINT,
        model_deployment_name=settings.FOUNDRY_MODEL_DEPLOYMENT_NAME,
        credential=credential,
    ).as_agent(
        name=f"Synthesizer-{doc_type}",
        instructions=system_prompt,
    ) as agent:
        stream = agent.run(debate_transcript, stream=True)
        chunks: list[str] = []
        async for chunk in stream:
            if chunk.text:
                chunks.append(chunk.text)
        await stream.get_final_response()

    await credential.close()
    return "".join(chunks)


async def generate_recommendation_streaming(
    round_history: list[dict],
    doc_type: str = "architecture",
):
    """Async generator that streams recommendation text chunks."""
    if not round_history:
        yield "No debate rounds found."
        return

    system_prompt = _DOC_TYPE_PROMPTS.get(doc_type, _SYNTHESIS_SYSTEM_PROMPT)

    transcript_parts = ["=== Debate Transcript ===\n"]
    for r in round_history:
        transcript_parts.append(f"--- Round {r['round_number']} ---")
        transcript_parts.append(f"PM: {r['pm_message']}\n")
        for resp in r.get("csa_responses", {}).values():
            transcript_parts.append(f"{resp['display_name']}:\n{resp['text']}\n")
        dir_resp = r.get("dir_response", {})
        if dir_resp:
            transcript_parts.append(
                f"{dir_resp.get('display_name', 'Dir CSA')} (Director Review):\n{dir_resp['text']}\n"
            )

    debate_transcript = "\n".join(transcript_parts)
    if doc_type in _TIMELINE_SENSITIVE_DOCS:
        hint = _extract_timeline_hint(round_history)
        if hint:
            debate_transcript = hint + debate_transcript

    credential = DefaultAzureCredential()
    async with AzureAIClient(
        project_endpoint=settings.FOUNDRY_PROJECT_ENDPOINT,
        model_deployment_name=settings.FOUNDRY_MODEL_DEPLOYMENT_NAME,
        credential=credential,
    ).as_agent(
        name=f"Synthesizer-{doc_type}",
        instructions=system_prompt,
    ) as agent:
        stream = agent.run(debate_transcript, stream=True)
        async for chunk in stream:
            if chunk.text:
                yield chunk.text
        await stream.get_final_response()

    await credential.close()
