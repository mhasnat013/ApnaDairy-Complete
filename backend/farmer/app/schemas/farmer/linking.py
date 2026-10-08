# ApnaDairy — v2 manager-linking schemas (Pydantic v2).
# Farmer side: pick a city, browse area managers, request exactly one.
# Manager side: review pending requests, accept / decline / end the linkage.
# All user-facing text is English-only.

from pydantic import BaseModel, ConfigDict, Field


class CityOut(BaseModel):
    """One city in the farmer's city picker, with manager availability."""

    city: str
    manager_count: int


class CityManagerOut(BaseModel):
    """One area manager listed for a city (farmer browse step)."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    center_name: str
    address: str | None = None
    city: str | None = None
    manager_name: str
    phone: str


class ManagerRequestCreate(BaseModel):
    """Farmer's registration request to one area manager."""

    area_manager_id: str = Field(min_length=1)
    note: str | None = Field(default=None, max_length=300)


class LinkedManagerOut(BaseModel):
    """The manager attached to a registration request."""

    id: str
    center_name: str
    city: str | None = None


class ManagerRequestOut(BaseModel):
    """The farmer's registration request with its manager and status."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    note: str | None = None
    reason: str | None = None
    created_at: str | None = None
    answered_at: str | None = None
    ended_at: str | None = None
    manager: LinkedManagerOut | None = None


class DeclineRequestIn(BaseModel):
    """Optional reason when a manager declines a registration request."""

    reason: str | None = Field(default=None, max_length=300)


class RequestFarmerOut(BaseModel):
    """Farmer details shown to the manager on a pending request."""

    id: str  # profiles.id (farmer_requests.farmer_id)
    full_name: str
    phone: str
    city: str | None = None
    cattle_count: int | None = None
    daily_litres: float | None = None


class PendingRequestOut(BaseModel):
    """One pending registration request for the manager's center."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    note: str | None = None
    created_at: str | None = None
    farmer: RequestFarmerOut


class LinkActionOut(BaseModel):
    """Result of accept / decline / end on a registration request."""

    id: str
    status: str
    farmer_id: str
    area_manager_id: str | None = None
    farmer_row_linked: bool = False
