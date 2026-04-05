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
