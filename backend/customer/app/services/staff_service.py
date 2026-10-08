"""Staff (web-admin) service: order management, payment verification, complaint
handling, customer verification.

Reads/writes the MOBILE Supabase project only. Every mutation appends a row to
audit_logs (best effort) and creates a customer_notifications entry.
"""
from datetime import datetime, timezone

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client

STAFF_ACTOR = "staff"

#: Allowed order status transitions.
ORDER_TRANSITIONS = {
    # Vocabulary matches the customer_orders.status CHECK constraint
    # in the real DB (seed data uses accepted/preparing/dispatched).
    "pending": ["accepted", "rejected"],
    "accepted": ["preparing", "cancelled"],
    "preparing": ["dispatched", "cancelled"],
    "dispatched": ["delivered"],
    "delivered": [],
    "rejected": [],
    "cancelled": [],
}

#: Allowed complaint statuses (for staff responses).
COMPLAINT_STATUSES = {"open", "in_review", "resolved", "rejected"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _audit(action: str, entity: str, entity_id: str, meta: dict | None = None) -> None:
    """Best-effort audit row: must never break the staff action itself."""
    try:
        get_mobile_client().table("audit_logs").insert(
            {
                "actor": STAFF_ACTOR,
                "action": action,
                "entity": entity,
                "entity_id": entity_id,
                "meta": meta or {},
                "created_at": _now_iso(),
            }
        ).execute()
    except Exception:
        pass


def _notify(customer_id: str, title: str, body: str, kind: str) -> None:
    if not customer_id:
        return
    try:
        get_mobile_client().table("customer_notifications").insert(
            {
                "customer_id": customer_id,
                "title": title,
                "body": body,
                "kind": kind,
                "is_read": False,
                "created_at": _now_iso(),
            }
        ).execute()
    except Exception:
        pass


def _get_by_id(table: str, row_id: str, not_found_detail: str) -> dict:
    res = (
        get_mobile_client().table(table).select("*").eq("id", row_id).execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail=not_found_detail)
    return rows[0]


def _latest_delivery(order_id: str) -> dict | None:
    """Newest customer_deliveries row for an order, or None (skipped gracefully)."""
    res = (
        get_mobile_client()
        .table("customer_deliveries")
        .select("*")
        .eq("order_id", order_id)
        .order("assigned_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


# ---------------------------------------------------------------- orders ----


def list_orders(
    area_manager_id: str | None, status: str | None, page: int, page_size: int
) -> dict:
    q = (
        get_mobile_client()
        .table("customer_orders")
        .select("*")
        .order("created_at", desc=True)
    )
    if area_manager_id:
        q = q.eq("area_manager_id", area_manager_id)
    if status:
        q = q.eq("status", status)
    start = max(0, (page - 1) * page_size)
    res = q.range(start, start + page_size - 1).execute()
    return {
        "items": res.data or [],
        "page": page,
        "page_size": page_size,
    }


def set_order_status(order_id: str, status: str, note: str | None) -> dict:
    order = _get_by_id("customer_orders", order_id, "Order not found.")
    current = order.get("status")
    allowed = ORDER_TRANSITIONS.get(current, [])
    if status not in allowed:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status transition: {current} -> {status}.",
        )
    now = _now_iso()
    upd = (
        get_mobile_client()
        .table("customer_orders")
        .update({"status": status, "updated_at": now})
        .eq("id", order_id)
        .execute()
    )
    updated = (upd.data or [order])[0]

    # Append a staff event to the order's delivery timeline (graceful if none).
    delivery = _latest_delivery(order_id)
    if delivery is not None:
        events = delivery.get("events") or []
        events.append({"status": status, "at": now, "note": note, "by": STAFF_ACTOR})
        get_mobile_client().table("customer_deliveries").update(
            {"events": events}
        ).eq("id", delivery["id"]).execute()

    _notify(
        order.get("customer_id"),
        f"Order {status}",
        f"Your order is now {status}." + (f" Note: {note}" if note else ""),
        "order",
    )
    _audit(
        "order.status",
        "customer_orders",
        order_id,
        {"from": current, "to": status, "note": note},
    )
    return updated


def assign_rider(
    order_id: str,
    rider_name: str,
    rider_phone: str,
    vehicle_label: str | None,
    vehicle_plate: str | None,
) -> dict:
    order = _get_by_id("customer_orders", order_id, "Order not found.")
    now = _now_iso()
    event = {
        "status": "assigned",
        "at": now,
        "rider_name": rider_name,
        "rider_phone": rider_phone,
        "by": STAFF_ACTOR,
    }
    existing = _latest_delivery(order_id)
    client = get_mobile_client()
    if existing is not None:
        events = existing.get("events") or []
        events.append(event)
        res = (
            client.table("customer_deliveries")
            .update(
                {
                    "status": "assigned",
                    "rider_name": rider_name,
                    "rider_phone": rider_phone,
                    "vehicle_label": vehicle_label,
                    "vehicle_plate": vehicle_plate,
                    "events": events,
                }
            )
            .eq("id", existing["id"])
            .execute()
        )
        delivery = (res.data or [existing])[0]
    else:
        res = (
            client.table("customer_deliveries")
            .insert(
                {
                    "order_id": order_id,
                    "customer_id": order.get("customer_id"),
                    "status": "assigned",
                    "rider_name": rider_name,
                    "rider_phone": rider_phone,
                    "vehicle_label": vehicle_label,
                    "vehicle_plate": vehicle_plate,
                    "events": [event],
                    "assigned_at": now,
                }
            )
            .execute()
        )
        delivery = (res.data or [])[0]

    _notify(
        order.get("customer_id"),
        "Rider assigned",
        f"{rider_name} ({rider_phone}) is delivering your order.",
        "delivery",
    )
    _audit(
        "order.assign_rider",
        "customer_deliveries",
        delivery["id"],
        {"order_id": order_id, "rider_name": rider_name},
    )
    return delivery


# --------------------------------------------------------------- payments ----


def list_payments(status: str | None) -> dict:
    q = (
        get_mobile_client()
        .table("customer_payments")
        .select("*")
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return {"items": res.data or []}


def verify_payment(payment_id: str, verified: bool, note: str | None) -> dict:
    payment = _get_by_id("customer_payments", payment_id, "Payment not found.")
    new_status = "verified" if verified else "rejected"
    res = (
        get_mobile_client()
        .table("customer_payments")
        .update({"status": new_status, "verified_by": STAFF_ACTOR})
        .eq("id", payment_id)
        .execute()
    )
    updated = (res.data or [payment])[0]
    _notify(
        payment.get("customer_id"),
        f"Payment {new_status}",
        f"Your payment of {payment.get('amount')} was {new_status}."
        + (f" Note: {note}" if note else ""),
        "payment",
    )
    _audit(
        "payment.verify",
        "customer_payments",
        payment_id,
        {"verified": verified, "status": new_status, "note": note},
    )
    return updated


# ------------------------------------------------------------- complaints ----


def list_complaints(status: str | None) -> dict:
    q = (
        get_mobile_client()
        .table("customer_complaints")
        .select("*")
        .order("created_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    res = q.execute()
    return {"items": res.data or []}


def respond_complaint(
    complaint_id: str, text: str, status: str | None
) -> dict:
    complaint = _get_by_id("customer_complaints", complaint_id, "Complaint not found.")
    if status is not None and status not in COMPLAINT_STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid complaint status: {status}.",
        )
    messages = complaint.get("messages") or []
    messages.append({"from": STAFF_ACTOR, "text": text, "at": _now_iso()})
    payload: dict = {"messages": messages, "updated_at": _now_iso()}
    if status is not None:
        payload["status"] = status
    res = (
        get_mobile_client()
        .table("customer_complaints")
        .update(payload)
        .eq("id", complaint_id)
        .execute()
    )
    updated = (res.data or [complaint])[0]
    _notify(
        complaint.get("customer_id"),
        "Complaint update",
        text,
        "complaint",
    )
    _audit(
        "complaint.respond",
        "customer_complaints",
        complaint_id,
        {"status": status, "text": text},
    )
    return updated


# -------------------------------------------------------------- customers ----


def list_customers(
    verification_status: str | None, page: int, page_size: int
) -> dict:
    q = (
        get_mobile_client()
        .table("customer_profiles")
        .select("*")
        .order("created_at", desc=True)
    )
    if verification_status:
        q = q.eq("verification_status", verification_status)
    start = max(0, (page - 1) * page_size)
    res = q.range(start, start + page_size - 1).execute()
    return {
        "items": res.data or [],
        "page": page,
        "page_size": page_size,
    }


def verify_customer(
    customer_id: str,
    approved: bool,
    rejection_reason: str | None,
    area_manager_id: str | None,
) -> dict:
    customer = _get_by_id("customer_profiles", customer_id, "Customer not found.")
    new_status = "approved" if approved else "rejected"
    payload: dict = {"verification_status": new_status, "updated_at": _now_iso()}
    if area_manager_id is not None:
        payload["area_manager_id"] = area_manager_id
    res = (
        get_mobile_client()
        .table("customer_profiles")
        .update(payload)
        .eq("id", customer_id)
        .execute()
    )
    updated = (res.data or [customer])[0]
    _notify(
        customer_id,
        f"Verification {new_status}",
        (
            "Your account verification was approved."
            if approved
            else f"Your verification was rejected. Reason: {rejection_reason or 'not specified'}"
        ),
        "verification",
    )
    _audit(
        "customer.verify",
        "customer_profiles",
        customer_id,
        {
            "approved": approved,
            "verification_status": new_status,
            "rejection_reason": rejection_reason,
            "area_manager_id": area_manager_id,
        },
    )
    return updated
