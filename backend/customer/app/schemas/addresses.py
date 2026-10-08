"""Pydantic v2 schemas for customer_addresses (mobile project)."""
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class AddressIn(BaseModel):
    """Create payload for a new address."""

    model_config = ConfigDict(extra="forbid")

    label: str = Field(min_length=1)
    recipient_name: str = Field(min_length=1)
    phone: str = Field(pattern=r"^[+()\-.\s\d]{7,20}$")
    address_line: str = Field(min_length=1)
    city: str = Field(min_length=1)
    latitude: float | None = None
    longitude: float | None = None
    is_default: bool | None = None


class AddressUpdate(BaseModel):
    """Partial update payload — every field optional."""

    model_config = ConfigDict(extra="forbid")

    label: str | None = Field(default=None, min_length=1)
    recipient_name: str | None = Field(default=None, min_length=1)
    phone: str | None = Field(default=None, pattern=r"^[+()\-.\s\d]{7,20}$")
    address_line: str | None = Field(default=None, min_length=1)
    city: str | None = Field(default=None, min_length=1)
    latitude: float | None = None
    longitude: float | None = None


class AddressOut(BaseModel):
    """Full customer_addresses row as returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    customer_id: str
    label: str
    recipient_name: str
    phone: str
    address_line: str
    city: str
    latitude: float | None
    longitude: float | None
    is_default: bool
    created_at: datetime
    updated_at: datetime
