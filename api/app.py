"""
api/app.py

FastAPI application factory.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import context, debate, recommendations, sessions
from config.settings import CORS_ORIGINS
from swarm.cosmos_store import CosmosStore


@asynccontextmanager
async def _lifespan(app: FastAPI):
    store = CosmosStore()
    await store.ensure_infrastructure()
    app.state.store = store
    yield
    await store.close()


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

    @app.get("/health")
    async def health() -> dict:
        return {"status": "ok"}

    return app
