"""Cart service — one cart per customer, backed by mobile customer_carts +
customer_cart_items.

REAL SCHEMA: customer_carts (id, customer_id, area_manager_id) owns the cart;
customer_cart_items.cart_id -> customer_carts.id. _resolve_cart_id() gets or
creates the customer's cart row, so callers keep passing customer_id.

Mobile client: read+write on customer_carts / customer_cart_items.
Web client: READ-ONLY (select only) on the products table — used to snapshot
the unit price (price * (1 - discount_pct / 100)) and the product name at
add time. Never insert/update/delete through the web client.
"""

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client, get_web_client
from app.schemas.cart import CartItemOut, CartOut

_CART_TABLE = "customer_cart_items"
_CARTS_TABLE = "customer_carts"
_PRODUCTS_TABLE = "products"


# ---------- web catalog (read-only) ----------

def _fetch_product(product_id: str) -> dict:
    """Fetch one product row from the WEB project products table (select only)."""
    web = get_web_client()
    res = (
        web.table(_PRODUCTS_TABLE)
        .select("*")
        .eq("id", product_id)
        .limit(1)
        .execute()
    )
    return res.data[0] if res.data else {}


def _is_available(product: dict) -> bool:
    """Orderable unless the row or an explicit availability flag says otherwise."""
    if not product:
        return False
    if product.get("is_available") is False:
        return False
    if product.get("is_active") is False:
        return False
    status = product.get("status")
    if status is not None and str(status).lower() not in ("active", "available"):
        return False
    return True


def _snapshot_price(product: dict) -> float:
    price = float(product.get("price") or 0)
    discount_pct = float(product.get("discount_pct") or 0)
    return round(price * (1 - discount_pct / 100), 2)


def _product_name(product: dict) -> str:
    return product.get("name") or product.get("product_name") or ""


def _product_names(product_ids: list[str]) -> dict[str, str]:
    """Batch name lookup from WEB (read-only); never raises for missing rows."""
    if not product_ids:
        return {}
    web = get_web_client()
    res = (
        web.table(_PRODUCTS_TABLE)
        .select("id,name")
        .in_("id", list(product_ids))
        .execute()
    )
    return {str(r["id"]): _product_name(r) for r in (res.data or [])}


# ---------- cart rows (mobile, read+write) ----------

def _resolve_cart_id(customer_id: str, area_manager_id: str | None = None) -> str:
    """Get the customer's customer_carts.id, creating the cart row if needed.

    customer_carts.area_manager_id is NOT NULL, so a manager id is required
    when creating a new cart (taken from the product being added).
    """
    mobile = get_mobile_client()
    res = (
        mobile.table(_CARTS_TABLE)
        .select("id")
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    if res.data:
        return str(res.data[0]["id"])
    if not area_manager_id:
        raise HTTPException(
            status_code=422,
            detail="No cart yet — add a product first (area manager required).",
        )
    ins = (
        mobile.table(_CARTS_TABLE)
        .insert({"customer_id": customer_id, "area_manager_id": area_manager_id})
        .execute()
    )
    return str(ins.data[0]["id"])


def _own_item(customer_id: str, item_id: str) -> dict:
    mobile = get_mobile_client()
    cart_id = _resolve_cart_id(customer_id)
    res = (
        mobile.table(_CART_TABLE)
        .select("*")
        .eq("id", item_id)
        .eq("cart_id", cart_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(status_code=404, detail="Cart item not found.")
    return res.data[0]


def _item_out(item: dict, product_name: str) -> CartItemOut:
    unit_price = float(item.get("unit_price") or 0)
    quantity = int(item.get("quantity") or 0)
    return CartItemOut(
        id=str(item["id"]),
        product_id=str(item["product_id"]),
        product_name=product_name,
        quantity=quantity,
        unit_price=unit_price,
        line_total=round(unit_price * quantity, 2),
    )


def get_cart(customer_id: str) -> CartOut:
    mobile = get_mobile_client()
    cart_id = _resolve_cart_id(customer_id)
    res = (
        mobile.table(_CART_TABLE)
        .select("*")
        .eq("cart_id", cart_id)
        .execute()
    )
    rows = res.data or []
    names = _product_names([str(r["product_id"]) for r in rows])
    items = [_item_out(r, names.get(str(r["product_id"]), "")) for r in rows]
    return CartOut(
        items=items,
        total_items=sum(i.quantity for i in items),
        total_amount=round(sum(i.line_total for i in items), 2),
    )


def add_item(customer_id: str, product_id: str, quantity: int) -> CartItemOut:
    product = _fetch_product(product_id)
    if not _is_available(product):
        raise HTTPException(status_code=404, detail="Product not available.")
    unit_price = _snapshot_price(product)
    name = _product_name(product)

    mobile = get_mobile_client()
    cart_id = _resolve_cart_id(customer_id, product.get("area_manager_id"))
    res = (
        mobile.table(_CART_TABLE)
        .select("*")
        .eq("cart_id", cart_id)
        .eq("product_id", product_id)
        .limit(1)
        .execute()
    )
    if res.data:
        existing = res.data[0]
        new_qty = int(existing.get("quantity") or 0) + quantity
        upd = (
            mobile.table(_CART_TABLE)
            .update({"quantity": new_qty, "unit_price": unit_price})
            .eq("id", existing["id"])
            .eq("cart_id", cart_id)
            .execute()
        )
        row = upd.data[0] if upd.data else {**existing, "quantity": new_qty, "unit_price": unit_price}
        return _item_out(row, name)

    ins = (
        mobile.table(_CART_TABLE)
        .insert(
            {
                "cart_id": cart_id,
                "product_id": product_id,
                "quantity": quantity,
                "unit_price": unit_price,
            }
        )
        .execute()
    )
    return _item_out(ins.data[0], name)


def update_item(customer_id: str, item_id: str, quantity: int) -> CartItemOut | None:
    """Set quantity; quantity == 0 deletes the item (returns None)."""
    mobile = get_mobile_client()
    cart_id = _resolve_cart_id(customer_id)
    if quantity == 0:
        delete_item(customer_id, item_id)
        return None
    upd = (
        mobile.table(_CART_TABLE)
        .update({"quantity": quantity})
        .eq("id", item_id)
        .eq("cart_id", cart_id)
        .execute()
    )
    if not upd.data:
        raise HTTPException(status_code=404, detail="Cart item not found.")
    row = upd.data[0]
    names = _product_names([str(row["product_id"])])
    return _item_out(row, names.get(str(row["product_id"]), ""))


def delete_item(customer_id: str, item_id: str) -> None:
    cart_id = _resolve_cart_id(customer_id)
    deleted = (
        get_mobile_client()
        .table(_CART_TABLE)
        .delete()
        .eq("id", item_id)
        .eq("cart_id", cart_id)
        .execute()
    )
    if not deleted.data:
        raise HTTPException(status_code=404, detail="Cart item not found.")


def clear_cart(customer_id: str) -> None:
    cart_id = _resolve_cart_id(customer_id)
    get_mobile_client().table(_CART_TABLE).delete().eq("cart_id", cart_id).execute()
