# ApnaDairy B2C — shared FastAPI dependencies.
#
#   get_current_customer(request) -> customer_id (customer_profiles.id, UUID str).
#       401 if the Authorization Bearer token is missing/malformed/invalid.
#       403 if the auth user has no linked customer_profiles row.
#       DEMO FALLBACK (explicit opt-in ONLY): when env AUTH_DEMO_ENABLED ==
#       "true", the token is NOT validated and env DEMO_CUSTOMER_ID is
#       returned (with a warning log). AUTH_DEMO_ENABLED defaults to "false"
#       — the demo fallback is IMPOSSIBLE in production unless explicitly
#       enabled. Never enable it outside local dev.
#
#   require_staff(request) -> True.
#       Checks the X-Staff-Key header against env STAFF_API_KEY (non-empty).
#       401 if the header is missing, 403 if it is wrong, 503 if STAFF_API_KEY
#       is not configured on the server.

import logging
import os

from fastapi import Depends, HTTPException, Request  # noqa: F401 (re-exported)

from app.core.security import validate_supabase_jwt
from app.db.supabase_client import get_mobile_client

logger = logging.getLogger(__name__)

_DEMO_CUSTOMER_FALLBACK_ID = "00000000-0000-0000-0000-000000000001"


def _demo_enabled() -> bool:
    # Defaults to "false": demo fallback is impossible unless explicitly
    # enabled for local dev.
    return os.environ.get("AUTH_DEMO_ENABLED", "false").strip().lower() == "true"


def get_current_customer(request: Request) -> str:
    """Return the customer_id (customer_profiles.id) for the request's user.

    Tries real JWT validation FIRST when a Bearer <redacted> present.
    Demo fallback (DEMO_CUSTOMER_ID) applies only when there is no valid
    Bearer <redacted> AUTH_DEMO_ENABLED=true (dev convenience).
    """
    auth = request.headers.get("authorization", "")
    token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
    if token:
        try:
            claims = validate_supabase_jwt(token)
        except HTTPException:
            token = None  # fall through to demo/401 handling below
        else:
            sub = claims.get("sub")
            if sub:
                client = get_mobile_client()
                res = (
                    client.table("customer_profiles")
                    .select("id")
                    .eq("auth_user_id", sub)
                    .limit(1)
                    .execute()
                )
                rows = res.data or []
                if rows:
                    return rows[0]["id"]
                raise HTTPException(
                    status_code=403,
                    detail="No customer profile for this account.",
                )
    if _demo_enabled():
        logger.warning(
            "AUTH_DEMO_ENABLED is on: using demo customer fallback "
            "(no valid Bearer token)."
        )
        return (
            os.environ.get("DEMO_CUSTOMER_ID", "").strip()
            or _DEMO_CUSTOMER_FALLBACK_ID
        )
    raise HTTPException(
        status_code=401,
        detail="Login required (missing or invalid Authorization Bearer token).",
    )


def require_staff(request: Request) -> bool:
    """Guard internal/staff endpoints with a shared X-Staff-Key header."""
    expected = os.environ.get("STAFF_API_KEY", "").strip()
    if not expected:
        raise HTTPException(
            status_code=503,
            detail="Server misconfigured (STAFF_API_KEY missing).",
        )
    provided = request.headers.get("x-staff-key")
    if not provided:
        raise HTTPException(
            status_code=401, detail="Staff key required (X-Staff-Key)."
        )
    if provided != expected:
        raise HTTPException(status_code=403, detail="Wrong staff key.")
    return True
