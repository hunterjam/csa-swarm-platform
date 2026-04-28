"""
swarm/cosmos_store.py

Azure Cosmos DB NoSQL adapter for multi-user session persistence.

Data model — single container, partition key: /session_id
Document types (discriminated by 'type' field):
  - session      : {id, type, session_id, user_id, name, created_at, agent_config}
  - round        : {id, type, session_id, round_number, pm_message, csa_responses,
                    dir_response, created_at}
  - recommendation: {id, type, session_id, doc_type, content, updated_at}
  - grounding    : {id, type, session_id, position, name, source_type, content,
                    pinned, created_at}

Auth uses DefaultAzureCredential (managed identity in ACA, az login locally).
Set COSMOS_KEY only in local dev without managed identity.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

from azure.cosmos.aio import CosmosClient
from azure.cosmos import PartitionKey
from azure.identity.aio import DefaultAzureCredential

from config import settings

_client: CosmosClient | None = None
_container = None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_container():
    global _client, _container
    if _container is not None:
        return _container

    if settings.COSMOS_KEY:
        _client = CosmosClient(settings.COSMOS_ENDPOINT, credential=settings.COSMOS_KEY)
    else:
        credential = DefaultAzureCredential()
        _client = CosmosClient(settings.COSMOS_ENDPOINT, credential=credential)

    db = _client.get_database_client(settings.COSMOS_DATABASE)
    _container = db.get_container_client(settings.COSMOS_CONTAINER)
    return _container


async def ensure_infrastructure() -> None:
    """Create database and container on first startup if they don't exist."""
    if settings.COSMOS_KEY:
        client = CosmosClient(settings.COSMOS_ENDPOINT, credential=settings.COSMOS_KEY)
    else:
        client = CosmosClient(settings.COSMOS_ENDPOINT, credential=DefaultAzureCredential())

    db = await client.create_database_if_not_exists(settings.COSMOS_DATABASE)
    await db.create_container_if_not_exists(
        id=settings.COSMOS_CONTAINER,
        partition_key=PartitionKey(path="/session_id"),
    )


# ── Sessions ──────────────────────────────────────────────────────────────

async def create_session(user_id: str, name: str, agent_config: dict | None = None) -> dict:
    container = await _get_container()
    session_id = str(uuid.uuid4())
    doc = {
        "id": f"session:{session_id}",
        "type": "session",
        "session_id": session_id,
        "user_id": user_id,
        "name": name,
        "created_at": _now_iso(),
        "agent_config": agent_config or {},
    }
    await container.create_item(body=doc)
    return doc


async def get_session(session_id: str) -> dict | None:
    container = await _get_container()
    try:
        return await container.read_item(
            item=f"session:{session_id}", partition_key=session_id
        )
    except Exception:
        return None


async def list_sessions(user_id: str) -> list[dict]:
    container = await _get_container()
    query = "SELECT * FROM c WHERE c.type = 'session' AND c.user_id = @uid ORDER BY c.created_at DESC"
    items = container.query_items(
        query=query,
        parameters=[{"name": "@uid", "value": user_id}],
    )
    return [item async for item in items]


async def delete_session(session_id: str) -> None:
    """Delete a session and all its child documents."""
    container = await _get_container()
    query = "SELECT c.id FROM c WHERE c.session_id = @sid"
    items = container.query_items(
        query=query,
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    async for item in items:
        await container.delete_item(item=item["id"], partition_key=session_id)


# ── Debate rounds ─────────────────────────────────────────────────────────

async def save_round(session_id: str, round_data: dict) -> dict:
    container = await _get_container()
    round_number = round_data["round_number"]
    doc = {
        "id": f"round:{session_id}:{round_number}",
        "type": "round",
        "session_id": session_id,
        **round_data,
        "created_at": _now_iso(),
    }
    await container.upsert_item(body=doc)
    return doc


async def get_rounds(session_id: str) -> list[dict]:
    container = await _get_container()
    query = (
        "SELECT * FROM c WHERE c.type = 'round' AND c.session_id = @sid "
        "ORDER BY c.round_number ASC"
    )
    items = container.query_items(
        query=query,
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    return [item async for item in items]


# ── Recommendations ───────────────────────────────────────────────────────

async def save_recommendation(session_id: str, doc_type: str, content: str) -> dict:
    container = await _get_container()
    doc = {
        "id": f"rec:{session_id}:{doc_type}",
        "type": "recommendation",
        "session_id": session_id,
        "doc_type": doc_type,
        "content": content,
        "updated_at": _now_iso(),
    }
    await container.upsert_item(body=doc)
    return doc


async def get_recommendations(session_id: str) -> list[dict]:
    container = await _get_container()
    query = "SELECT * FROM c WHERE c.type = 'recommendation' AND c.session_id = @sid"
    items = container.query_items(
        query=query,
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    return [item async for item in items]


# ── Grounding sources ─────────────────────────────────────────────────────

async def save_grounding_source(
    session_id: str,
    name: str,
    source_type: str,
    content: str,
    pinned: bool = False,
) -> dict:
    container = await _get_container()
    position = str(uuid.uuid4())
    doc = {
        "id": f"grounding:{session_id}:{position}",
        "type": "grounding",
        "session_id": session_id,
        "position": position,
        "name": name,
        "source_type": source_type,
        "content": content,
        "pinned": pinned,
        "created_at": _now_iso(),
    }
    await container.create_item(body=doc)
    return doc


def _normalize_grounding_source(doc: dict) -> dict:
    """Map Cosmos field names to the shape the frontend GroundingSource type expects."""
    return {
        "id": doc.get("id", ""),
        "session_id": doc.get("session_id", ""),
        "position": doc.get("position", ""),
        "filename": doc.get("source_type", doc.get("filename", "")),
        "label": doc.get("name", doc.get("label", "")),
        "content": doc.get("content", ""),
        "pinned": doc.get("pinned", False),
        "created_at": doc.get("created_at", ""),
    }


async def get_grounding_sources(session_id: str) -> list[dict]:
    container = await _get_container()
    query = (
        "SELECT c.id, c.position, c.name, c.source_type, c.content, c.pinned, c.created_at, c.session_id "
        "FROM c WHERE c.type = 'grounding' AND c.session_id = @sid "
        "ORDER BY c.created_at ASC"
    )
    items = container.query_items(
        query=query,
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    return [_normalize_grounding_source(item) async for item in items]


async def get_grounding_block(session_id: str) -> str:
    """Return full grounding text joined for injection into agent user messages."""
    container = await _get_container()
    query = (
        "SELECT c.name, c.content FROM c "
        "WHERE c.type = 'grounding' AND c.session_id = @sid "
        "ORDER BY c.created_at ASC"
    )
    items = container.query_items(
        query=query,
        parameters=[{"name": "@sid", "value": session_id}],
        partition_key=session_id,
    )
    parts: list[str] = []
    async for item in items:
        parts.append(f"[Source: {item['name']}]\n{item['content']}")
    return "\n\n".join(parts)


async def delete_grounding_source(session_id: str, position: str) -> None:
    container = await _get_container()
    await container.delete_item(
        item=f"grounding:{session_id}:{position}", partition_key=session_id
    )


async def toggle_grounding_pin(session_id: str, position: str) -> dict:
    container = await _get_container()
    item = await container.read_item(
        item=f"grounding:{session_id}:{position}", partition_key=session_id
    )
    item["pinned"] = not item.get("pinned", False)
    return await container.replace_item(item=item["id"], body=item)


# ── CosmosStore class (used by app.py lifespan + FastAPI deps) ────────────

def _normalize_session(doc: dict) -> dict:
    """
    Remap a raw Cosmos session document to the shape the frontend expects:
      - id       → the plain UUID (from session_id), not the "session:" prefixed CosmosDB id
      - title    → doc["name"]  (Cosmos stores "name"; frontend Session type uses "title")
    """
    return {
        "id": doc.get("session_id", doc["id"]),
        "user_id": doc.get("user_id", ""),
        "title": doc.get("name", doc.get("title", "")),
        "created_at": doc.get("created_at", ""),
        "updated_at": doc.get("updated_at", doc.get("created_at", "")),
        "agent_config": doc.get("agent_config", {}),
        "deleted_roles": doc.get("deleted_roles", []),
        "model": doc.get("model", None),
    }


async def update_agent_config(
    session_id: str,
    agent_config: dict,
    deleted_roles: list[str] | None = None,
) -> dict:
    """Overwrite the agent_config map (and optional deleted_roles list) on a session document."""
    container = await _get_container()
    doc = await container.read_item(
        item=f"session:{session_id}", partition_key=session_id
    )
    doc["agent_config"] = agent_config
    doc["deleted_roles"] = deleted_roles or []
    updated = await container.replace_item(item=doc["id"], body=doc)
    return _normalize_session(updated)


async def update_session_model(session_id: str, model: str | None) -> dict:
    """Update the model override for a session."""
    container = await _get_container()
    doc = await container.read_item(
        item=f"session:{session_id}", partition_key=session_id
    )
    doc["model"] = model
    doc["updated_at"] = _now_iso()
    updated = await container.replace_item(item=doc["id"], body=doc)
    return _normalize_session(updated)


class CosmosStore:
    """
    Thin class wrapper around the module-level Cosmos helpers.
    Provides the interface expected by FastAPI routes and the app lifespan.
    """

    async def ensure_infrastructure(self) -> None:
        await ensure_infrastructure()

    async def close(self) -> None:
        global _client, _container
        if _client is not None:
            await _client.close()
            _client = None
        _container = None

    # ── Sessions ──────────────────────────────────────────────────────────

    async def create_session(
        self, session_id: str, user_id: str, title: str = "New Session"
    ) -> dict:
        container = await _get_container()
        doc = {
            "id": f"session:{session_id}",
            "type": "session",
            "session_id": session_id,
            "user_id": user_id,
            "name": title,
            "created_at": _now_iso(),
            "agent_config": {},
        }
        await container.create_item(body=doc)
        return _normalize_session(doc)

    async def list_sessions(self, user_id: str) -> list[dict]:
        docs = await list_sessions(user_id=user_id)
        return [_normalize_session(d) for d in docs]

    async def get_session(self, session_id: str, user_id: str) -> dict | None:
        doc = await get_session(session_id=session_id)
        if doc is None:
            return None
        # Enforce per-user isolation
        if doc.get("user_id") != user_id:
            return None
        return _normalize_session(doc)

    async def delete_session(self, session_id: str) -> None:
        await delete_session(session_id=session_id)

    # ── Debate rounds ──────────────────────────────────────────────────────

    async def save_round(self, session_id: str, round_data: dict) -> dict:
        return await save_round(session_id=session_id, round_data=round_data)

    async def get_rounds(self, session_id: str) -> list[dict]:
        return await get_rounds(session_id=session_id)

    # ── Recommendations ────────────────────────────────────────────────────

    async def save_recommendation(
        self, session_id: str, doc_type: str, content: str
    ) -> dict:
        return await save_recommendation(
            session_id=session_id, doc_type=doc_type, content=content
        )

    async def get_recommendations(self, session_id: str) -> list[dict]:
        return await get_recommendations(session_id=session_id)

    # ── Grounding sources ──────────────────────────────────────────────────

    async def save_grounding_source(
        self,
        session_id: str,
        filename: str,
        label: str,
        content: str,
    ) -> dict:
        # label  → displayed name; filename → source_type for categorisation
        doc = await save_grounding_source(
            session_id=session_id,
            name=label,
            source_type=filename,
            content=content,
        )
        return _normalize_grounding_source(doc)

    async def get_grounding_sources(self, session_id: str) -> list[dict]:
        return await get_grounding_sources(session_id=session_id)  # already normalized

    async def get_grounding_block(self, session_id: str) -> str:
        return await get_grounding_block(session_id=session_id)

    async def delete_grounding_source(self, session_id: str, position: str) -> None:
        await delete_grounding_source(session_id=session_id, position=position)

    async def toggle_grounding_pin(self, session_id: str, position: str) -> dict | None:  # noqa: E501
        try:
            doc = await toggle_grounding_pin(session_id=session_id, position=position)
            return _normalize_grounding_source(doc)
        except Exception:
            return None

    async def update_agent_config(
        self,
        session_id: str,
        agent_config: dict,
        deleted_roles: list[str] | None = None,
    ) -> dict:
        return await update_agent_config(
            session_id=session_id,
            agent_config=agent_config,
            deleted_roles=deleted_roles,
        )

    async def update_session_model(self, session_id: str, model: str | None) -> dict:
        return await update_session_model(session_id=session_id, model=model)
