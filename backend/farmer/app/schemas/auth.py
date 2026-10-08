# ApnaDairy — Auth request/response schemas (Pydantic v2), farmer portal v2.
#
# REAL auth (Supabase Auth on the WEB project + server-side JWT validation):
#   signup -> POST /api/v1/auth/signup {full_name, email, phone, password}
#             (creates the Supabase Auth user via the Admin API AND the web
#             `profiles` row {id: auth user id, role: 'farmer',
#             status: 'pending'}; duplicate email/phone -> 409)
#   login  -> supabase-js signInWithPassword DIRECTLY against the WEB project
#             (the backend holds no anon key on purpose — passwords never
#             touch our server at login), then POST /api/v1/auth/me with the
#             access token
#   google -> supabase-js signInWithOAuth, then POST /api/v1/auth/google-link
#             once to ensure the web `profiles` row exists
# Every later call sends Authorization: Bearer <access_token>; the backend
# validates the JWT on each request (app/core/security.py) and maps
# token sub -> profiles.id.
#
# DEMO BRIDGE ONLY (below): lets the app run end-to-end during development.
# Gated behind AUTH_DEMO_ENABLED (explicit "true" only; default "false").

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DemoLoginIn(BaseModel):
    """Demo login credentials (any non-empty values work, except password 'wrong')."""

    identifier: str = Field(min_length=1)
    password: str = Field(min_length=1)
    role: str = Field(pattern="^(farmer|customer)$")


class DemoSignupIn(BaseModel):
    """Demo signup fields (all required, stored nowhere — demo only)."""

    name: str = Field(min_length=1)
    email: str = Field(min_length=1)
    phone: str = Field(min_length=1)
    password: str = Field(min_length=1)
    role: str = Field(pattern="^(farmer|customer)$")


class DemoAuthOut(BaseModel):
    """Demo session payload."""

    model_config = ConfigDict(from_attributes=True)

    token: str
    role: str
    is_new_user: bool
    farmer_id: str | None = None


# ---------------------------------------------------------------------------
# REAL auth (Supabase Auth on the WEB project + server-side JWT validation)
# ---------------------------------------------------------------------------


class RealSignupIn(BaseModel):
    """Real signup fields: creates the auth user + the web profiles row."""

    full_name: str = Field(min_length=1)
    email: str = Field(min_length=3, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str = Field(min_length=1)
    password: str = Field(min_length=6)


class RealSignupOut(BaseModel):
    """What signup returns — the mobile app then signs in via supabase-js."""

    user_id: str
    message: str


class VerificationOut(BaseModel):
    """Farmer verification tri-state shown in /me."""

    status: Literal["pending", "verified", "rejected"]


class MeOut(BaseModel):
    """Validated session aggregate for the caller's access token."""

    user_id: str
    email: str | None = None
    full_name: str | None = None
    phone: str | None = None
    role: str
    status: str
    farmer_profile: dict | None = None
    verification: VerificationOut
    manager: dict | None = None


class ChangePasswordIn(BaseModel):
    """Change-password payload: current password is re-verified server-side."""

    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=8)


class ForgotPasswordIn(BaseModel):
    """Forgot-password payload: reset email is sent via Supabase Auth."""

    email: str = Field(min_length=3)


class GoogleLinkIn(BaseModel):
    """Ensure a Google-OAuth auth user has a web `profiles` row.

    The mobile app calls this ONCE after signInWithOAuth. Idempotent: an
    existing row returns created=False.
    """

    full_name: str = Field(min_length=2)
    phone: str | None = None


class GoogleLinkOut(BaseModel):
    """Result of linking a Google user — mirrors the web profiles row."""

    user_id: str
    role: str
    full_name: str | None = None
    created: bool
