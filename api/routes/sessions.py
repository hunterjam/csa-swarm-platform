"""
api/routes/sessions.py

Session CRUD:
  POST   /api/sessions
  GET    /api/sessions
  GET    /api/sessions/{session_id}
  DELETE /api/sessions/{session_id}
"""
from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from api.auth import get_current_user
from api.deps import get_store
from swarm.cosmos_store import CosmosStore

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class CreateSessionRequest(BaseModel):
    title: str = "New Session"


# Allowed model deployment names
_ALLOWED_MODELS = {"gpt-4o", "gpt-4.1", "gpt-4.1-mini", "o4-mini", "gpt-5", "gpt-5.1"}


class PatchSessionRequest(BaseModel):
    model: str | None = None


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session_id = str(uuid.uuid4())
    session = await store.create_session(
        session_id=session_id,
        user_id=user["sub"],
        title=body.title,
    )
    return session


@router.get("")
async def list_sessions(
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> list[dict]:
    return await store.list_sessions(user_id=user["sub"])


@router.get("/{session_id}")
async def get_session(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_session(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> None:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await store.delete_session(session_id=session_id)


@router.patch("/{session_id}")
async def patch_session(
    session_id: str,
    body: PatchSessionRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if body.model is not None and body.model not in _ALLOWED_MODELS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown model '{body.model}'. Allowed: {sorted(_ALLOWED_MODELS)}",
        )
    return await store.update_session_model(session_id=session_id, model=body.model)
