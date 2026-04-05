"""
workflows/debate_workflow.py

Orchestrates a single debate round:
  1. PM message (pass-through — no LLM call)
  2. All CSA agents invoked in PARALLEL via asyncio.gather
  3. Dir CSA invoked SEQUENTIALLY with all CSA responses injected
  4. Results returned (and optionally streamed via an async queue)

SSE streaming design
--------------------
The `run_round_streaming` async generator yields SSE-formatted dict events:
  {"type": "csa_complete", "role": "csa_1", "display_name": "...", "text": "..."}
  {"type": "dir_chunk",    "role": "dir_csa",  "text": "<incremental text>"}
  {"type": "round_complete", "round": {<full RoundResult>}}
  {"type": "error",        "message": "..."}

The FastAPI route converts these to `data: <json>\n\n` SSE messages.
"""
from __future__ import annotations

import asyncio
from typing import Any, AsyncGenerator

from azure.identity.aio import DefaultAzureCredential

from agents.role_agents import invoke_agent, load_roles, stream_agent_response


# ── Message builders (mirrors MVP orchestrator helpers) ──────────────────

def _build_csa_user_message(
    pm_message: str,
    round_history: list[dict],
    grounding_block: str = "",
) -> str:
    parts = []
    if grounding_block:
        parts.append(
            f"=== GROUNDING CONTEXT (uploaded documents / URLs) ===\n"
            f"{grounding_block}\n"
            f"=== END GROUNDING CONTEXT ===\n"
        )
    if round_history:
        summary_lines = ["=== PRIOR DEBATE ROUNDS (summary) ==="]
        for r in round_history:
            summary_lines.append(f"\n--- Round {r['round_number']} ---")
            summary_lines.append(f"PM: {r['pm_message']}")
            for role_key, data in r.get("csa_responses", {}).items():
                name = data.get("display_name", role_key)
                summary_lines.append(f"{name}: {data.get('text', '')[:600]}…")
            if r.get("dir_response"):
                summary_lines.append(
                    f"Dir CSA: {r['dir_response'].get('text', '')[:600]}…"
                )
        summary_lines.append("=== END PRIOR ROUNDS ===\n")
        parts.append("\n".join(summary_lines))
    parts.append(f"PM: {pm_message}")
    return "\n".join(parts)


def _build_dir_user_message(
    pm_message: str,
    csa_responses: dict[str, dict],
    round_history: list[dict],
) -> str:
    parts = []
    if round_history:
        summary_lines = ["=== PRIOR DEBATE ROUNDS (summary) ==="]
        for r in round_history:
            summary_lines.append(f"\n--- Round {r['round_number']} ---")
            summary_lines.append(f"PM: {r['pm_message']}")
            if r.get("dir_response"):
                summary_lines.append(
                    f"Dir CSA direction: {r['dir_response'].get('text', '')[:400]}…"
                )
        summary_lines.append("=== END PRIOR ROUNDS ===\n")
        parts.append("\n".join(summary_lines))

    parts.append(f"PM message this round: {pm_message}\n")
    parts.append("=== CSA RESPONSES THIS ROUND ===")
    for role_key, data in csa_responses.items():
        name = data.get("display_name", role_key)
        parts.append(f"\n{name}:\n{data.get('text', '')}")
    parts.append("\n=== END CSA RESPONSES ===")
    parts.append(
        "\nAs Director CSA, synthesize the above CSA inputs. "
        "Follow your system prompt output format exactly."
    )
    return "\n".join(parts)


# ── Core streaming orchestration ─────────────────────────────────────────

async def run_round_streaming(
    pm_message: str,
    round_history: list[dict],
    grounding_block: str = "",
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Async generator that yields SSE event dicts for a single debate round.
    Designed to be consumed by the FastAPI SSE endpoint.
    """
    roles = load_roles()
    csa_keys = sorted(k for k in roles if k.startswith("csa_"))
    dir_key = "dir_csa"

    credential = DefaultAzureCredential()

    # ── Phase 1: run all CSAs in parallel ───────────────────────────────
    csa_user_msg = _build_csa_user_message(pm_message, round_history, grounding_block)

    async def _run_csa(key: str) -> tuple[str, dict]:
        role = roles[key]
        text = await invoke_agent(key, role, csa_user_msg, credential)
        return key, {
            "display_name": role.get("display_name", key),
            "domain": role.get("domain", ""),
            "lens": role.get("lens", ""),
            "text": text,
        }

    # Gather results, yield each as it would complete
    # asyncio.gather runs in parallel; we yield results as the list completes
    try:
        csa_results = await asyncio.gather(*[_run_csa(k) for k in csa_keys])
    except Exception as exc:
        yield {"type": "error", "message": str(exc)}
        return

    csa_responses: dict[str, dict] = {}
    for role_key, data in csa_results:
        csa_responses[role_key] = data
        yield {"type": "csa_complete", "role": role_key, **data}

    # ── Phase 2: stream Dir CSA response ────────────────────────────────
    dir_role = roles.get(dir_key)
    if not dir_role:
        yield {"type": "error", "message": "dir_csa role not found in roles.yaml"}
        return

    dir_user_msg = _build_dir_user_message(pm_message, csa_responses, round_history)
    dir_chunks: list[str] = []

    try:
        async for chunk_text in stream_agent_response(dir_key, dir_role, dir_user_msg, credential):
            dir_chunks.append(chunk_text)
            yield {"type": "dir_chunk", "role": dir_key, "text": chunk_text}
    except Exception as exc:
        yield {"type": "error", "message": f"Dir CSA error: {exc}"}
        return

    dir_full_text = "".join(dir_chunks)

    # ── Phase 3: emit complete round object ──────────────────────────────
    round_number = (len(round_history) + 1) if round_history else 1
    yield {
        "type": "round_complete",
        "round": {
            "round_number": round_number,
            "pm_message": pm_message,
            "csa_responses": csa_responses,
            "dir_response": {
                "display_name": dir_role.get("display_name", dir_key),
                "text": dir_full_text,
            },
        },
    }

    await credential.close()
