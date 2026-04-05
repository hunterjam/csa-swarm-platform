"""
main.py — Entry point for csa-swarm-platform backend.
"""
from __future__ import annotations

import uvicorn
from dotenv import load_dotenv

load_dotenv(override=False)

from api.app import create_app  # noqa: E402 — must be imported after dotenv

app = create_app()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
