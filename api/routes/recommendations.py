"""
api/routes/recommendations.py

POST /api/sessions/{session_id}/recommendations        generate (SSE stream)
GET  /api/sessions/{session_id}/recommendations        list persisted deliverables
GET  /api/sessions/{session_id}/recommendations/{key}  fetch one deliverable

SSE events:
  {"type":"chunk",  "text":"..."}
  {"type":"done",   "rec":{...persisted recommendation...}}
  {"type":"error",  "message":"..."}

Also exposes GET /api/doc-types for the frontend selector.
"""
from __future__ import annotations

import json
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from api.auth import get_current_user
from api.deps import get_store
from swarm.cosmos_store import CosmosStore
from swarm.orchestrator import DOC_TYPES, generate_recommendation_streaming

router = APIRouter(tags=["recommendations"])

_DOC_TYPE_KEYS = {d["key"] for d in DOC_TYPES}


class GenerateRequest(BaseModel):
    doc_type: str = "architecture"


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


async def _gen_stream(
    session_id: str,
    doc_type: str,
    store: CosmosStore,
) -> AsyncGenerator[str, None]:
    full_text: list[str] = []
    try:
        async for chunk in generate_recommendation_streaming(
            round_history=await store.get_rounds(session_id=session_id),
            doc_type=doc_type,
        ):
            full_text.append(chunk)
            yield _sse({"type": "chunk", "text": chunk})

        text = "".join(full_text)
        rec = await store.save_recommendation(
            session_id=session_id,
            doc_type=doc_type,
            content=text,
        )
        yield _sse({"type": "done", "rec": rec})

    except Exception as exc:  # noqa: BLE001
        yield _sse({"type": "error", "message": str(exc)})
    finally:
        yield "data: [DONE]\n\n"


@router.get("/api/doc-types")
async def get_doc_types() -> list[dict]:
    return DOC_TYPES


@router.post("/api/sessions/{session_id}/recommendations")
async def generate(
    session_id: str,
    body: GenerateRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> StreamingResponse:
    if body.doc_type not in _DOC_TYPE_KEYS:
        raise HTTPException(status_code=422, detail=f"Unknown doc_type: {body.doc_type}")
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    return StreamingResponse(
        _gen_stream(
            session_id=session_id,
            doc_type=body.doc_type,
            store=store,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/api/sessions/{session_id}/recommendations")
async def list_recommendations(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> list[dict]:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await store.get_recommendations(session_id=session_id)


@router.get("/api/sessions/{session_id}/recommendations/{doc_type}")
async def get_recommendation(
    session_id: str,
    doc_type: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    recs = await store.get_recommendations(session_id=session_id)
    match = next((r for r in recs if r.get("doc_type") == doc_type), None)
    if not match:
        raise HTTPException(status_code=404, detail="Recommendation not found")
    return match
