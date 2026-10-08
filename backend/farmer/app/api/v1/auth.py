# ApnaDairy — Auth HTTP router (farmer portal v2).
#
# THE WEB PROJECT IS THE DATABASE for everything farmer-side:
#   apnadairy-web (Supabase). All auth users live in the WEB project's
# Supabase Auth; the backend's service-role client (get_web_client())
# performs Admin-API operations. There is no separate mobile project.
#
# REAL flow:
#   POST /api/v1/auth/signup — create the auth user via the Admin API, then
#     insert the web `profiles` row {id: auth user id, full_name, email,
#     phone, role: 'farmer', status: 'pending'}.
#   NOTE: password login happens app-side via supabase-js
#     signInWithPassword DIRECTLY against the WEB project. The backend holds
#     no anon key on purpose, so passwords NEVER touch our server at login.
#   POST /api/v1/auth/me — validate the Bearer token server-side and return
#     the session/profile aggregate (profile, farmer_profile, verification,
#     linked manager).
#   Google = signInWithOAuth in the app, then POST /api/v1/auth/google-link
#     ONCE to ensure the web `profiles` row exists (idempotent).
#   Every later call sends Authorization: Bearer <access_token>.
#
# DEMO BRIDGE (dev only, honest labels):
#   POST /api/v1/auth/demo-login | /demo-signup — any credentials work.
#   Gated behind AUTH_DEMO_ENABLED (explicit "true" only; default "false").

import logging
import os
import re
import time

from fastapi import APIRouter, Header, HTTPException

from app.core import deps
from app.core.deps import demo_auth_enabled
from app.db.supabase_client import first_row, get_web_client, table
from app.schemas.auth import (
    ChangePasswordIn,
    DemoAuthOut,
    DemoLoginIn,
    DemoSignupIn,
    ForgotPasswordIn,
    GoogleLinkIn,
    GoogleLinkOut,
    MeOut,
    RealSignupIn,
    RealSignupOut,
    VerificationOut,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

# profiles.status -> /me verification tri-state.
# There is no farmer_verifications table on the web project yet; until the
# onboarding/verification lane adds a dedicated state table (PENDING
# migration), the tri-state is derived from the profile status:
#   pending -> pending, active -> verified, suspended -> rejected.
_VERIFICATION_BY_PROFILE_STATUS = {
    "pending": "pending",
    "active": "verified",
    "suspended": "rejected",
}


def _demo_farmer_id() -> str:
    """The farmer every demo session acts as (real UUID from .env)."""
    return os.environ.get("DEMO_FARMER_ID", "farmer-001")


def _fresh_web_client():
    """Build a THROWAWAY web-project client (never cached).

    supabase-py pins the signed-in user's JWT onto the client instance after
    sign_in_with_password(). Using the shared service-role singleton here
    would poison every later DB call in this worker, so password flows get a
    fresh instance that is discarded after the request.
    """
    from supabase import create_client  # deferred: only needed when connecting

    return create_client(
        os.environ["SUPABASE_WEB_URL"],
        os.environ["SUPABASE_WEB_SERVICE_KEY"],
    )


def _bearer_token(authorization: str | None) -> str | None:
    """Extract the Bearer token from the Authorization header, if present."""
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip() or None
    return None


def _demo_guard() -> None:
    """Block demo endpoints when demo auth is disabled (production)."""
    if not demo_auth_enabled():
        raise HTTPException(status_code=403, detail="Demo auth is disabled.")


def _auth_user_id_of(created) -> str:
    """Extract the user id from a GoTrue admin create_user result.

    supabase-py 2.x returns a UserResponse wrapping the user in `.user`
    (i.e. created.user.id); tolerate dict-shaped fakes too.
    """
    # supabase-py 2.x UserResponse shape
    user = getattr(created, "user", None)
    if user is not None:
        return str(getattr(user, "id", ""))
    if isinstance(created, dict):
        user = created.get("user", created)
        return user.get("id") if isinstance(user, dict) else str(user)
    return str(getattr(created, "id", ""))


def _is_duplicate_error(exc: Exception) -> bool:
    """True when a Supabase error means the value is already registered."""
    msg = str(exc).lower()
    return (
        "already registered" in msg
        or "already exists" in msg
        or "duplicate" in msg
    )


@router.post("/signup", response_model=RealSignupOut, tags=["auth"])
def real_signup(payload: RealSignupIn) -> RealSignupOut:
    """Create a Supabase Auth user (WEB project) AND the web profiles row.

    The auth user is created through the Admin API with the service-role
    client; email is auto-confirmed so login works immediately. The profiles
    row links 1:1 on id = auth user id with role 'farmer' and status
    'pending' (SuperAdmin verifies the farmer profile later).
    Duplicate email or phone -> 409 with a clear message.
    """
    # Normalize phone to digits-only: DB trigger requires 11-digit format
    phone = re.sub(r"\D", "", payload.phone)
    client = get_web_client()

    # Phone uniqueness is enforced app-side (pre-check) so a duplicate phone
    # never leaves an orphan auth user behind.
    phone_taken = first_row(
        table(client, "profiles")
        .select("id")
        .eq("phone", phone)
        .limit(1)
        .execute()
    )
    if phone_taken is not None:
        raise HTTPException(
            status_code=409,
            detail="This phone number is already registered. Please log in instead.",
        )

    try:
        created = client.auth.admin.create_user(
            {
                "email": payload.email,
                "password": payload.password,
                "email_confirm": True,
                "user_metadata": {
                    "role": "farmer",
                    "full_name": payload.full_name,
                    "phone": phone,
                },
            }
        )
    except Exception as exc:
        logger.warning("Supabase admin create_user failed: %s", exc)
        if _is_duplicate_error(exc):
            raise HTTPException(
                status_code=409,
                detail="This email is already registered. Please log in instead.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail="Signup failed. Please try again.",
        ) from exc

    user_id = _auth_user_id_of(created)
    if not user_id:
        raise HTTPException(status_code=500, detail="Signup failed (no user id).")

    row = {
        "id": user_id,  # profiles.id IS the auth user id (1:1 link)
        "full_name": payload.full_name,
        "email": payload.email,
        "phone": phone,
        "role": "farmer",
        "status": "pending",
    }
    try:
        table(client, "profiles").insert(row).execute()
    except Exception as exc:
        # Avoid orphan auth users: best-effort cleanup, then fail loudly.
        logger.error("profiles insert failed for %s: %s", user_id, exc)
        try:
            client.auth.admin.delete_user(user_id)
        except Exception:
            pass
        if _is_duplicate_error(exc):
            raise HTTPException(
                status_code=409,
                detail="This email or phone number is already registered. "
                "Please log in instead.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail="Signup failed. Please try again.",
        ) from exc

    return RealSignupOut(
        user_id=user_id,
        message="Account created successfully. Your profile is pending verification.",
    )


@router.post("/google-link", response_model=GoogleLinkOut, tags=["auth"])
def google_link(
    payload: GoogleLinkIn, authorization: str | None = Header(None)
) -> GoogleLinkOut:
    """Ensure the Google-OAuth auth user has a web `profiles` row.

    Called ONCE by the mobile app after the real Google OAuth flow
    (supabase-js signInWithOAuth + PKCE). The JWT is validated server-side;
    the row is written with the service_role client (RLS blocks direct anon
    inserts on profiles by design). Idempotent — an existing row returns
    created=False instead of duplicating.
    """
    claims = deps.validate_supabase_jwt(_bearer_token(authorization) or "")
    auth_user_id = claims.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="Invalid login token.")

    client = get_web_client()
    existing = first_row(
        table(client, "profiles")
        .select("id,full_name,role")
        .eq("id", auth_user_id)
        .limit(1)
        .execute()
    )
    if existing is not None:
        return GoogleLinkOut(
            user_id=auth_user_id,
            role=existing.get("role") or "farmer",
            full_name=existing.get("full_name"),
            created=False,
        )

    # Normalize phone to digits-only: DB trigger requires 11-digit format
    phone = re.sub(r"\D", "", payload.phone) if payload.phone else None
    row = {
        "id": auth_user_id,  # profiles.id IS the auth user id (1:1 link)
        "full_name": payload.full_name,
        "email": claims.get("email"),
        "phone": phone,
        "role": "farmer",
        "status": "pending",
    }
    try:
        table(client, "profiles").insert(row).execute()
    except Exception as exc:
        logger.error("Google link insert failed for %s: %s", auth_user_id, exc)
        if _is_duplicate_error(exc):
            # Lost a race with another link call: the row now exists.
            return GoogleLinkOut(
                user_id=auth_user_id,
                role="farmer",
                full_name=payload.full_name,
                created=False,
            )
        raise HTTPException(
            status_code=500,
            detail="Profile link failed. Please try again.",
        ) from exc

    return GoogleLinkOut(
        user_id=auth_user_id,
        role="farmer",
        full_name=payload.full_name,
        created=True,
    )


def _linked_manager(client, auth_user_id: str) -> dict | None:
    """Return the farmer's exclusive area manager, or None.

    Link chain (all web project): profiles.id -> farmers.profile_id ->
    farmers.area_manager_id -> area_managers, joined to the manager's own
    profiles row (via area_managers.user_id) for name/phone.
    """
    farmer = first_row(
        table(client, "farmers")
        .select("id,area_manager_id")
        .eq("profile_id", auth_user_id)
        .limit(1)
        .execute()
    )
    if not farmer or not farmer.get("area_manager_id"):
        return None
    area_manager = first_row(
        table(client, "area_managers")
        .select("id,user_id,center_name,city,address")
        .eq("id", farmer["area_manager_id"])
        .limit(1)
        .execute()
    )
    if area_manager is None:
        return None
    manager_profile = (
        first_row(
            table(client, "profiles")
            .select("full_name,phone")
            .eq("id", area_manager.get("user_id"))
            .limit(1)
            .execute()
        )
        if area_manager.get("user_id")
        else None
    )
    return {
        "id": area_manager.get("id"),
        "center_name": area_manager.get("center_name"),
        "city": area_manager.get("city"),
        "address": area_manager.get("address"),
        "name": (manager_profile or {}).get("full_name"),
        "phone": (manager_profile or {}).get("phone"),
    }


@router.post("/me", response_model=MeOut, tags=["auth"])
def auth_me(authorization: str | None = Header(None)) -> MeOut:
    """Validate the caller's access token and return the session aggregate.

    Production: real JWT only (strict, no demo fallback). Used by the mobile
    app right after supabase-js login/signup/Google to confirm the profile
    link and to hydrate the session (verification state, linked manager).

    Demo: when AUTH_DEMO_ENABLED is explicitly "true" (local dev only), an
    invalid/missing token falls back to the demo farmer ctx so the app is
    testable without a real login. Impossible in production.
    """
    claims: dict | None = None
    try:
        claims = deps.validate_supabase_jwt(_bearer_token(authorization) or "")
    except HTTPException:
        claims = None
    if claims is None or not claims.get("sub"):
        if deps.demo_auth_enabled():
            logger.warning(
                "Demo auth fallback used for /me — set AUTH_DEMO_ENABLED=false in production."
            )
            profile, farmer_profile, farmer_row = deps._demo_farmer_ctx()
            client = get_web_client()
            return MeOut(
                user_id=profile.get("id") or "",
                email=profile.get("email"),
                full_name=profile.get("full_name"),
                phone=profile.get("phone"),
                role=profile.get("role") or "farmer",
                status=profile.get("status") or "pending",
                farmer_profile=farmer_profile,
                verification=VerificationOut(status="pending"),
                manager=_linked_manager(client, profile.get("id") or ""),
            )
        raise HTTPException(status_code=401, detail="Invalid login token.")
    auth_user_id = claims.get("sub")

    client = get_web_client()
    profile = first_row(
        table(client, "profiles")
        .select("id,full_name,email,phone,role,status")
        .eq("id", auth_user_id)
        .limit(1)
        .execute()
    )
    if profile is None:
        raise HTTPException(
            status_code=404,
            detail="No profile found for this account. Please sign up first.",
        )

    farmer_profile = first_row(
        table(client, "farmer_profiles")
        .select("*")
        .eq("user_id", auth_user_id)
        .limit(1)
        .execute()
    )

    verification_status = _VERIFICATION_BY_PROFILE_STATUS.get(
        (profile.get("status") or "").lower(), "pending"
    )

    return MeOut(
        user_id=auth_user_id,
        email=claims.get("email") or profile.get("email"),
        full_name=profile.get("full_name"),
        phone=profile.get("phone"),
        role=profile.get("role") or "farmer",
        status=profile.get("status") or "pending",
        farmer_profile=farmer_profile,
        verification=VerificationOut(status=verification_status),
        manager=_linked_manager(client, auth_user_id),
    )


@router.post("/change-password", tags=["auth"])
def change_password(
    payload: ChangePasswordIn, authorization: str | None = Header(None)
) -> dict:
    """Change the caller's password. STRICT: real Supabase JWT only, no demo.

    1. Validate the Bearer access token server-side (proves a live session).
    2. Re-authenticate with the CURRENT password via Supabase Auth — wrong
       password is rejected here, before anything changes.
    3. Set the new password via the Supabase Auth Admin API.
    """
    claims = deps.validate_supabase_jwt(_bearer_token(authorization) or "")
    auth_user_id = claims.get("sub")
    email = claims.get("email")
    if not auth_user_id or not email:
        raise HTTPException(status_code=401, detail="Invalid login token.")

    # Throwaway client: sign_in_with_password pins the JWT onto the instance.
    client = _fresh_web_client()
    try:
        client.auth.sign_in_with_password(
            {"email": email, "password": payload.current_password}
        )
    except Exception:
        raise HTTPException(
            status_code=401, detail="The current password is incorrect."
        ) from None
    try:
        client.auth.admin.update_user_by_id(
            auth_user_id, {"password": payload.new_password}
        )
    except Exception as exc:
        logger.error("Admin password update failed for %s: %s", auth_user_id, exc)
        raise HTTPException(
            status_code=500,
            detail="Password change failed. Please try again.",
        ) from exc
    return {"changed": True}


@router.post("/forgot-password", tags=["auth"])
def forgot_password(payload: ForgotPasswordIn) -> dict:
    """Send a Supabase password-reset email.

    Always returns success (even for unknown emails) so attackers cannot
    enumerate accounts.
    """
    try:
        get_web_client().auth.reset_password_for_email(payload.email)
    except Exception:  # noqa: BLE001 - never leak whether the email exists
        pass
    return {"sent": True}


@router.post("/demo-login", response_model=DemoAuthOut, tags=["demo-auth"])
def demo_login(payload: DemoLoginIn) -> DemoAuthOut:
    """DEMO ONLY: any credentials work except password 'wrong' (demoable error)."""
    _demo_guard()
    if not payload.identifier.strip():
        raise HTTPException(status_code=422, detail="Please enter your email or phone number.")
    if payload.password == "wrong":
        raise HTTPException(status_code=401, detail="Incorrect password. Please try again.")
    fid = _demo_farmer_id()
    return DemoAuthOut(
        token=f"demo-token-{payload.role}-{int(time.time())}",
        role=payload.role,
        is_new_user=False,
        farmer_id=fid if payload.role == "farmer" else None,
    )


@router.post("/demo-signup", response_model=DemoAuthOut, tags=["demo-auth"])
def demo_signup(payload: DemoSignupIn) -> DemoAuthOut:
    """DEMO ONLY: accepts the fields, returns a new-user session (stored nowhere)."""
    _demo_guard()
    fid = _demo_farmer_id()
    return DemoAuthOut(
        token=f"demo-token-{payload.role}-{int(time.time())}",
        role=payload.role,
        is_new_user=True,
        farmer_id=fid if payload.role == "farmer" else None,
    )
