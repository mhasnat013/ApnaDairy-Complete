"""Pydantic schemas for the /notifications endpoints."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

NotificationKind = Literal[
    "order", "payment", "complaint", "delivery",
    "verification", "subscription", "general",
]


class NotificationOut(BaseModel):
    id: str
    customer_id: str
    title: str
    body: str | None = None
    kind: NotificationKind
    is_read: bool = False
    created_at: datetime | None = None


class NotificationListOut(BaseModel):
    items: list[NotificationOut]
    unread_count: int = Field(ge=0)
    page: int = Field(ge=1)
    page_size: int = Field(ge=1)


class ReadAllOut(BaseModel):
    marked: int = Field(ge=0)


class DeleteOut(BaseModel):
    deleted: bool = True
