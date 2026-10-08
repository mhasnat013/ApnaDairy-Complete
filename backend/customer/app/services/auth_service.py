"""Signup / OTP flows against Supabase Auth (MOBILE project only).

- Email+password signup uses the REAL Supabase email-OTP flow by default
  (EMAIL_VERIFICATION_REQUIRED=true): the user is created unconfirmed,
  Supabase sends the 6-digit confirmation email, and POST /auth/verify-email
  completes verification and creates the customer_profiles row. No session
  tokens are issued before verification.
- Phone OTP uses GoTrue's sign_in_with_otp / verify_otp (type "sms").
- The WEB Supabase project is never touched here (auth lives in mobile).

Auth API errors from GoTrue are surfaced as HTTP 422 with a generic detail;
never leak provider internals.
"""
import os

from fastapi import HTTPException

from app.core.security import validate_supabase_jwt
from app.db.supabase_client import get_mobile_anon_client, get_mobile_client

_PROFILES_TABLE = "customer_profiles"
_VERIFICATION_PENDING = "pending"


def _profiles():
    return get_mobile_client().table(_PROFILES_TABLE)


def _unauthorized(detail: str = "Invalid login token.") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def resolve_claims(authorization: str | None) -> dict:
    """Parse 'Authorization: Bearer <token>' and validate the JWT.

    Returns the token claims (always contains "sub"). Raises HTTPException(401)
    when the header is missing/malformed or the token is invalid/expired.
    """
    if not authorization or not authorization.strip():
        raise _unauthorized("Login required (no Authorization header).")
    scheme, _, token = authorization.strip().partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _unauthorized("Invalid Authorization header (expected Bearer).")
    return validate_supabase_jwt(token.strip())


def _email_verification_required() -> bool:
    """True unless EMAIL_VERIFICATION_REQUIRED is explicitly "false".

    When True (production default) signup sends a real Supabase email OTP
    and no session tokens are issued until /auth/verify-email succeeds.
    When False (local dev without SMTP) the old pre-confirm behaviour
    is used so Hasnat can keep testing offline.
    """
    return os.environ.get("EMAIL_VERIFICATION_REQUIRED", "true").strip().lower() != "false"


def signup(data: dict) -> dict:
    """Create the Auth user.

    EMAIL_VERIFICATION_REQUIRED=true (default): creates the user with
    Supabase Auth's real email-OTP flow (NOT pre-confirmed). Supabase sends
    the 6-digit confirmation email; the caller must complete
    POST /auth/verify-email before any session tokens are issued. No
    customer_profiles row is created yet (verify-email creates it).

    =false: legacy path — admin.create_user with email_confirm=True and the
    profile row created immediately (local dev without SMTP).
    """
    email = data["email"]
    if not _email_verification_required():
        return _signup_preconfirmed(data)

    try:
        res = get_mobile_anon_client().auth.sign_up(
            {
                "email": email,
                "password": data["password"],
                "options": {
                    "data": {
                        "first_name": data["first_name"],
                        "last_name": data["last_name"],
                        "phone": data["phone"],
                        "role": data.get("role", "customer"),
                    }
                },
            }
        )
    except Exception as exc:
        message = str(exc).lower()
        if any(
            token in message
            for token in ("already registered", "already exists", "duplicate")
        ):
            raise HTTPException(
                status_code=422, detail="Email already registered."
            ) from exc
        raise HTTPException(
            status_code=422, detail="Signup failed — please try again."
        ) from exc

    user = getattr(res, "user", None)
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(
            status_code=422, detail="Signup failed — please try again."
        )
    # GoTrue returns a user with EMPTY identities when the email is already
    # registered (no error raised) — treat that as a duplicate.
    identities = getattr(user, "identities", None)
    if isinstance(identities, list) and not identities:
        raise HTTPException(status_code=422, detail="Email already registered.")

    return {
        "user_id": str(user_id),
        "email": email,
        "verification_required": True,
    }


def _signup_preconfirmed(data: dict) -> dict:
    """Legacy signup path (EMAIL_VERIFICATION_REQUIRED=false): pre-confirmed
    user + immediate customer_profiles row. Local dev only."""
    email = data["email"]
    try:
        res = get_mobile_client().auth.admin.create_user(
            {
                "email": email,
                "password": data["password"],
                "email_confirm": True,
                "user_metadata": {
                    "first_name": data["first_name"],
                    "last_name": data["last_name"],
                    "phone": data["phone"],
                    "role": data.get("role", "customer"),
                },
            }
        )
    except Exception as exc:
        message = str(exc).lower()
        if any(
            token in message
            for token in ("already registered", "already exists", "duplicate")
        ):
            raise HTTPException(
                status_code=422, detail="Email already registered."
            ) from exc
        raise HTTPException(
            status_code=422, detail="Signup failed — please try again."
        ) from exc

    user = getattr(res, "user", None)
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(
            status_code=422, detail="Signup failed — please try again."
        )

    role = data.get("role", "customer")
    try:
        # id = auth user UUID: customer_id is auth.users.id everywhere
        # (old tables FK to auth.users; seed data uses auth IDs).
        _profiles().insert(
            {
                "id": user_id,
                "auth_user_id": user_id,
                "first_name": data["first_name"],
                "last_name": data["last_name"],
                "email": email,
                "phone": data["phone"],
                "role": role,
                "verification_status": _VERIFICATION_PENDING,
            }
        ).execute()
    except Exception as exc:
        # Auth user exists but the profile row failed — surface it; the row
        # can be re-created via /auth/me or OTP verify. Deleting the auth
        # user here would hide the real error from the caller.
        raise HTTPException(
            status_code=500, detail="Account created but profile save failed."
        ) from exc

    return {
        "user_id": user_id,
        "email": email,
        "role": role,
        "verification_status": _VERIFICATION_PENDING,
    }


def verify_email(email: str, token: str) -> dict:
    """Verify the 6-digit email OTP sent at signup.

    On success the customer_profiles row is created IDEMPOTENTLY
    (id = auth user UUID) and the Supabase session tokens are returned —
    this is the first moment the account can act. Wrong/expired code ->
    422 with a readable message.
    """
    try:
        res = get_mobile_anon_client().auth.verify_otp(
            {"email": email, "token": token, "type": "email"}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="The code is incorrect or has expired. Please request a new code.",
        ) from exc

    user = getattr(res, "user", None)
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(
            status_code=422,
            detail="The code is incorrect or has expired. Please request a new code.",
        )
    user_id = str(user_id)

    meta = getattr(user, "user_metadata", None) or {}
    if not isinstance(meta, dict):
        meta = {}

    # Idempotent profile creation: a retry / double-submit must not fail.
    if profile_by_auth_user_id(user_id) is None:
        try:
            _profiles().insert(
                {
                    "id": user_id,
                    "auth_user_id": user_id,
                    "first_name": meta.get("first_name"),
                    "last_name": meta.get("last_name"),
                    "email": email,
                    "phone": meta.get("phone"),
                    "role": meta.get("role", "customer"),
                    "verification_status": _VERIFICATION_PENDING,
                }
            ).execute()
        except Exception as exc:
            raise HTTPException(
                status_code=500, detail="Email verified but profile save failed."
            ) from exc

    session = getattr(res, "session", None)
    access = getattr(session, "access_token", None) if session else None
    refresh = getattr(session, "refresh_token", None) if session else None
    if not access:
        # Verified, but GoTrue did not return a session — client logs in.
        return {
            "user_id": user_id,
            "email": email,
            "verified": True,
            "login_required": True,
        }
    return {
        "access_token": access,
        "refresh_token": refresh,
        "user_id": user_id,
        "email": email,
    }


def resend_verification(email: str) -> dict:
    """Re-send the signup confirmation email.

    Always returns 200 (never reveals whether the email is registered).
    """
    try:
        get_mobile_anon_client().auth.resend({"type": "signup", "email": email})
    except Exception:
        pass  # noqa: BLE001 - no account enumeration, stay silent
    return {"sent": True}


def profile_by_auth_user_id(auth_user_id: str) -> dict | None:
    """customer_profiles row for the auth user, or None."""
    res = (
        _profiles()
        .select("*")
        .eq("auth_user_id", auth_user_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def profile_dict_to_me(row: dict) -> dict:
    """Shape a customer_profiles row as the /auth/me response."""
    return {
        "user_id": row.get("auth_user_id"),
        "customer_id": row.get("id"),
        "email": row.get("email"),
        "first_name": row.get("first_name"),
        "last_name": row.get("last_name"),
        "phone": row.get("phone"),
        "role": row.get("role"),
        "verification_status": row.get("verification_status"),
        "area_manager_id": row.get("area_manager_id"),
    }


def send_phone_otp(phone: str) -> dict:
    """Send an SMS OTP to the phone number."""
    try:
        get_mobile_anon_client().auth.sign_in_with_otp({"phone": phone})
    except Exception as exc:
        raise HTTPException(
            status_code=422,
            detail="Could not send OTP to this phone number.",
        ) from exc
    return {"sent": True}


def verify_phone_otp(phone: str, token: str) -> dict:
    """Verify the SMS OTP; ensure a customer_profiles row exists.

    OTP-only users have no email profile yet, so a minimal profile row is
    created (role customer, verification pending) when none exists.
    """
    try:
        res = get_mobile_anon_client().auth.verify_otp(
            {"phone": phone, "token": token, "type": "sms"}
        )
    except Exception as exc:
        raise HTTPException(
            status_code=422, detail="Invalid or expired OTP."
        ) from exc

    user = getattr(res, "user", None)
    user_id = getattr(user, "id", None) if user else None
    if not user_id:
        raise HTTPException(
            status_code=422, detail="Invalid or expired OTP."
        )

    if profile_by_auth_user_id(user_id) is None:
        _profiles().insert(
            {
                "id": user_id,
                "auth_user_id": user_id,
                "phone": phone,
                "email": getattr(user, "email", None),
                "role": "customer",
                "verification_status": _VERIFICATION_PENDING,
            }
        ).execute()

    return {"user_id": user_id, "verified": True}


def login(email: str, password: str) -> dict:
    """Email+password login via Supabase Auth. Returns session tokens.

    Wrong credentials -> 401. The mobile app stores the tokens and sends
    access_token as `Authorization: Bearer <token>` on every request.
    """
    try:
        res = get_mobile_anon_client().auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception as exc:  # noqa: BLE001
        message = str(exc).lower()
        if "not confirmed" in message or "email not confirmed" in message:
            # Account exists but the email OTP was never verified — the app
            # routes the user to the verify-email screen instead of failing.
            raise HTTPException(
                status_code=403,
                detail="Your email is not verified yet. Enter the code sent to your inbox.",
            ) from exc
        raise HTTPException(
            status_code=401, detail="Invalid email or password."
        ) from exc
    session = getattr(res, "session", None)
    user = getattr(res, "user", None)
    if not session or not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")
    return {
        "access_token": session.access_token,
        "refresh_token": session.refresh_token,
        "user_id": str(user.id),
        "email": user.email,
    }


def forgot_password(email: str) -> dict:
    """Send a password-reset email via Supabase Auth.

    Always returns success (even for unknown emails) so attackers cannot
    enumerate accounts.
    """
    try:
        get_mobile_anon_client().auth.reset_password_for_email(email)
    except Exception:  # noqa: BLE001 - never leak whether the email exists
        pass
    return {"sent": True}


def link_google_profile(
    auth_user_id: str,
    email: str | None,
    first_name: str,
    last_name: str,
    phone: str,
) -> dict:
    """Create the customer_profiles row for a Google-OAuth auth user.

    Idempotent: returns {"created": False, "profile": <existing row>} when
    the row already exists. id = auth user UUID everywhere (customer_id is
    auth.users.id; old tables FK to auth.users).
    """
    existing = profile_by_auth_user_id(auth_user_id)
    if existing is not None:
        return {"created": False, "profile": existing}
    row = {
        "id": auth_user_id,
        "auth_user_id": auth_user_id,
        "first_name": first_name,
        "last_name": last_name,
        "email": email,
        "phone": phone,
        "role": "customer",
        "verification_status": _VERIFICATION_PENDING,
    }
    try:
        _profiles().insert(row).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail="Customer profile link failed. Please try again."
        ) from exc
    profile = profile_by_auth_user_id(auth_user_id)
    if profile is None:
        raise HTTPException(
            status_code=500, detail="Customer profile link failed. Please try again."
        )
    return {"created": True, "profile": profile}
