"""
api/routes/debate.py

POST /api/sessions/{session_id}/rounds  →  SSE stream (text/event-stream)
GET  /api/sessions/{session_id}/rounds  →  list of persisted rounds

SSE event types:
  {"type":"csa_done",       "role":"csa_1","display_name":"...", "text":"..."}
  {"type":"dir_chunk",      "text":"..."}
  {"type":"round_complete", "round":{...}}
  {"type":"error",          "message":"..."}
"""
from __future__ import annotations

import json
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.auth import get_current_user
from api.deps import get_store
from swarm.cosmos_store import CosmosStore
from workflows.debate_workflow import run_round_streaming

router = APIRouter(prefix="/api/sessions/{session_id}", tags=["debate"])


class RunRoundRequest(BaseModel):
    pm_message: str


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _debate_stream(
    session_id: str,
    pm_message: str,
    store: CosmosStore,
    user_id: str,
    agent_config: dict | None = None,
    model_name: str | None = None,
    deleted_roles: list[str] | None = None,
) -> AsyncGenerator[str, None]:
    try:
        round_result: dict | None = None
        async for event in run_round_streaming(
            session_id=session_id,
            pm_message=pm_message,
            store=store,
            agent_config=agent_config,
            model_name=model_name,
            deleted_roles=deleted_roles,
        ):
            if event["type"] == "round_complete":
                round_result = event["round"]
            yield _sse(event)

        if round_result:
            await store.save_round(session_id=session_id, round_data=round_result)

    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": str(exc)})
    finally:
        yield "data: [DONE]\n\n"


@router.post("/rounds")
async def run_round(
    session_id: str,
    body: RunRoundRequest,
    request: Request,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> StreamingResponse:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        _debate_stream(
            session_id=session_id,
            pm_message=body.pm_message,
            store=store,
            user_id=user["sub"],
            agent_config=session.get("agent_config") or None,
            model_name=session.get("model") or None,
            deleted_roles=session.get("deleted_roles") or None,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # nginx: disable proxy buffering
        },
    )


@router.get("/rounds")
async def list_rounds(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> list[dict]:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await store.get_rounds(session_id=session_id)
