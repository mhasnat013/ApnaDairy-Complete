"""COD / bank-transfer proof / demo card handling + verification workflow.

Reads and writes the MOBILE project only (customer_orders, customer_payments).
The WEB project is never touched here.
"""
import os
import uuid

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client

RECEIPT_BUCKET = "payment-receipts"

# A payment is "active" (blocks duplicates) unless it failed.
ACTIVE_BLOCKING_STATUSES = ("pending", "submitted", "paid", "verified")

# Orders in these states are closed out and never counted as dues.
CLOSED_ORDER_STATUSES = ("delivered", "cancelled", "rejected")

# Payments in these states mean the order's money is settled.
SETTLED_PAYMENT_STATUSES = ("paid", "verified")


def test_mode_enabled() -> bool:
    """True only when the server explicitly enables the dev-only demo card.

    Default is False: production must never process demo card charges.
    """
    return os.environ.get("PAYMENTS_TEST_MODE", "false").strip().lower() == "true"


def get_order(client, order_id: str):
    """Fetch a single customer_orders row, or None."""
    resp = (
        client.table("customer_orders")
        .select("*")
        .eq("id", order_id)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    return rows[0] if rows else None


def get_active_payment_for_order(client, order_id: str):
    """Return the latest non-failed payment for an order, or None."""
    resp = (
        client.table("customer_payments")
        .select("*")
        .eq("order_id", order_id)
        .execute()
    )
    for row in getattr(resp, "data", None) or []:
        if str(row.get("status")) != "failed":
            return row
    return None


def get_payment(client, payment_id: str):
    resp = (
        client.table("customer_payments")
        .select("*")
        .eq("id", payment_id)
        .execute()
    )
    rows = getattr(resp, "data", None) or []
    return rows[0] if rows else None


def list_payments(client, customer_id: str):
    """All of the caller's payments, newest first."""
    resp = (
        client.table("customer_payments")
        .select("*")
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .execute()
    )
    return list(getattr(resp, "data", None) or [])


def list_customer_orders(client, customer_id: str):
    resp = (
        client.table("customer_orders")
        .select("*")
        .eq("customer_id", customer_id)
        .execute()
    )
    return list(getattr(resp, "data", None) or [])


def upload_receipt(
    client, customer_id: str, payment_id: str, contents: bytes, content_type: str
) -> str:
    """Upload a bank-transfer screenshot to the private payment-receipts bucket."""
    path = f"{customer_id}/{payment_id}.jpg"
    client.storage.from_(RECEIPT_BUCKET).upload(
        path,
        contents,
        file_options={"content-type": content_type or "image/jpeg"},
    )
    return path


def create_payment(
    client,
    order_id: str,
    customer_id: str,
    amount: float,
    method: str,
    status: str,
    receipt_path: str | None = None,
    payment_id: str | None = None,
):
    payload = {
        "id": payment_id or str(uuid.uuid4()),
        "order_id": order_id,
        "customer_id": customer_id,
        "amount": amount,
        "method": method,
        "status": status,
    }
    if receipt_path:
        payload["receipt_path"] = receipt_path
    resp = client.table("customer_payments").insert(payload).execute()
    rows = getattr(resp, "data", None) or []
    if not rows:
        raise HTTPException(status_code=500, detail="Could not record payment.")
    return rows[0]


def compute_dues(client, customer_id: str):
    """Orders still awaiting money: open orders with no paid/verified payment."""
    orders = list_customer_orders(client, customer_id)
    payments = list_payments(client, customer_id)
    settled_order_ids = {
        str(p.get("order_id"))
        for p in payments
        if str(p.get("status")) in SETTLED_PAYMENT_STATUSES
    }
    unpaid = []
    for order in orders:
        status = str(order.get("status"))
        if status in CLOSED_ORDER_STATUSES:
            continue
        if str(order.get("id")) in settled_order_ids:
            continue
        unpaid.append(
            {
                "order_id": str(order.get("id")),
                "total_amount": float(order.get("total_amount") or 0),
                "status": status,
            }
        )
    total = sum(o["total_amount"] for o in unpaid)
    return unpaid, total
