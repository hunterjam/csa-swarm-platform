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
from typing import TYPE_CHECKING, Any, AsyncGenerator

from azure.identity.aio import DefaultAzureCredential

from agents.role_agents import load_roles, stream_agent_response

if TYPE_CHECKING:
    from swarm.cosmos_store import CosmosStore


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
    parts.append("\nAs Director CSA, please synthesize the above CSA inputs.")
    return "\n".join(parts)


# ── Core streaming orchestration ─────────────────────────────────────────

async def run_round_streaming(
    session_id: str,
    pm_message: str,
    store: "CosmosStore",
    agent_config: dict | None = None,
    model_name: str | None = None,
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Async generator that yields SSE event dicts for a single debate round.
    Loads round history and grounding block from Cosmos automatically.
    Optionally uses session-scoped agent_config to override default roles.
    Designed to be consumed by the FastAPI SSE endpoint.
    """
    # Load prior rounds + grounding from Cosmos
    round_history = await store.get_rounds(session_id=session_id)
    grounding_block = await store.get_grounding_block(session_id=session_id)

    # Merge session-level role overrides on top of defaults
    default_roles = load_roles()
    if agent_config:
        roles = {}
        for key, default in default_roles.items():
            override = agent_config.get(key, {})
            roles[key] = {**default, **override} if override else default
        # Include extra csa_* keys from agent_config not in defaults (user-added roles)
        for key, val in agent_config.items():
            if key.startswith("csa_") and key not in default_roles and isinstance(val, dict):
                roles[key] = val
    else:
        roles = default_roles
    csa_keys = sorted(k for k in roles if k.startswith("csa_"))
    dir_key = "dir_csa"

    credential = DefaultAzureCredential()

    # ── Phase 1: stream all CSAs in parallel via a shared queue ───────────
    csa_user_msg = _build_csa_user_message(pm_message, round_history, grounding_block)
    queue: asyncio.Queue[dict] = asyncio.Queue()

    async def _stream_csa_to_queue(key: str) -> None:
        role = roles[key]
        display_name = role.get("display_name", key)
        chunks: list[str] = []
        try:
            async for chunk_text in stream_agent_response(
                key, role, csa_user_msg, credential, model_name=model_name
            ):
                chunks.append(chunk_text)
                await queue.put({
                    "type": "csa_chunk",
                    "role": key,
                    "display_name": display_name,
                    "text": chunk_text,
                })
        except Exception as exc:
            await queue.put({"type": "error", "message": f"{key}: {exc}"})
        # Always signal completion so the consumer can count all CSAs done
        await queue.put({
            "type": "csa_done",
            "role": key,
            "display_name": display_name,
            "text": "".join(chunks),
        })

    tasks = [asyncio.create_task(_stream_csa_to_queue(k)) for k in csa_keys]

    csa_responses: dict[str, dict] = {}
    done_count = 0
    while done_count < len(csa_keys):
        event = await queue.get()
        yield event
        if event["type"] == "csa_done":
            done_count += 1
            key = event["role"]
            csa_responses[key] = {
                "display_name": event["display_name"],
                "domain": roles[key].get("domain", ""),
                "lens": roles[key].get("lens", ""),
                "text": event["text"],
            }

    await asyncio.gather(*tasks, return_exceptions=True)

    # ── Phase 2: stream Dir CSA response ────────────────────────────────
    dir_role = roles.get(dir_key)
    if not dir_role:
        yield {"type": "error", "message": "dir_csa role not found in roles.yaml"}
        return

    dir_user_msg = _build_dir_user_message(pm_message, csa_responses, round_history)
    dir_chunks: list[str] = []

    try:
        async for chunk_text in stream_agent_response(dir_key, dir_role, dir_user_msg, credential, model_name=model_name):
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
