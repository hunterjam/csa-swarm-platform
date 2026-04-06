"""
api/app.py

FastAPI application factory.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import context, debate, recommendations, roles, sessions
import asyncio
import logging

from config.settings import CORS_ORIGINS
from swarm.cosmos_store import CosmosStore

log = logging.getLogger(__name__)


@asynccontextmanager
async def _lifespan(app: FastAPI):
    store = CosmosStore()
    app.state.store = store
    # ensure_infrastructure runs in background — Bicep already creates the
    # database/container, so this is just a safety net and must not block startup.
    asyncio.create_task(_init_store(store))
    yield
    await store.close()


async def _init_store(store: CosmosStore) -> None:
    try:
        await store.ensure_infrastructure()
    except Exception as exc:  # noqa: BLE001
        log.warning("ensure_infrastructure failed (non-fatal): %s", exc)


def create_app() -> FastAPI:
    app = FastAPI(
        title="CSA Swarm Platform API",
        version="2.0.0",
        lifespan=_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=CORS_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(sessions.router)
    app.include_router(debate.router)
    app.include_router(context.router)
    app.include_router(recommendations.router)
    app.include_router(roles.router)

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    return app
