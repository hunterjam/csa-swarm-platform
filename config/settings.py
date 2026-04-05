"""
config/settings.py
Loads all environment configuration from .env.
"""
import os
from dotenv import load_dotenv

load_dotenv(override=False)


def _require(key: str) -> str:
    value = os.getenv(key)
    if not value:
        raise EnvironmentError(
            f"Required environment variable '{key}' is not set. "
            "Copy .env.example to .env and fill in your values."
        )
    return value


# ── Microsoft Agent Framework / Azure AI Foundry ────────────────────────
FOUNDRY_PROJECT_ENDPOINT: str = _require("FOUNDRY_PROJECT_ENDPOINT")
FOUNDRY_MODEL_DEPLOYMENT_NAME: str = os.getenv("FOUNDRY_MODEL_DEPLOYMENT_NAME", "gpt-4o")

# ── Cosmos DB ────────────────────────────────────────────────────────────
COSMOS_ENDPOINT: str = _require("COSMOS_ENDPOINT")
COSMOS_DATABASE: str = os.getenv("COSMOS_DATABASE", "csa_swarm")
COSMOS_CONTAINER: str = os.getenv("COSMOS_CONTAINER", "swarm")
# Leave blank in production — use DefaultAzureCredential
COSMOS_KEY: str = os.getenv("COSMOS_KEY", "")

# ── Entra ID auth ────────────────────────────────────────────────────────
ENTRA_TENANT_ID: str = os.getenv("ENTRA_TENANT_ID", "")
ENTRA_CLIENT_ID: str = os.getenv("ENTRA_CLIENT_ID", "")
# Set to "false" for local dev
AUTH_ENABLED: bool = os.getenv("AUTH_ENABLED", "true").lower() == "true"

# ── CORS ─────────────────────────────────────────────────────────────────
_cors_raw: str = os.getenv("CORS_ORIGINS", "http://localhost:3000")
CORS_ORIGINS: list[str] = [o.strip() for o in _cors_raw.split(",") if o.strip()]

# ── App behaviour ────────────────────────────────────────────────────────
MAX_DEBATE_ROUNDS: int = int(os.getenv("MAX_DEBATE_ROUNDS", "5"))
