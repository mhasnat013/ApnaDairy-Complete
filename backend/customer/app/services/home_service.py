"""Home feed service: greeting + featured batches + managers + dues summary."""
from typing import Any, Dict, Optional

from app.db.supabase_client import get_mobile_client
from app.services import marketplace_service


def _greeting() -> str:
    from datetime import datetime

    h = datetime.now().hour
    if h < 12:
        return "Subah bakhair"
    if h < 17:
        return "Assalam-o-Alaikum"
    return "Shab bakhair"


def get_home_feed(customer_id: Optional[str] = None) -> Dict[str, Any]:
    """Build the home feed. Works for guests (customer_id=None) too."""
    client = get_mobile_client()
    name: Optional[str] = None
    verified = False
    dues = 0.0
    unread = 0
    if customer_id:
        prof = (
            client.table("customer_profiles")
            .select("first_name,verification_status")
            .eq("id", customer_id)
            .limit(1)
            .execute()
        )
        if prof.data:
            name = prof.data[0].get("first_name")
            verified = prof.data[0].get("verification_status") == "approved"
        pay = (
            client.table("customer_payments")
            .select("amount")
            .eq("customer_id", customer_id)
            .eq("status", "pending")
            .execute()
        )
        dues = sum(float(r.get("amount") or 0) for r in (pay.data or []))
        notif = (
            client.table("customer_notifications")
            .select("id", count="exact")
            .eq("customer_id", customer_id)
            .eq("is_read", False)
            .limit(1)
            .execute()
        )
        unread = notif.count or 0

    products = marketplace_service.list_products(page=1, page_size=6)
    items = products.get("items", [])
    featured = items[:4]
    value_picks = [p for p in items if (p.get("discount_pct") or 0) > 0][:4]
    managers = list({p["manager"].get("id"): p["manager"] for p in items if p.get("manager", {}).get("id")}.values())[:4]

    return {
        "greeting": _greeting(),
        "customer_name": name,
        "is_verified": verified,
        "featured": featured,
        "nearby_managers": managers,
        "value_picks": value_picks,
        "pending_dues": dues,
        "unread_notifications": unread,
    }
