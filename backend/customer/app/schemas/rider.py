"""Rider/delivery tracking schemas: RiderInfo, DeliveryOut, MessageIn, RateIn."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class RiderInfo(BaseModel):
    """Public rider card. Every field is nullable; when the rider is not
    assigned yet the router returns rider=None instead of fabricating one."""

    name: Optional[str] = None
    phone: Optional[str] = None
    rating: Optional[float] = None
    photo_path: Optional[str] = None
    vehicle_label: Optional[str] = None
    vehicle_plate: Optional[str] = None


class MessageIn(BaseModel):
    text: str = Field(..., min_length=1)


class RateIn(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    comment: Optional[str] = None


class DeliveryOut(BaseModel):
    delivery_id: str
    order_id: str
    status: Optional[str] = None
    rider: Optional[RiderInfo] = None
    message: Optional[str] = None  # e.g. "Rider not assigned yet." when rider is None
    live: dict[str, Optional[float]] = {"latitude": None, "longitude": None}
    messages: list[dict[str, Any]] = Field(default_factory=list)
    events: list[dict[str, Any]] = Field(default_factory=list)  # timeline
