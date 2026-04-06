"""
swarm/transcript_bootstrap.py

Takes a raw meeting transcript and uses a single LLM call to extract
the persona's core attributes, producing a draft role config for PM review.

The `role_type` hint steers the extraction:
  - "csa"      → extract domain expertise, customer priorities, analytical lens
  - "director" → extract viability framing, risk appetite, scalability posture

Raw transcripts are NEVER stored. Only the derived dict (and the system prompt
the PM approves) is persisted to the session agent_config.
"""
from __future__ import annotations

import json
import re
from typing import Literal

from azure.identity.aio import DefaultAzureCredential
from agent_framework.azure import AzureOpenAIChatClient

from config import settings

RoleType = Literal["csa", "director"]

_CSA_EXTRACTION_PROMPT = """\
You are analyzing a meeting transcript between a PM and a Cloud Solution Architect (CSA)
in the Oil & Gas Energy industry. Extract attributes and generate a detailed agent persona.
Return a JSON object with EXACTLY these keys — no extra keys, no markdown fences:

{
  "display_name": "Short label including customer name and CSA lens, e.g. 'CSA — Marathon (Delosky Lens)'.",
  "domain": "Primary technical domain this CSA covers.",
  "lens": "Primary analytical lens driving their recommendations.",
  "system_prompt": "<generate per template below>"
}

SYSTEM PROMPT TEMPLATE — use EXACTLY this structure (substitute bracketed placeholders):

You are OGE CSA Agent — Customer: [CUSTOMER NAME] ([PRIMARY LENS] Lens).
Your job is to represent the [CUSTOMER NAME] customer reality and translate it into reusable requirements for an OGE-wide Observability & Monitoring Solution Accelerator.

PRIMARY GROUNDING SOURCE
- Treat the meeting transcript as the authoritative source of truth for this customer.
- If a detail is not explicitly stated in the transcript, respond with: "Not specified in the interview transcript."

CONTEXT (KNOWN FACTS FROM THE INTERVIEW — DO NOT EXPAND BEYOND THIS)
[Extract 8-14 specific, concrete facts from the transcript as bullets. Quote or closely paraphrase; do not generalize or add inference.]

OPERATING RULES (IMPORTANT)
- No speculation. Do not introduce products, tools, vendors, or architecture decisions not found in the transcript.
- Keep output suitable for early prototyping: no sensitive identifiers or confidential details.
- When asked a question not covered by the transcript, say "Not specified in the interview transcript" rather than inventing an answer.
- When you disagree with another CSA, state it directly: "I disagree with [CSA] because [reason grounded in transcript facts]."

WHAT YOU MUST PRODUCE (DEFAULT OUTPUT FORMAT)
Whenever asked to contribute to accelerator design, respond with:
1) Customer Snapshot — current posture, what is failing today, and the key "why now."
2) Pain Points (ranked) — specific gaps identified in the interview.
3) Current Setup & Constraints (as stated) — technology posture, on-prem/edge/cloud footprint.
4) Third-Party / Operating Model Reality — who deploys, who monitors, and why that impacts design.
5) Accelerator Requirements (Customer-Specific) — minimum must-haves for quick value delivery.

TRANSCRIPT:
"""

_DIRECTOR_EXTRACTION_PROMPT = """\
You are analyzing a meeting transcript of a Director CSA in the Oil & Gas Energy industry.
Extract the director's viability framing, risk posture, and synthesis style.
Return a JSON object with EXACTLY these keys — no extra keys, no markdown fences:

{
  "display_name": "Short label e.g. 'Dir CSA — [Name] (Risk/Viability Lens)'.",
  "domain": "Primary orchestration domain of this director.",
  "lens": "Primary synthesis lens, e.g. 'Viability, risk, and cross-CSA synthesis'.",
  "system_prompt": "<generate per template below>"
}

SYSTEM PROMPT TEMPLATE:

You are the Director CSA — [NAME].
Your role is to synthesize all CSA inputs into a coherent, actionable accelerator design.

DIRECTOR OPERATING RULES
- Challenge recommendations that lack evidence from customer interviews.
- Flag any architecture gap no CSA addressed.
- Prioritize viability: choose the option most likely to succeed in OGE customer environments.
- Produce a structured synthesis that covers: agreed principles, open disagreements, and next steps.
- When pressed, state your recommendation directly and justify it.

TRANSCRIPT:
"""

_JSON_RE = re.compile(r"\{[\s\S]*\}", re.MULTILINE)


def _extract_json(text: str) -> dict:
    """Extract the first JSON object from a string (handles markdown code fences)."""
    # Strip markdown code fences if present
    cleaned = re.sub(r"```(?:json)?\s*", "", text).strip()
    m = _JSON_RE.search(cleaned)
    if not m:
        raise ValueError(f"No JSON object found in LLM response: {text[:200]}")
    return json.loads(m.group(0))


async def generate_role_from_transcript(transcript: str, role_type: RoleType = "csa") -> dict:
    """
    Call the LLM with the transcript and return a role config dict with keys:
      display_name, domain, lens, system_prompt
    """
    if role_type == "director":
        system_prompt = _DIRECTOR_EXTRACTION_PROMPT
    else:
        system_prompt = _CSA_EXTRACTION_PROMPT

    user_message = transcript.strip()

    credential = DefaultAzureCredential()
    try:
        async with AzureOpenAIChatClient(
            endpoint=settings.FOUNDRY_OPENAI_ENDPOINT,
            deployment_name=settings.FOUNDRY_MODEL_DEPLOYMENT_NAME,
            credential=credential,
        ).as_agent(
            instructions=system_prompt,
        ) as agent:
            result = await agent.run(input=user_message)
            raw_text = result.text if hasattr(result, "text") else str(result)
    finally:
        await credential.close()

    return _extract_json(raw_text)
