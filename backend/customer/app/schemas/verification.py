"""Verification schemas: KYC submission, status, document upload."""
from typing import Literal

from pydantic import BaseModel, Field


class VerificationSubmitIn(BaseModel):
    """Payload for POST /verification/submit. Stored into the documents JSONB."""

    full_name: str = Field(min_length=1)
    phone: str = Field(min_length=3)
    address: str = Field(min_length=1)
    cnic_front_path: str | None = None
    cnic_back_path: str | None = None
    notes: str | None = None


class VerificationStatusOut(BaseModel):
    """Latest verification state; defaults to 'pending' before any submission."""

    status: str = "pending"
    rejection_reason: str | None = None
    submitted_at: str | None = None


DocType = Literal["cnic_front", "cnic_back", "profile_photo"]


class DocumentUploadOut(BaseModel):
    path: str
    doc_type: DocType
