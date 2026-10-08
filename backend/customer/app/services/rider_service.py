"""Rider/delivery data access for the B2C customer app.

Binds to the real `customer_deliveries` table in the MOBILE Supabase project
(read+write there is fine; the WEB project is never touched here).

Table columns (bind exactly):
    id, order_id, customer_id, rider_id, rider_name, rider_phone,
    vehicle_label, vehicle_plate, rider_rating, status,
    current_latitude, current_longitude, messages (JSON array of
    {from, text, at}), events (JSON array of {status, at, note}),
    customer_rating, customer_rating_comment, rider_photo_path,
    assigned_at, delivered_at.

All JSON access is defensive (.get with defaults) since rows come from the
real database.
"""
from datetime import datetime, timezone
from typing import Any, Optional

from app.db.supabase_client import get_mobile_client

_TABLE = "customer_deliveries"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_list(value: Any) -> list[dict[str, Any]]:
    return value if isinstance(value, list) else []


def get_latest_delivery_for_order(order_id: str, customer_id: str) -> Optional[dict[str, Any]]:
    """Latest delivery row for an order owned by the customer, or None."""
    client = get_mobile_client()
    resp = (
        client.table(_TABLE)
        .select("*")
        .eq("order_id", order_id)
        .eq("customer_id", customer_id)
        .order("assigned_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def get_delivery(delivery_id: str, customer_id: str) -> Optional[dict[str, Any]]:
    """Delivery row only if it belongs to the customer, else None."""
    client = get_mobile_client()
    resp = (
        client.table(_TABLE)
        .select("*")
        .eq("id", delivery_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None


def append_customer_message(delivery_id: str, customer_id: str, text: str) -> Optional[list[dict[str, Any]]]:
    """Append a customer chat message; returns the updated list, or None if
    the delivery is not owned by the customer."""
    row = get_delivery(delivery_id, customer_id)
    if row is None:
        return None
    messages = _as_list(row.get("messages"))
    messages.append({"from": "customer", "text": text, "at": _now_iso()})
    client = get_mobile_client()
    client.table(_TABLE).update({"messages": messages}).eq("id", delivery_id).execute()
    return messages


def rate_delivery(
    delivery_id: str,
    customer_id: str,
    rating: int,
    comment: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    """Rate a delivered delivery. Returns the updated row; None if not owned
    by the customer; raises ValueError("not_delivered") if not delivered."""
    row = get_delivery(delivery_id, customer_id)
    if row is None:
        return None
    if row.get("status") != "delivered":
        raise ValueError("not_delivered")
    client = get_mobile_client()
    resp = (
        client.table(_TABLE)
        .update({"customer_rating": rating, "customer_rating_comment": comment})
        .eq("id", delivery_id)
        .execute()
    )
    rows = resp.data or []
    return rows[0] if rows else None
