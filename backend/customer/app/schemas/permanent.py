"""Permanent-customer subscription requests + ledger schemas."""
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class PermanentRequestIn(BaseModel):
    cycle: Literal["15", "30"]
    daily_quantity_l: float = Field(gt=0)
    start_date: date

    @field_validator("start_date")
    @classmethod
    def _not_past(cls, v: date) -> date:
        if v < date.today():
            raise ValueError("start_date cannot be in the past")
        return v


class PermanentRequestOut(BaseModel):
    id: str
    customer_id: str
    cycle: str
    status: str
    start_date: date | None = None
    end_date: date | None = None
    daily_quantity_l: float | None = None
    rejection_reason: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class LedgerEntryOut(BaseModel):
    id: str
    entry_type: str
    amount: float
    ref: str | None = None
    created_at: datetime | None = None


class LedgerOut(BaseModel):
    entries: list[LedgerEntryOut]
    balance: float
