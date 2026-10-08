"""Order service: per-manager order creation (never merge), detail + timeline,
cancel, reorder.

Tables (bind exactly to the real mobile tables):
- customer_orders: id, customer_id, area_manager_id, address_id, status,
  customer_checkout (JSON), total_amount, currency, web_order_id,
  created_at, updated_at. A migration may add an `idempotency_key` TEXT
  column; the code never assumes it exists (see _persist_idempotency_key).
- customer_order_items: id, order_id, product_id, product_name,
  quantity, unit_price (may be created by a pending migration;
  inserts are best-effort).
- customer_cart_items: id, cart_id (= customer_id), product_id,
  quantity, unit_price, created_at, updated_at.
- customer_addresses: id, customer_id, ... (any delivery address row).
- customer_deliveries: id, order_id, customer_id, ..., events (JSON), status.
- customer_notifications: id, customer_id, title, body, kind, is_read,
  created_at.

Web project is 100% READ-ONLY (select only) — product name, area manager
mapping and prices come from the web `products` table.
"""

import logging

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client, get_web_client
from app.services.cart_service import _resolve_cart_id
from app.schemas.orders import (
    OrderItemOut,
    OrderListOut,
    OrderOut,
    ReorderOut,
    TimelineEvent,
)

logger = logging.getLogger(__name__)

_ORDERS = "customer_orders"
_ITEMS = "customer_order_items"
_CART = "customer_cart_items"
_ADDRESSES = "customer_addresses"
_DELIVERIES = "customer_deliveries"
_NOTIFICATIONS = "customer_notifications"
_PRODUCTS = "products"

STATUSES = (
    "pending",
    "accepted",
    "preparing",
    "dispatched",
    "delivered",
    "cancelled",
    "rejected",
)
CANCELLABLE_STATUSES = {"pending", "accepted"}


# ---------- local notification helper (never raises) ----------

def _notify(customer_id: str, title: str, body: str, kind: str = "order") -> None:
    """Insert into mobile.customer_notifications; failures never break the caller."""
    try:
        get_mobile_client().table(_NOTIFICATIONS).insert(
            {
                "customer_id": customer_id,
                "title": title,
                "body": body,
                "kind": kind,
            }
        ).execute()
    except Exception as exc:  # noqa: BLE001 - notifications must not break orders
        logger.warning("notification insert failed: %s", exc)


# ---------- web catalog (read-only) ----------

def _fetch_product(product_id: str) -> dict:
    """Fetch one product row from the WEB project products table (select only)."""
    web = get_web_client()
    res = (
        web.table(_PRODUCTS)
        .select("*")
        .eq("id", product_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else {}


def _product_name(product: dict) -> str:
    return product.get("name") or product.get("product_name") or ""


def _snapshot_price(product: dict) -> float:
    price = float(product.get("price") or 0)
    discount_pct = float(product.get("discount_pct") or 0)
    return round(price * (1 - discount_pct / 100), 2)


# ---------- row -> schema ----------

def _item_out(row: dict) -> OrderItemOut:
    unit_price = float(row.get("unit_price") or 0)
    quantity = int(row.get("quantity") or 0)
    return OrderItemOut(
        id=str(row.get("id", "")),
        order_id=str(row.get("order_id", "")),
        product_id=str(row.get("product_id", "")),
        product_name=str(row.get("product_name") or ""),
        quantity=quantity,
        unit_price=unit_price,
        line_total=round(unit_price * quantity, 2),
    )


def _timeline_event(entry) -> TimelineEvent:
    if isinstance(entry, str):
        return TimelineEvent(message=entry)
    if isinstance(entry, dict):
        return TimelineEvent(
            type=str(entry.get("type") or ""),
            message=str(entry.get("message") or entry.get("body") or ""),
            created_at=entry.get("created_at"),
        )
    return TimelineEvent(message=str(entry))


def _order_items(order_id: str) -> list[dict]:
    mobile = get_mobile_client()
    res = (
        mobile.table(_ITEMS)
        .select("*")
        .eq("order_id", order_id)
        .execute()
    )
    return res.data or []


def _delivery_timeline(order_id: str) -> list[TimelineEvent]:
    """Timeline = events JSON of the latest customer_deliveries row for the order."""
    mobile = get_mobile_client()
    res = (
        mobile.table(_DELIVERIES)
        .select("id,events,status,assigned_at")
        .eq("order_id", order_id)
        .order("assigned_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        return []
    events = rows[0].get("events") or []
    if not isinstance(events, list):
        events = [events]
    return [_timeline_event(e) for e in events]


def _order_out(row: dict, with_items: bool = True, with_timeline: bool = True) -> OrderOut:
    checkout = row.get("customer_checkout") or {}
    order_id = str(row.get("id", ""))
    items = [_item_out(r) for r in _order_items(order_id)] if with_items else []
    timeline = _delivery_timeline(order_id) if with_timeline else []
    return OrderOut(
        id=order_id,
        customer_id=str(row.get("customer_id", "")),
        area_manager_id=str(row.get("area_manager_id", "")),
        address_id=str(row.get("address_id", "")),
        status=str(row.get("status") or "pending"),
        payment_method=str(checkout.get("payment_method") or ""),
        note=checkout.get("note"),
        total_amount=float(row.get("total_amount") or 0),
        currency=str(row.get("currency") or "PKR"),
        created_at=row.get("created_at"),
        items=items,
        timeline=timeline,
    )


def _get_order_or_404(customer_id: str, order_id: str) -> dict:
    mobile = get_mobile_client()
    res = (
        mobile.table(_ORDERS)
        .select("*")
        .eq("id", order_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Order not found.")
    return res.data[0]


# ---------- checkout ----------

def _find_orders_by_idempotency(customer_id: str, key: str) -> list[dict]:
    """Return this customer's orders whose customer_checkout.idempotency_key == key."""
    mobile = get_mobile_client()
    res = (
        mobile.table(_ORDERS)
        .select("*")
        .eq("customer_id", customer_id)
        .execute()
    )
    out = []
    for row in res.data or []:
        checkout = row.get("customer_checkout") or {}
        if checkout.get("idempotency_key") == key:
            out.append(row)
    return out


def _persist_idempotency_key(order_id: str, key: str) -> None:
    """Best-effort: set the idempotency_key column if the migration added it.

    The key is always stored inside customer_checkout JSON as well, so the
    column is a convenience only — never assume it exists.
    """
    try:
        get_mobile_client().table(_ORDERS).update(
            {"idempotency_key": key}
        ).eq("id", order_id).execute()
    except Exception as exc:  # noqa: BLE001 - column may not exist yet
        logger.info("idempotency_key column not available: %s", exc)


def _insert_order_items(order_id: str, lines: list[dict]) -> None:
    """Best-effort insert into customer_order_items (table may not exist yet)."""
    try:
        get_mobile_client().table(_ITEMS).insert(
            [
                {
                    "order_id": order_id,
                    "product_id": line["product_id"],
                    "product_name": line["product_name"],
                    "quantity": line["quantity"],
                    "unit_price": line["unit_price"],
                }
                for line in lines
            ]
        ).execute()
    except Exception as exc:  # noqa: BLE001 - migration table may not exist
        logger.info("customer_order_items insert skipped: %s", exc)


def checkout(
    customer_id: str,
    address_id: str,
    payment_method: str,
    note: str | None,
    idempotency_key: str | None = None,
) -> list[OrderOut]:
    """Create ONE customer_orders row per area manager from the caller's cart.

    Idempotency: when a key is given and matching orders already exist for
    this customer, the existing orders are returned (200) without duplicating.
    """
    mobile = get_mobile_client()

    # 0. Idempotency check comes FIRST: a retried request has an empty cart
    #    (the first attempt cleared it), so the cart-empty 404 must not fire.
    if idempotency_key:
        existing = _find_orders_by_idempotency(customer_id, idempotency_key)
        if existing:
            return [_order_out(r) for r in existing]

    # 1. Cart must be non-empty.
    cart_id = _resolve_cart_id(customer_id)
    cart = (
        mobile.table(_CART)
        .select("*")
        .eq("cart_id", cart_id)
        .execute()
    )
    cart_rows = cart.data or []
    if not cart_rows:
        raise HTTPException(status_code=404, detail="Cart is empty.")

    # 2. Address must belong to the caller.
    addr = (
        mobile.table(_ADDRESSES)
        .select("*")
        .eq("id", address_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    if not addr.data:
        raise HTTPException(status_code=404, detail="Address not found.")
    address_snapshot = addr.data[0]

    # 3. Resolve each cart line against the WEB catalog (read-only) and
    #    group lines BY area_manager_id — never merge managers.
    groups: dict[str, list[dict]] = {}
    for line in cart_rows:
        product = _fetch_product(str(line["product_id"]))
        if not product:
            raise HTTPException(
                status_code=404,
                detail=f"Product {line['product_id']} not available.",
            )
        manager_id = product.get("area_manager_id")
        if not manager_id:
            raise HTTPException(
                status_code=400,
                detail=f"Product {line['product_id']} has no area manager.",
            )
        quantity = int(line.get("quantity") or 0)
        unit_price = float(line.get("unit_price") or _snapshot_price(product))
        groups.setdefault(str(manager_id), []).append(
            {
                "product_id": str(line["product_id"]),
                "product_name": _product_name(product),
                "quantity": quantity,
                "unit_price": unit_price,
                "line_total": round(unit_price * quantity, 2),
            }
        )

    # 4. One order row per manager.
    placed: list[dict] = []
    for manager_id, lines in groups.items():
        total = round(sum(line["line_total"] for line in lines), 2)
        checkout_payload = {
            "items": lines,
            "address_snapshot": address_snapshot,
            "payment_method": payment_method,
            "note": note,
            "idempotency_key": idempotency_key,
        }
        ins = (
            mobile.table(_ORDERS)
            .insert(
                {
                    "customer_id": customer_id,
                    "area_manager_id": manager_id,
                    "address_id": address_id,
                    "status": "pending",
                    "customer_checkout": checkout_payload,
                    "total_amount": total,
                    "currency": "PKR",
                }
            )
            .execute()
        )
        if not ins.data:
            raise HTTPException(
                status_code=500, detail="Could not place order. Try again."
            )
        order_row = ins.data[0]
        placed.append(order_row)

        if idempotency_key:
            _persist_idempotency_key(str(order_row.get("id")), idempotency_key)
        _insert_order_items(str(order_row.get("id")), lines)

        _notify(
            customer_id,
            "Order placed",
            f"Your order of Rs {total} is pending with the area manager.",
            kind="order",
        )

    # 5. Clear the cart only after every order row was created.
    mobile.table(_CART).delete().eq("cart_id", cart_id).execute()

    return [_order_out(r) for r in placed]


# ---------- orders ----------

def list_orders(
    customer_id: str,
    status: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> OrderListOut:
    mobile = get_mobile_client()
    res = (
        mobile.table(_ORDERS)
        .select("*")
        .eq("customer_id", customer_id)
        .execute()
    )
    rows = res.data or []
    if status:
        rows = [r for r in rows if str(r.get("status")) == status]
    rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    total = len(rows)
    start = (page - 1) * page_size
    page_rows = rows[start : start + page_size]
    return OrderListOut(
        orders=[
            _order_out(r, with_items=True, with_timeline=False)
            for r in page_rows
        ],
        page=page,
        page_size=page_size,
        total=total,
    )


def get_order_detail(customer_id: str, order_id: str) -> OrderOut:
    row = _get_order_or_404(customer_id, order_id)
    return _order_out(row, with_items=True, with_timeline=True)


def cancel_order(customer_id: str, order_id: str) -> OrderOut:
    row = _get_order_or_404(customer_id, order_id)
    status = str(row.get("status") or "")
    if status not in CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Order cannot be cancelled in status '{status}'.",
        )
    upd = (
        get_mobile_client()
        .table(_ORDERS)
        .update({"status": "cancelled"})
        .eq("id", order_id)
        .eq("customer_id", customer_id)
        .execute()
    )
    updated = upd.data[0] if upd.data else {**row, "status": "cancelled"}
    _notify(
        customer_id,
        "Order cancelled",
        f"Your order of Rs {float(row.get('total_amount') or 0)} was cancelled.",
        kind="order",
    )
    return _order_out(updated, with_items=True, with_timeline=False)


def reorder(customer_id: str, order_id: str) -> ReorderOut:
    """Copy an order's items back into the caller's cart (upsert by product_id)."""
    row = _get_order_or_404(customer_id, order_id)

    lines = _order_items(order_id)
    if not lines:
        # Fall back to the checkout snapshot when item rows are missing.
        checkout = row.get("customer_checkout") or {}
        lines = checkout.get("items") or []

    mobile = get_mobile_client()
    reorder_cart_id = _resolve_cart_id(customer_id)
    added_qty = 0
    total_amount = 0.0
    for line in lines:
        product_id = str(line.get("product_id", ""))
        if not product_id:
            continue
        quantity = int(line.get("quantity") or 0)
        unit_price = float(line.get("unit_price") or 0)
        if quantity <= 0:
            continue
        existing = (
            mobile.table(_CART)
            .select("*")
            .eq("cart_id", reorder_cart_id)
            .eq("product_id", product_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            cur = existing.data[0]
            mobile.table(_CART).update(
                {"quantity": int(cur.get("quantity") or 0) + quantity,
                 "unit_price": unit_price}
            ).eq("id", cur["id"]).eq("cart_id", reorder_cart_id).execute()
        else:
            mobile.table(_CART).insert(
                {
                    "cart_id": reorder_cart_id,
                    "product_id": product_id,
                    "quantity": quantity,
                    "unit_price": unit_price,
                }
            ).execute()
        added_qty += quantity
        total_amount += round(unit_price * quantity, 2)

    return ReorderOut(
        added_items=added_qty, total_amount=round(total_amount, 2)
    )
