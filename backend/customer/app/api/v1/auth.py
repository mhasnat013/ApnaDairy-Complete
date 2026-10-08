"""/auth — signup, identity lookup, and phone OTP.

Google OAuth: the mobile app signs in with
supabase-js signInWithOAuth({provider: "google"}) using the app's custom
URL scheme as the redirect; Supabase returns a session, and the app sends
the access_token as `Authorization: Bearer <token>` to /auth/me and all
protected endpoints. The backend validates every token server-side via
app.core.security.validate_supabase_jwt. Both Google Cloud and the
Supabase dashboard OAuth callback URLs must include the app scheme
(no localhost — it does not work on physical devices).
"""
from fastapi import APIRouter, HTTPException, Request

from app.schemas.auth import (
    ForgotPasswordIn,
    LinkProfileIn,
    LinkProfileOut,
    LoginIn,
    LoginOut,
    MeOut,
    OtpSendIn,
    OtpVerifyIn,
    OtpVerifyOut,
    ResendVerificationIn,
    SignupIn,
    VerifyEmailIn,
    VerifyEmailOut,
)
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup")
def signup(payload: SignupIn):
    """Create an auth user via the REAL Supabase email-OTP flow.

    EMAIL_VERIFICATION_REQUIRED=true (default): the user is created
    UNCONFIRMED, Supabase sends the 6-digit confirmation email, and the
    response is {"user_id", "email", "verification_required": true} — no
    session tokens until POST /auth/verify-email succeeds.
    """
    return auth_service.signup(payload.model_dump())


@router.post("/verify-email", response_model=VerifyEmailOut)
def verify_email(payload: VerifyEmailIn):
    """Verify the signup email OTP; creates the profile row idempotently
    and returns the first session tokens."""
    return auth_service.verify_email(payload.email, payload.token)


@router.post("/resend-verification")
def resend_verification(payload: ResendVerificationIn):
    """Re-send the signup confirmation email. Always 200 (no enumeration)."""
    return auth_service.resend_verification(payload.email)


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn):
    """Email+password login. Returns Supabase session tokens."""
    return auth_service.login(payload.email, payload.password)


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordIn):
    """Send a password-reset email. Always 200 (no account enumeration)."""
    return auth_service.forgot_password(payload.email)


@router.post("/logout")
def logout():
    """Client discards its tokens; server keeps no session state (stateless JWT)."""
    return {"logged_out": True}


@router.post("/link-profile", response_model=LinkProfileOut)
def link_profile(request: Request, payload: LinkProfileIn):
    """Link a Google-OAuth auth user to a customer_profiles row.

    Called ONCE by the mobile app from the Continue-as screen after the
    real Google OAuth flow. The JWT is validated server-side (email comes
    from the token, never the client); the row is written with the
    service_role client. Idempotent — an existing row returns created=False.
    """
    claims = auth_service.resolve_claims(request.headers.get("Authorization"))
    auth_user_id = claims.get("sub")
    if not auth_user_id:
        raise HTTPException(status_code=401, detail="Invalid login token.")
    email = claims.get("email")
    result = auth_service.link_google_profile(
        auth_user_id=auth_user_id,
        email=email,
        first_name=payload.first_name,
        last_name=payload.last_name,
        phone=payload.phone,
    )
    profile = result["profile"]
    return LinkProfileOut(
        user_id=auth_user_id,
        role=profile.get("role") or "customer",
        verification_status=profile.get("verification_status") or "pending",
        created=result["created"],
    )


@router.post("/me", response_model=MeOut)
def me(request: Request):
    """Return the caller's full profile from the Authorization bearer token."""
    claims = auth_service.resolve_claims(request.headers.get("Authorization"))
    row = auth_service.profile_by_auth_user_id(claims["sub"])
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return auth_service.profile_dict_to_me(row)


@router.post("/otp/send")
def otp_send(payload: OtpSendIn):
    """Send an SMS OTP to the given phone number."""
    return auth_service.send_phone_otp(payload.phone)


@router.post("/otp/verify", response_model=OtpVerifyOut)
def otp_verify(payload: OtpVerifyIn):
    """Verify an SMS OTP; creates a minimal profile row if missing."""
    return auth_service.verify_phone_otp(payload.phone, payload.token)
