"""
api/deps.py

Shared FastAPI dependencies.
The CosmosStore is initialised once at startup (see api/app.py lifespan)
and stored on app.state.store.
"""
from __future__ import annotations

from fastapi import Request

from swarm.cosmos_store import CosmosStore


def get_store(request: Request) -> CosmosStore:
    return request.app.state.store
