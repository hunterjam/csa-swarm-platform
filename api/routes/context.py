"""
api/routes/context.py

Grounding / context management:
  POST   /api/sessions/{session_id}/context        upload file
  GET    /api/sessions/{session_id}/context        list sources
  DELETE /api/sessions/{session_id}/context/{pos}  remove source
  PATCH  /api/sessions/{session_id}/context/{pos}/pin  toggle pin
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from api.auth import get_current_user
from api.deps import get_store
from swarm.context_loader import load_uploaded_file
from swarm.cosmos_store import CosmosStore

router = APIRouter(prefix="/api/sessions/{session_id}/context", tags=["context"])


@router.post("", status_code=status.HTTP_201_CREATED)
async def upload_context(
    session_id: str,
    file: UploadFile = File(...),
    label: str = Form(""),
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    raw = await file.read()
    text = load_uploaded_file(raw, filename=file.filename or "upload")

    source = await store.save_grounding_source(
        session_id=session_id,
        filename=file.filename or "upload",
        label=label or file.filename or "upload",
        content=text,
    )
    return source


@router.get("")
async def list_context(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> list[dict]:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return await store.get_grounding_sources(session_id=session_id)


@router.delete("/{pos}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_context(
    session_id: str,
    pos: int,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> None:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    await store.delete_grounding_source(session_id=session_id, position=pos)


@router.patch("/{pos}/pin")
async def toggle_pin(
    session_id: str,
    pos: int,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    updated = await store.toggle_grounding_pin(session_id=session_id, position=pos)
    if not updated:
        raise HTTPException(status_code=404, detail="Grounding source not found")
    return updated
