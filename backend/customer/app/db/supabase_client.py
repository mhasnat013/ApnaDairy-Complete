# ApnaDairy B2C — Supabase clients (two projects).
# MOBILE project ("ApnaDairy Mobile App"): our portal/transactional tables, read+write.
# WEB project (apnadairy-web): operational data (products, area_managers), READ-ONLY.
# Service-role key never leaves this server. Cached one client per process.

import os

from fastapi import HTTPException
from supabase import Client, create_client

_mobile_client: Client | None = None
_web_client: Client | None = None


def _require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise HTTPException(
            status_code=503,
            detail=f"Server misconfigured ({name} missing).",
        )
    return value


def get_mobile_client() -> Client:
    """Service-role client for the MOBILE Supabase project (read+write)."""
    global _mobile_client
    if _mobile_client is None:
        _mobile_client = create_client(
            _require_env("SUPABASE_MOBILE_URL"),
            _require_env("SUPABASE_MOBILE_SERVICE_KEY"),
        )
    return _mobile_client


def get_web_client() -> Client:
    """Service-role client for the WEB Supabase project.

    READ-ONLY by convention: never call insert/update/delete/upsert on this
    client anywhere in the codebase.
    """
    global _web_client
    if _web_client is None:
        _web_client = create_client(
            _require_env("SUPABASE_WEB_URL"),
            _require_env("SUPABASE_WEB_SERVICE_KEY"),
        )
    return _web_client


def reset_clients() -> None:
    """Drop cached clients (tests)."""
    global _mobile_client, _web_client
    _mobile_client = None
    _web_client = None


def get_mobile_anon_client() -> Client:
    """Fresh ANON-key client for end-user auth calls (login, OTP, reset).

    CRITICAL: never use the cached service-role client for
    sign_in_with_password / sign_in_with_otp / verify_otp — supabase-py
    pins the signed-in user's JWT onto the client object, which would
    silently downgrade every later DB call in this process to the
    `authenticated` role (RLS 42501 on all endpoints until restart).
    A throwaway client per call cannot leak session state.
    """
    return create_client(
        _require_env("SUPABASE_MOBILE_URL"),
        _require_env("SUPABASE_MOBILE_ANON_KEY"),
    )
