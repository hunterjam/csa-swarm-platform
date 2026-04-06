"""
api/routes/context.py

Grounding / context management:
  POST   /api/sessions/{session_id}/context        upload file
  POST   /api/sessions/{session_id}/context/url    fetch URL
  POST   /api/sessions/{session_id}/context/text   add pasted text
  GET    /api/sessions/{session_id}/context        list sources
  DELETE /api/sessions/{session_id}/context/{pos}  remove source
  PATCH  /api/sessions/{session_id}/context/{pos}/pin  toggle pin
"""
from __future__ import annotations

import re
from typing import Any

import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from api.auth import get_current_user
from api.deps import get_store
from swarm.context_loader import load_uploaded_file
from swarm.cosmos_store import CosmosStore

router = APIRouter(prefix="/api/sessions/{session_id}/context", tags=["context"])


class UrlRequest(BaseModel):
    url: str
    label: str = ""


class TextRequest(BaseModel):
    text: str
    label: str = "Pasted text"


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


@router.post("/url", status_code=status.HTTP_201_CREATED)
async def add_url_context(
    session_id: str,
    body: UrlRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    url = body.url.strip()
    if not re.match(r"^https?://", url):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=15) as client:
            resp = await client.get(url, headers={"User-Agent": "CSA-Swarm-Platform/1.0"})
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            # Accept only text-like responses
            if not any(t in content_type for t in ("text", "json", "xml", "markdown")):
                raise HTTPException(
                    status_code=422,
                    detail=f"URL returned non-text content-type: {content_type}",
                )
            text = resp.text
    except httpx.HTTPStatusError as exc:
        raise HTTPException(status_code=502, detail=f"URL fetch failed: {exc.response.status_code}") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"URL fetch error: {exc}") from exc

    source = await store.save_grounding_source(
        session_id=session_id,
        filename=url,
        label=body.label or url,
        content=text,
    )
    return source


@router.post("/text", status_code=status.HTTP_201_CREATED)
async def add_text_context(
    session_id: str,
    body: TextRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if not body.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty")

    source = await store.save_grounding_source(
        session_id=session_id,
        filename="pasted_text.txt",
        label=body.label or "Pasted text",
        content=body.text.strip(),
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
    pos: str,
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
    pos: str,
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
