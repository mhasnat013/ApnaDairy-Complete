"""Read/update of customer_profiles rows (MOBILE project)."""
from datetime import datetime, timezone

from app.db.supabase_client import get_mobile_client

_TABLE = "customer_profiles"


def _table():
    return get_mobile_client().table(_TABLE)


def get_profile(customer_id: str) -> dict | None:
    """Full profile row, or None when no row matches."""
    res = _table().select("*").eq("id", customer_id).limit(1).execute()
    rows = res.data or []
    return rows[0] if rows else None


def update_profile(customer_id: str, fields: dict) -> dict | None:
    """Update only whitelisted fields (validated upstream); bumps updated_at.

    Returns the updated row, or None when the row does not exist.
    """
    payload = {
        **{k: v for k, v in fields.items() if v is not None},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    res = _table().update(payload).eq("id", customer_id).execute()
    rows = res.data or []
    return rows[0] if rows else None
