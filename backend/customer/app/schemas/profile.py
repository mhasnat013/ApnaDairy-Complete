"""Profile schemas: read + partial update of a customer_profiles row."""
from pydantic import BaseModel, ConfigDict, Field


class ProfileOut(BaseModel):
    """Full customer_profiles row as returned by the API."""

    id: str
    auth_user_id: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    email: str | None = None
    phone: str | None = None
    role: str = "customer"
    verification_status: str = "pending"
    area_manager_id: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class ProfileUpdate(BaseModel):
    """Only these three fields may be changed via PUT /profile/.

    Any other field (email, role, verification_status, auth_user_id, ...)
    is rejected with a 422, so protected fields can never be mutated here.
    """

    model_config = ConfigDict(extra="forbid")

    first_name: str | None = Field(default=None, min_length=1)
    last_name: str | None = Field(default=None, min_length=1)
    phone: str | None = Field(default=None, min_length=3)
