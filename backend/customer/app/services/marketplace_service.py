"""Marketplace service.

Product catalog is read from the WEB Supabase project (READ-ONLY — this
module only ever issues .select() queries against get_web_client()).
The wishlist lives in the MOBILE project table `customer_wishlist_items`
(read+write via get_mobile_client()).
"""
from datetime import date
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client, get_web_client

WISHLIST_TABLE = "customer_wishlist_items"

PRODUCT_COLUMNS = (
    "id,area_manager_id,name,category,milk_type,unit,price,discount_pct,"
    "stock_qty,made_on,expires_on,is_available,is_sample,description,created_at"
)
MANAGER_COLUMNS = "id,center_name,city"

VALID_SORTS = {"price_asc", "price_desc", "newest"}
MAX_PAGE_SIZE = 100


def _final_price(price: Any, discount_pct: Any) -> float:
    try:
        p = float(price or 0)
    except (TypeError, ValueError):
        p = 0.0
    try:
        d = float(discount_pct or 0)
    except (TypeError, ValueError):
        d = 0.0
    return round(p * (1 - d / 100), 2)


def _freshness_days(expires_on: Any) -> Optional[int]:
    if not expires_on:
        return None
    if isinstance(expires_on, date):
        exp = expires_on
    else:
        try:
            exp = date.fromisoformat(str(expires_on)[:10])
        except (ValueError, TypeError):
            return None
    return (exp - date.today()).days


def _is_listable(row: Dict[str, Any]) -> bool:
    """Defensive in-Python mirror of the SQL purchasability constraints."""
    if not row.get("is_available"):
        return False
    if row.get("is_sample"):
        return False
    try:
        return float(row.get("stock_qty") or 0) > 0
    except (TypeError, ValueError):
        return False


def _managers_by_id(manager_ids: List[Any]) -> Dict[str, Dict[str, Any]]:
    ids = [str(i) for i in dict.fromkeys(manager_ids) if i]
    if not ids:
        return {}
    rows = (
        get_web_client()
        .table("area_managers")
        .select(MANAGER_COLUMNS)
        .in_("id", ids)
        .execute()
        .data
        or []
    )
    return {str(r.get("id")): r for r in rows}


def serialize_product(
    row: Dict[str, Any], manager_row: Optional[Dict[str, Any]] = None
) -> Dict[str, Any]:
    mgr = manager_row or {}
    return {
        "id": str(row.get("id")),
        "name": row.get("name"),
        "category": row.get("category"),
        "milk_type": row.get("milk_type"),
        "unit": row.get("unit"),
        "price": float(row.get("price") or 0),
        "discount_pct": float(row.get("discount_pct") or 0),
        "final_price": _final_price(row.get("price"), row.get("discount_pct")),
        "stock_qty": row.get("stock_qty"),
        "made_on": row.get("made_on"),
        "expires_on": row.get("expires_on"),
        "freshness_days": _freshness_days(row.get("expires_on")),
        "is_available": bool(row.get("is_available")),
        "description": row.get("description"),
        "manager": {
            "id": str(mgr.get("id")) if mgr.get("id") is not None else None,
            "center_name": mgr.get("center_name"),
            "city": mgr.get("city"),
        }
        if mgr
        else None,
    }


def list_products(
    category: Optional[str] = None,
    milk_type: Optional[str] = None,
    city: Optional[str] = None,
    q: Optional[str] = None,
    sort: str = "newest",
    page: int = 1,
    page_size: int = 20,
) -> Dict[str, Any]:
    if sort not in VALID_SORTS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid sort '{sort}'. Use one of: price_asc, price_desc, newest.",
        )
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)

    web = get_web_client()

    manager_ids: Optional[List[Any]] = None
    if city:
        mrows = (
            web.table("area_managers").select("id").eq("city", city).execute().data
            or []
        )
        manager_ids = [r.get("id") for r in mrows]
        if not manager_ids:
            return {"items": [], "page": page, "page_size": page_size, "total": 0}

    query = web.table("products").select(PRODUCT_COLUMNS, count="exact")
    query = query.eq("is_available", True).eq("is_sample", False).gt("stock_qty", 0)
    if category:
        query = query.eq("category", category)
    if milk_type:
        query = query.eq("milk_type", milk_type)
    if manager_ids is not None:
        query = query.in_("area_manager_id", manager_ids)
    if q:
        like = f"%{q}%"
        query = query.or_(f"name.ilike.{like},description.ilike.{like}")
    if sort == "price_asc":
        query = query.order("price")
    elif sort == "price_desc":
        query = query.order("price", desc=True)
    else:
        query = query.order("created_at", desc=True)

    start = (page - 1) * page_size
    resp = query.range(start, start + page_size - 1).execute()
    rows = [r for r in (resp.data or []) if _is_listable(r)]
    total = resp.count if resp.count is not None else len(rows)

    managers = _managers_by_id([r.get("area_manager_id") for r in rows])
    items = [
        serialize_product(r, managers.get(str(r.get("area_manager_id")))) for r in rows
    ]
    return {"items": items, "page": page, "page_size": page_size, "total": total}


def get_product(product_id: str) -> Optional[Dict[str, Any]]:
    rows = (
        get_web_client()
        .table("products")
        .select(PRODUCT_COLUMNS)
        .eq("id", product_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows or not _is_listable(rows[0]):
        return None
    row = rows[0]
    managers = _managers_by_id([row.get("area_manager_id")])
    return serialize_product(row, managers.get(str(row.get("area_manager_id"))))


def get_wishlist(customer_id: str) -> Dict[str, Any]:
    rows = (
        get_mobile_client()
        .table(WISHLIST_TABLE)
        .select("product_id")
        .eq("customer_id", customer_id)
        .execute()
        .data
        or []
    )
    items = []
    for r in rows:
        pid = str(r.get("product_id"))
        items.append({"product_id": pid, "product": get_product(pid)})
    return {"items": items}


def add_to_wishlist(customer_id: str, product_id: str) -> Dict[str, Any]:
    product = get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    mobile = get_mobile_client()
    existing = (
        mobile.table(WISHLIST_TABLE)
        .select("product_id")
        .eq("customer_id", customer_id)
        .eq("product_id", product_id)
        .limit(1)
        .execute()
        .data
        or []
    )
    if not existing:
        mobile.table(WISHLIST_TABLE).insert(
            {"customer_id": customer_id, "product_id": product_id}
        ).execute()
    return {"product_id": product_id, "product": product}


def remove_from_wishlist(customer_id: str, product_id: str) -> None:
    (
        get_mobile_client()
        .table(WISHLIST_TABLE)
        .delete()
        .eq("customer_id", customer_id)
        .eq("product_id", product_id)
        .execute()
    )
