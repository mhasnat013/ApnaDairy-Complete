# ApnaDairy B2C — Supabase JWT validation (server-side).
#
# Every protected customer request carries the mobile app's Supabase access
# token as:
#   Authorization: Bearer <access_token>
#
# This module verifies the token's signature against the mobile Supabase
# project's JWKS ({SUPABASE_MOBILE_URL}/auth/v1/.well-known/jwks.json),
# then enforces expiry (exp), issuer (iss) and audience (aud).
# Both RS256 (older projects) and ES256 (newer projects, ECDSA P-256)
# signing keys are supported.
#
# Contract:
#   validate_supabase_jwt(token) -> claims dict (always contains "sub").
#   Raises HTTPException(401) on ANY bad/expired token.
#   Raises HTTPException(503) when JWKS cannot be fetched or
#   SUPABASE_MOBILE_URL is not configured.
#
# The demo auth bridge (AUTH_DEMO_ENABLED) lives in app/core/deps.py, not here.

import json
import logging
import os
import time
from collections.abc import Callable

import httpx
import jwt
from fastapi import HTTPException

logger = logging.getLogger(__name__)

# How long a fetched JWKS stays valid (seconds).
_JWKS_TTL_SECONDS = 600

# kid -> (public key, algorithm), plus when it was fetched.
_jwks_cache: dict = {"keys": {}, "fetched_at": 0.0}


def _mobile_url() -> str:
    """Base URL of the Supabase project that owns auth (mobile project)."""
    url = os.environ.get("SUPABASE_MOBILE_URL", "").rstrip("/")
    if not url:
        raise HTTPException(
            status_code=503,
            detail="Auth not configured (SUPABASE_MOBILE_URL missing).",
        )
    return url


def _expected_issuer() -> str:
    return f"{_mobile_url()}/auth/v1"


def _fetch_jwks_uncached() -> dict:
    """Download the JWKS and return {kid: (public key, alg)}.

    Raises HTTPException(503) on any failure — never leaks key material.
    """
    jwks_url = f"{_mobile_url()}/auth/v1/.well-known/jwks.json"
    try:
        resp = httpx.get(jwks_url, timeout=10.0)
        resp.raise_for_status()
        jwks = resp.json()
    except Exception as exc:  # network down, bad JSON, non-2xx ...
        logger.warning("JWKS fetch failed for %s: %s", jwks_url, exc)
        raise HTTPException(
            status_code=503, detail="Could not verify login (key service down)."
        ) from exc

    keys: dict = {}
    for jwk in jwks.get("keys", []):
        kid = jwk.get("kid")
        kty = jwk.get("kty")
        if not kid:
            continue
        try:
            if kty == "RSA":
                # Older Supabase projects sign with RS256.
                keys[kid] = (
                    jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(jwk)),
                    "RS256",
                )
            elif kty == "EC":
                # Newer Supabase projects sign with ES256 (ECDSA P-256).
                alg = jwk.get("alg") or "ES256"
                keys[kid] = (
                    jwt.algorithms.ECAlgorithm.from_jwk(json.dumps(jwk)),
                    alg,
                )
            else:
                continue
        except Exception as exc:  # malformed JWK — skip, don't crash
            logger.warning("Skipping malformed JWK (kid=%s): %s", kid, exc)
    if not keys:
        raise HTTPException(
            status_code=503, detail="Could not verify login (no signing keys)."
        )
    return keys


def get_jwks_keys() -> dict:
    """Return cached {kid: (public key, alg)}, refreshing every 10 minutes."""
    now = time.time()
    if (
        _jwks_cache["keys"]
        and now - _jwks_cache["fetched_at"] < _JWKS_TTL_SECONDS
    ):
        return _jwks_cache["keys"]
    keys = _fetch_jwks_uncached()
    _jwks_cache["keys"] = keys
    _jwks_cache["fetched_at"] = now
    return keys


def reset_jwks_cache() -> None:
    """Drop the cached JWKS (used by tests)."""
    _jwks_cache["keys"] = {}
    _jwks_cache["fetched_at"] = 0.0


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def validate_supabase_jwt(
    token: str,
    jwks_fetcher: Callable[[], dict] | None = None,
) -> dict:
    """Verify a Supabase access token and return its claims.

    Checks, in order: token is a well-formed JWT with a kid, the kid has a
    (cached) signing key, the signature verifies, exp/aud/iss match.
    Raises HTTPException(401) on ANY bad/expired token, HTTPException(503)
    when the key service is unreachable or auth is unconfigured.
    Pass jwks_fetcher in tests to avoid network (it must return
    {kid: (public key, alg)} or {kid: public key}).
    """
    if not token or not token.strip():
        raise _unauthorized("Login required (no token).")
    token = token.strip()

    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized("Invalid login token.") from None
    kid = header.get("kid")
    if not kid:
        raise _unauthorized("Invalid login token.")

    fetcher = jwks_fetcher or get_jwks_keys
    try:
        keys = fetcher()
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("JWKS fetcher failed: %s", exc)
        raise HTTPException(
            status_code=503, detail="Could not verify login (key service down)."
        ) from exc

    key_entry = keys.get(kid)
    if key_entry is None:
        # One refresh attempt: Supabase may have rotated signing keys.
        reset_jwks_cache()
        try:
            keys = (jwks_fetcher or _fetch_jwks_uncached)()
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="Could not verify login (key service down).",
            ) from exc
        key_entry = keys.get(kid)
        if key_entry is None:
            raise _unauthorized("Invalid login token.")

    # Cache entries are (key, alg) tuples; plain keys from test injectors
    # fall back to RS256 for backward compatibility.
    if isinstance(key_entry, tuple):
        key, alg = key_entry
    else:
        key, alg = key_entry, "RS256"

    try:
        claims = jwt.decode(
            token,
            key=key,
            algorithms=[alg],
            audience="authenticated",
            issuer=_expected_issuer(),
            # Clock skew between Supabase and this server would otherwise 401
            # every fresh token for its first seconds (PyJWT verifies iat).
            leeway=30,
            options={"require": ["exp", "iss", "sub"]},
        )
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Session expired — log in again.") from None
    except (jwt.InvalidAudienceError, jwt.InvalidIssuerError):
        raise _unauthorized("Invalid login token.") from None
    except jwt.PyJWTError:
        raise _unauthorized("Invalid login token.") from None
    return claims
