"""CRUD on customer_addresses (MOBILE project, read+write)."""
from datetime import datetime, timezone

from fastapi import HTTPException

from app.db.supabase_client import get_mobile_client

_TABLE = "customer_addresses"


def _table():
    return get_mobile_client().table(_TABLE)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _owns(row: dict, customer_id: str) -> None:
    """Raise 404 unless row exists and belongs to customer_id.

    Same 404 for "not found" and "not owned" so callers never learn
    about other customers' rows.
    """
    if not row or row.get("customer_id") != customer_id:
        raise HTTPException(status_code=404, detail="Address not found.")


def get_address(address_id: str, customer_id: str) -> dict:
    """Single row with ownership enforced."""
    res = _table().select("*").eq("id", address_id).limit(1).execute()
    rows = res.data or []
    row = rows[0] if rows else None
    _owns(row, customer_id)
    return row


def list_addresses(customer_id: str) -> list[dict]:
    """Caller's addresses, default first, then most recent."""
    res = _table().select("*").eq("customer_id", customer_id).execute()
    rows = res.data or []
    # Newest first within each group, then the default on top (stable sort).
    rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
    rows.sort(key=lambda r: not bool(r.get("is_default")))
    return rows


def _unset_defaults(customer_id: str) -> None:
    _table().update({"is_default": False}).eq("customer_id", customer_id).execute()


def create_address(customer_id: str, payload: dict) -> dict:
    """Insert; sets is_default when it is the first address or requested."""
    res = _table().select("id").eq("customer_id", customer_id).execute()
    existing = res.data or []
    wants_default = bool(payload.get("is_default")) or not existing

    if wants_default and existing:
        _unset_defaults(customer_id)

    data = {
        "customer_id": customer_id,
        "label": payload["label"],
        "recipient_name": payload["recipient_name"],
        "phone": payload["phone"],
        "address_line": payload["address_line"],
        "city": payload["city"],
        "latitude": payload.get("latitude"),
        "longitude": payload.get("longitude"),
        "is_default": wants_default,
        "created_at": _now(),
        "updated_at": _now(),
    }
    res = _table().insert(data).execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=500, detail="Could not create address.")
    return rows[0]


def update_address(address_id: str, customer_id: str, fields: dict) -> dict:
    """Update owned row; only provided (non-None) fields are written."""
    _owns_row = get_address(address_id, customer_id)  # raises 404 if missing/foreign
    payload = {k: v for k, v in fields.items() if v is not None}
    if not payload:
        return _owns_row
    payload["updated_at"] = _now()
    res = _table().update(payload).eq("id", address_id).execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Address not found.")
    return rows[0]


def delete_address(address_id: str, customer_id: str) -> dict:
    """Delete owned row; promote most recent remaining row when it was default."""
    row = get_address(address_id, customer_id)  # raises 404 if missing/foreign
    was_default = bool(row.get("is_default"))
    _table().delete().eq("id", address_id).execute()
    if was_default:
        res = _table().select("*").eq("customer_id", customer_id).execute()
        remaining = res.data or []
        if remaining:
            newest = max(remaining, key=lambda r: str(r.get("created_at", "")))
            res2 = _table().update({"is_default": True, "updated_at": _now()}).eq("id", newest["id"]).execute()
            rows2 = res2.data or []
            if rows2:
                return rows2[0]
    return {"id": address_id, "deleted": True}


def set_default_address(address_id: str, customer_id: str) -> dict:
    """Make an owned row the default; unset all of the caller's others."""
    get_address(address_id, customer_id)  # raises 404 if missing/foreign
    _unset_defaults(customer_id)
    res = _table().update({"is_default": True, "updated_at": _now()}).eq("id", address_id).execute()
    rows = res.data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Address not found.")
    return rows[0]
