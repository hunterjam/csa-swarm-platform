"""
api/auth.py

Entra ID Bearer JWT validation for FastAPI.
When AUTH_ENABLED=false (local dev), returns a synthetic user identity.
"""
from __future__ import annotations

from typing import Any

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from jose.exceptions import JWKError

from config.settings import AUTH_ENABLED, ENTRA_CLIENT_ID, ENTRA_TENANT_ID

_bearer = HTTPBearer(auto_error=False)

# JWKS cache (module-level, refreshed lazily)
_jwks_cache: dict | None = None


async def _get_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    url = f"https://login.microsoftonline.com/{ENTRA_TENANT_ID}/discovery/v2.0/keys"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=10)
        resp.raise_for_status()
    _jwks_cache = resp.json()
    return _jwks_cache


def _get_dev_user() -> dict[str, Any]:
    return {
        "sub": "dev-user",
        "name": "Dev User",
        "email": "dev@localhost",
    }


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    """
    Dependency that validates the Bearer JWT and returns the decoded payload.
    In dev mode (AUTH_ENABLED=false) returns a synthetic user.
    """
    if not AUTH_ENABLED:
        return _get_dev_user()

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
        )

    token = credentials.credentials

    try:
        header = jwt.get_unverified_header(token)
        jwks = await _get_jwks()

        # Find matching key
        key: dict | None = next(
            (k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")),
            None,
        )
        if key is None:
            # JWKS may have rotated — invalidate cache and retry once
            global _jwks_cache
            _jwks_cache = None
            jwks = await _get_jwks()
            key = next(
                (k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")),
                None,
            )
        if key is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unknown signing key",
            )

        payload = jwt.decode(
            token,
            key,
            algorithms=["RS256"],
            audience=ENTRA_CLIENT_ID,
        )
        return payload

    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except (JWTError, JWKError) as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )
