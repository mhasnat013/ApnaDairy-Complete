"""Complaint lifecycle: create / list / detail / customer messages.

Reads and writes the MOBILE project only (customer_complaints, plus
customer_orders for the order-ownership check).
The WEB project is never touched here.

Real table customer_complaints (mobile project, EXISTS):
    id, customer_id, order_id, category, subject, description,
    photo_path, status, messages JSON, created_at, updated_at.
messages is a JSON array of {"from", "text", "at"}.
Status values: open, in_review, resolved, rejected.
"""

import uuid
from datetime import datetime, timezone

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client

TABLE = "customer_complaints"
ORDERS_TABLE = "customer_orders"
ATTACHMENT_BUCKET = "complaint-attachments"

CATEGORIES = ("quality", "rider", "order", "payment")  # must match DB enum customer_complaint_category
STATUSES = ("open", "in_review", "resolved", "rejected")


def _rows(res) -> list[dict]:
    return list(res.data or [])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _bucket_missing(exc: Exception) -> bool:
    """True when a storage error means the bucket does not exist."""
    msg = str(exc).lower()
    return "bucket" in msg and ("not found" in msg or "404" in msg)


def _own_order(client, customer_id: str, order_id: str) -> dict | None:
    """Fetch an order only if it belongs to the customer, else None."""
    res = (
        client.table(ORDERS_TABLE)
        .select("id")
        .eq("id", order_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    rows = _rows(res)
    return rows[0] if rows else None


def upload_attachment(
    client,
    customer_id: str,
    complaint_id: str,
    contents: bytes,
    content_type: str | None,
) -> str:
    """Upload a complaint photo to the private complaint-attachments bucket.

    Returns the storage path {customer_id}/{complaint_id}.jpg.
    """
    path = f"{customer_id}/{complaint_id}.jpg"
    try:
        client.storage.from_(ATTACHMENT_BUCKET).upload(
            path,
            contents,
            file_options={"content-type": content_type or "image/jpeg"},
        )
    except HTTPException:
        raise
    except Exception as exc:
        if _bucket_missing(exc):
            raise HTTPException(
                status_code=503,
                detail="Attachment storage not configured yet.",
            )
        raise HTTPException(status_code=502, detail="Attachment upload failed.")
    return path


def create_complaint(
    *,
    customer_id: str,
    order_id: str | None,
    category: str,
    subject: str,
    description: str,
    photo_bytes: bytes | None = None,
    photo_content_type: str | None = None,
    complaint_id: str | None = None,
) -> dict:
    """Create an open complaint row, optionally with a photo attachment.

    404 when an order_id is given that is not the customer's own order.
    """
    client = get_mobile_client()

    if order_id:
        if _own_order(client, customer_id, order_id) is None:
            raise HTTPException(status_code=404, detail="Order not found.")

    cid = complaint_id or str(uuid.uuid4())
    photo_path = None
    if photo_bytes is not None:
        photo_path = upload_attachment(
            client, customer_id, cid, photo_bytes, photo_content_type
        )

    res = (
        client.table(TABLE)
        .insert(
            {
                "id": cid,
                "customer_id": customer_id,
                "order_id": order_id,
                "category": category,
                "subject": subject,
                "description": description,
                "photo_path": photo_path,
                "status": "open",
                "messages": [],
                "created_at": _now_iso(),
            }
        )
        .execute()
    )
    rows = _rows(res)
    if not rows:
        raise HTTPException(
            status_code=502, detail="Could not create complaint."
        )
    return rows[0]


def list_complaints(customer_id: str, status: str | None = None) -> list[dict]:
    """The customer's own complaints, newest first, optional status filter."""
    client = get_mobile_client()
    q = client.table(TABLE).select("*").eq("customer_id", customer_id)
    if status is not None:
        q = q.eq("status", status)
    return _rows(q.order("created_at", desc=True).execute())


def get_complaint(customer_id: str, complaint_id: str) -> dict:
    """One complaint with its messages. 404 when it is not the caller's own."""
    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .select("*")
        .eq("id", complaint_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    rows = _rows(res)
    if not rows:
        raise HTTPException(status_code=404, detail="Complaint not found.")
    row = rows[0]
    row.setdefault("messages", [])
    return row


def add_message(customer_id: str, complaint_id: str, text: str) -> list[dict]:
    """Append a customer message to a complaint. 404 when it is not the
    caller's own. Returns the full message thread."""
    row = get_complaint(customer_id, complaint_id)
    messages = list(row.get("messages") or [])
    messages.append({"from": "customer", "text": text, "at": _now_iso()})

    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .update({"messages": messages, "updated_at": _now_iso()})
        .eq("id", complaint_id)
        .eq("customer_id", customer_id)
        .execute()
    )
    if not _rows(res):
        raise HTTPException(status_code=404, detail="Complaint not found.")
    return messages
