"""
api/routes/context.py

Grounding / context management:
  POST   /api/sessions/{session_id}/context        upload file
  POST   /api/sessions/{session_id}/context/url    fetch URL
  POST   /api/sessions/{session_id}/context/text   add pasted text
  POST   /api/sessions/{session_id}/context/github fetch GitHub repo (PAT auth)
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


class GitHubRequest(BaseModel):
    repo: str       # e.g. "owner/repo"
    pat: str        # GitHub Personal Access Token
    path: str = ""  # optional subdirectory or file path within the repo
    label: str = ""


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


@router.post("/github", status_code=status.HTTP_201_CREATED)
async def add_github_context(
    session_id: str,
    body: GitHubRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    repo = body.repo.strip().strip("/")
    if not re.match(r"^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$", repo):
        raise HTTPException(status_code=400, detail="repo must be in owner/repo format")

    gh_path = body.path.strip().strip("/")
    api_url = f"https://api.github.com/repos/{repo}/contents/{gh_path}" if gh_path else f"https://api.github.com/repos/{repo}/contents"

    headers = {
        "Authorization": f"token {body.pat}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "CSA-Swarm-Platform/1.0",
    }

    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get(api_url, headers=headers)
            if resp.status_code == 401:
                raise HTTPException(status_code=401, detail="GitHub PAT is invalid or expired")
            if resp.status_code == 404:
                raise HTTPException(status_code=404, detail="GitHub repo or path not found (or PAT lacks access)")
            resp.raise_for_status()
            data = resp.json()
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {exc}") from exc

    # data is either a single file object or a list of directory entries
    if isinstance(data, dict) and data.get("type") == "file":
        # Single file — decode base64 content
        import base64
        try:
            text = base64.b64decode(data["content"].replace("\n", "")).decode("utf-8", errors="replace")
        except Exception as exc:
            raise HTTPException(status_code=422, detail=f"Could not decode file content: {exc}") from exc
        label = body.label or data.get("name", gh_path or repo)
        source = await store.save_grounding_source(
            session_id=session_id,
            filename=data.get("path", gh_path),
            label=label,
            content=text,
        )
        return source

    if isinstance(data, list):
        # Directory listing — fetch all text files (≤ 500 KB total per file)
        MAX_FILE_SIZE = 500_000  # bytes
        TEXT_EXTENSIONS = {".txt", ".md", ".py", ".ts", ".tsx", ".js", ".jsx",
                           ".yaml", ".yml", ".json", ".toml", ".csv", ".sh",
                           ".tf", ".bicep", ".html", ".css", ".env.example",
                           ".gitignore", ".dockerignore", "dockerfile"}
        collected: list[str] = []

        async with httpx.AsyncClient(timeout=20) as client:
            for entry in data:
                if entry.get("type") != "file":
                    continue
                name: str = entry.get("name", "")
                size: int = entry.get("size", 0)
                ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else name.lower()
                if ext not in TEXT_EXTENSIONS:
                    continue
                if size > MAX_FILE_SIZE:
                    continue
                file_resp = await client.get(entry["download_url"], headers={"Authorization": f"token {body.pat}"}, timeout=20)
                if file_resp.status_code == 200:
                    collected.append(f"### {entry['path']}\n\n{file_resp.text}")

        if not collected:
            raise HTTPException(status_code=422, detail="No readable text files found in the specified path")

        combined = "\n\n---\n\n".join(collected)
        label = body.label or f"{repo}/{gh_path}" if gh_path else repo
        source = await store.save_grounding_source(
            session_id=session_id,
            filename=f"github:{repo}/{gh_path}" if gh_path else f"github:{repo}",
            label=label,
            content=combined,
        )
        return source

    raise HTTPException(status_code=422, detail="Unexpected GitHub API response format")


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
