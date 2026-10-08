"""Auth schemas (pydantic v2).

Google OAuth: the mobile app signs in with supabase-js signInWithOAuth
({provider: "google"}) using the app's custom URL scheme as the redirect;
Supabase returns a session, and the app sends the access_token as
`Authorization: Bearer <token>` to /auth/me and all protected endpoints.
POST /auth/link-profile creates the customer_profiles row for a Google
user once (from the Continue-as screen). The backend validates every token
server-side via app.core.security.validate_supabase_jwt. Both Google Cloud
and the Supabase dashboard OAuth callback URLs must include the app scheme
(no localhost — it does not work on physical devices).
"""
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator


class SignupIn(BaseModel):
    """POST /auth/signup body."""

    email: str = Field(..., min_length=3, max_length=254)
    password: str = Field(..., min_length=8, max_length=128)
    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=7, max_length=20)
    role: Literal["customer", "farmer"] = "customer"

    @field_validator("email")
    @classmethod
    def _email_looks_plausible(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Invalid email address.")
        return value


class MeOut(BaseModel):
    """POST /auth/me response — full customer_profiles row."""

    user_id: str
    customer_id: str
    email: str
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    role: str
    verification_status: str
    area_manager_id: str | None = None


class OtpSendIn(BaseModel):
    """POST /auth/otp/send body."""

    phone: str = Field(..., min_length=7, max_length=20)


class OtpVerifyIn(BaseModel):
    """POST /auth/otp/verify body."""

    phone: str = Field(..., min_length=7, max_length=20)
    token: str = Field(..., min_length=4, max_length=20)


class OtpVerifyOut(BaseModel):
    """POST /auth/otp/verify response."""

    user_id: str
    verified: bool = True


class LoginIn(BaseModel):
    """POST /auth/login request."""

    email: EmailStr
    password: str = Field(min_length=1)


class LoginOut(BaseModel):
    """POST /auth/login response (Supabase session tokens)."""

    access_token: str
    refresh_token: str
    user_id: str
    email: str


class VerifyEmailIn(BaseModel):
    """POST /auth/verify-email body — 6-digit email OTP from signup."""

    email: EmailStr
    token: str = Field(..., min_length=4, max_length=20)


class VerifyEmailOut(BaseModel):
    """POST /auth/verify-email response.

    When GoTrue returns a session, tokens are included. When it does not
    (verified=True, login_required=True) the client must call /auth/login.
    """

    access_token: str | None = None
    refresh_token: str | None = None
    user_id: str
    email: str
    verified: bool = True
    login_required: bool = False


class ResendVerificationIn(BaseModel):
    """POST /auth/resend-verification body."""

    email: EmailStr


class ForgotPasswordIn(BaseModel):
    """POST /auth/forgot-password request."""

    email: EmailStr


class LinkProfileIn(BaseModel):
    """POST /auth/link-profile body — link a Google-OAuth auth user.

    The mobile app calls this ONCE from the Continue-as screen after the
    real Google OAuth flow. Idempotent: an existing row returns
    created=False. Email comes from the validated JWT, not the client.
    """

    first_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(default="", max_length=20)


class LinkProfileOut(BaseModel):
    """POST /auth/link-profile response."""

    user_id: str
    role: str
    verification_status: str
    created: bool
