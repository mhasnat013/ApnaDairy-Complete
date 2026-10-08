"""Notification service: read/write on mobile.customer_notifications.

Table (mobile project, EXISTS): customer_notifications
    id, customer_id, title, body, kind, is_read, created_at
kind values: order, payment, complaint, delivery, verification,
             subscription, general.

The WEB project is never touched here (read-only lane).

`create_notification` is the reusable fan-out helper used by other
modules (orders, payments, complaints, ...). Keep its signature stable.
"""

from datetime import datetime, timezone

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client

TABLE = "customer_notifications"

KINDS = {
    "order",
    "payment",
    "complaint",
    "delivery",
    "verification",
    "subscription",
    "general",
}


def _rows(res) -> list[dict]:
    return list(res.data or [])


def list_notifications(
    customer_id: str,
    unread_only: bool = False,
    page: int = 1,
    page_size: int = 20,
) -> dict:
    """Own notifications, unread first then newest, plus total unread count."""
    page = max(int(page or 1), 1)
    page_size = min(max(int(page_size or 20), 1), 100)

    client = get_mobile_client()
    q = client.table(TABLE).select("*").eq("customer_id", customer_id)
    if unread_only:
        q = q.eq("is_read", False)
    q = q.order("is_read", desc=False).order("created_at", desc=True)
    start, stop = (page - 1) * page_size, page * page_size - 1
    items = _rows(q.range(start, stop).execute())

    unread = _rows(
        client.table(TABLE)
        .select("id")
        .eq("customer_id", customer_id)
        .eq("is_read", False)
        .execute()
    )
    return {
        "items": items,
        "unread_count": len(unread),
        "page": page,
        "page_size": page_size,
    }


def mark_read(customer_id: str, notification_id: str) -> dict:
    """Mark one notification read. 404 if it is not the customer's own."""
    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .update({"is_read": True})
        .eq("id", notification_id)
        .eq("customer_id", customer_id)
        .execute()
    )
    rows = _rows(res)
    if not rows:
        raise HTTPException(status_code=404, detail="Notification not found.")
    return rows[0]


def mark_all_read(customer_id: str) -> dict:
    """Mark every own unread notification as read; return how many."""
    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .update({"is_read": True})
        .eq("customer_id", customer_id)
        .eq("is_read", False)
        .execute()
    )
    return {"marked": len(_rows(res))}


def delete_notification(customer_id: str, notification_id: str) -> dict:
    """Delete one notification. 404 if it is not the customer's own."""
    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .delete()
        .eq("id", notification_id)
        .eq("customer_id", customer_id)
        .execute()
    )
    if not _rows(res):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"deleted": True}


def create_notification(
    customer_id: str,
    title: str,
    body: str,
    kind: str = "general",
) -> dict:
    """Insert a notification row. Stable helper signature for other modules."""
    if kind not in KINDS:
        raise ValueError(f"Unknown notification kind: {kind!r}")
    client = get_mobile_client()
    res = (
        client.table(TABLE)
        .insert(
            {
                "customer_id": customer_id,
                "title": title,
                "body": body,
                "kind": kind,
                "is_read": False,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .execute()
    )
    rows = _rows(res)
    if not rows:
        raise HTTPException(status_code=502, detail="Could not create notification.")
    return rows[0]
