"""Verification submissions + document uploads (MOBILE project).

Status machine: pending -> submitted -> approved | rejected. SuperAdmin review
happens outside this API; here we only create submissions, report status, and
store KYC documents in private storage.
"""
import os
import uuid

from app.db.supabase_client import get_mobile_client

_TABLE = "customer_verifications"
_BUCKET = "customer-documents"


def _table():
    return get_mobile_client().table(_TABLE)


def latest_submission(customer_id: str) -> dict | None:
    """Most recent verification row for the customer, or None."""
    res = (
        _table()
        .select("*")
        .eq("customer_id", customer_id)
        .order("submitted_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def has_active_submission(customer_id: str) -> bool:
    """True when a 'submitted' row is still awaiting review."""
    res = (
        _table()
        .select("id")
        .eq("customer_id", customer_id)
        .eq("status", "submitted")
        .limit(1)
        .execute()
    )
    return bool(res.data)


def create_submission(customer_id: str, documents: dict) -> dict:
    """Insert a new 'submitted' row and flip the profile's verification_status."""
    res = (
        _table()
        .insert(
            {
                "customer_id": customer_id,
                "status": "submitted",
                "documents": documents,
            }
        )
        .execute()
    )
    rows = res.data or []
    created = rows[0] if rows else {}

    # Keep the profile's denormalised status in sync.
    get_mobile_client().table("customer_profiles").update(
        {"verification_status": "submitted"}
    ).eq("id", customer_id).execute()
    return created


def store_document(
    customer_id: str, file_bytes: bytes, filename: str, doc_type: str
) -> str:
    """Upload KYC bytes to the private bucket; returns the storage path."""
    ext = os.path.splitext(filename or "")[1].lstrip(".").lower() or "bin"
    path = f"{customer_id}/{doc_type}_{uuid.uuid4().hex}.{ext}"
    get_mobile_client().storage.from_(_BUCKET).upload(
        path,
        file_bytes,
        {"content-type": "application/octet-stream"},
    )
    return path
