"""
api/auth.py

Entra ID Bearer JWT validation for FastAPI.
When AUTH_ENABLED=false (local dev), returns a synthetic user identity.
"""
from __future__ import annotations

import base64
import json
from typing import Any

import httpx
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt
from jose.exceptions import JWKError

from config.settings import (
    AUTH_ENABLED,
    AUTH_TRUSTED_GATEWAY,
    ENTRA_CLIENT_ID,
    ENTRA_TENANT_ID,
    GATEWAY_SHARED_SECRET,
)

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


def _get_gateway_user(request: Request) -> dict[str, Any]:
    shared_secret = request.headers.get("x-gateway-shared-secret", "")
    if not GATEWAY_SHARED_SECRET or shared_secret != GATEWAY_SHARED_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid gateway secret",
        )

    encoded_payload = request.headers.get("x-authenticated-user", "")
    if not encoded_payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authenticated user header",
        )

    try:
        decoded = base64.b64decode(encoded_payload.encode("utf-8"), validate=True)
        payload = json.loads(decoded.decode("utf-8"))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid authenticated user header: {exc}",
        )

    if not isinstance(payload, dict) or not payload.get("sub"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authenticated user payload",
        )

    return payload


async def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> dict[str, Any]:
    """
    Dependency that validates the Bearer JWT and returns the decoded payload.
    In dev mode (AUTH_ENABLED=false) returns a synthetic user.
    """
    if AUTH_TRUSTED_GATEWAY:
        return _get_gateway_user(request)

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
