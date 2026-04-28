"""
api/routes/roles.py

Role configuration endpoints:
  GET  /api/roles                                → list default roles from roles.yaml
  GET  /api/sessions/{session_id}/agent-config   → session roles (overrides merged with defaults)
  PUT  /api/sessions/{session_id}/agent-config   → save session-level role overrides
  POST /api/sessions/{session_id}/agent-config/bootstrap  → generate role from transcript
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from api.deps import get_store
from agents.role_agents import load_roles
from swarm.cosmos_store import CosmosStore
from swarm.transcript_bootstrap import generate_role_from_transcript

router = APIRouter(tags=["roles"])


# ── Default roles ─────────────────────────────────────────────────────────

@router.get("/api/roles")
async def list_default_roles(
    user: dict[str, Any] = Depends(get_current_user),
) -> dict:
    """Return the default role configs from roles.yaml."""
    return load_roles()


# ── Session-scoped agent config ───────────────────────────────────────────

@router.get("/api/sessions/{session_id}/agent-config")
async def get_agent_config(
    session_id: str,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    """
    Return the effective role config for a session.
    Overrides from the session are merged on top of defaults from roles.yaml.
    Response shape: { defaults: {...}, overrides: {...}, merged: {...} }
    """
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    defaults = load_roles()
    overrides: dict = session.get("agent_config") or {}
    deleted_roles: list = session.get("deleted_roles") or []

    merged: dict = {}
    for key, default in defaults.items():
        if key in deleted_roles:
            continue
        override = overrides.get(key, {})
        merged[key] = {**default, **override} if override else dict(default)
    # Include extra csa_* keys from session overrides not present in defaults
    for key, val in overrides.items():
        if key.startswith("csa_") and key not in defaults and isinstance(val, dict):
            merged[key] = val

    return {
        "defaults": defaults,
        "overrides": overrides,
        "merged": merged,
        "deleted_roles": deleted_roles,
    }


class AgentConfigBody(BaseModel):
    # Mapping of role_key → partial role dict (only fields being overridden)
    overrides: dict[str, dict]
    # Default role keys the user has removed from this session
    deleted_roles: list[str] = []


@router.put("/api/sessions/{session_id}/agent-config")
async def put_agent_config(
    session_id: str,
    body: AgentConfigBody,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    """Save session-level role overrides. Returns the updated merged config."""
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    # Validate: at least 1 CSA role must remain after deletions
    defaults = load_roles()
    surviving_csa = [
        k for k in defaults
        if k.startswith("csa_") and k not in body.deleted_roles
    ]
    extra_csa = [
        k for k in body.overrides
        if k.startswith("csa_") and k not in defaults
    ]
    if len(surviving_csa) + len(extra_csa) < 1:
        raise HTTPException(
            status_code=422,
            detail="At least one CSA role is required.",
        )

    await store.update_agent_config(
        session_id=session_id,
        agent_config=body.overrides,
        deleted_roles=body.deleted_roles,
    )

    merged: dict = {}
    for key, default in defaults.items():
        if key in body.deleted_roles:
            continue
        override = body.overrides.get(key, {})
        merged[key] = {**default, **override} if override else dict(default)
    # Include extra csa_* keys from overrides not present in defaults
    for key, val in body.overrides.items():
        if key.startswith("csa_") and key not in defaults and isinstance(val, dict):
            merged[key] = val

    return {
        "overrides": body.overrides,
        "merged": merged,
        "deleted_roles": body.deleted_roles,
    }


class BootstrapRequest(BaseModel):
    transcript: str
    role_type: Literal["csa", "director"] = "csa"


@router.post("/api/sessions/{session_id}/agent-config/bootstrap")
async def bootstrap_role(
    session_id: str,
    body: BootstrapRequest,
    user: dict[str, Any] = Depends(get_current_user),
    store: CosmosStore = Depends(get_store),
) -> dict:
    """
    Generate a draft role config (display_name, domain, lens, system_prompt)
    from a raw meeting transcript using the LLM.
    The result is NOT automatically saved — the frontend shows it for review first.
    """
    session = await store.get_session(session_id=session_id, user_id=user["sub"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if len(body.transcript.strip()) < 50:
        raise HTTPException(
            status_code=422,
            detail="Transcript is too short — paste at least a short excerpt.",
        )

    try:
        result = await generate_role_from_transcript(body.transcript, body.role_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Bootstrap failed: {exc}") from exc

    return result
