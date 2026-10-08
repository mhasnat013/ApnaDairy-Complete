"""Permanent-customer subscription requests (MOBILE project).

Reads customer_profiles for the SuperAdmin-verification gate and
customer_permanent_requests for the request lifecycle.
All reads/writes go to the MOBILE project; the WEB project is never touched.
"""
from datetime import date, datetime, timedelta, timezone

from app.db.supabase_client import get_mobile_client

_REQUESTS_TABLE = "customer_permanent_requests"
_PROFILES_TABLE = "customer_profiles"

# A request in any of these statuses blocks a new request.
ACTIVE_STATUSES = ("pending", "approved", "paused")


def _requests():
    return get_mobile_client().table(_REQUESTS_TABLE)


def get_verification_status(customer_id: str) -> str | None:
    """verification_status from customer_profiles, or None when no profile row."""
    res = (
        get_mobile_client()
        .table(_PROFILES_TABLE)
        .select("verification_status")
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0].get("verification_status") if rows else None


def get_request(request_id: str, customer_id: str) -> dict | None:
    """Own request row, or None when it does not exist / belongs to someone else."""
    res = (
        _requests()
        .select("*")
        .eq("id", request_id)
        .eq("customer_id", customer_id)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def latest_request(customer_id: str) -> dict | None:
    """Newest request of the customer, or None when the customer has none."""
    res = (
        _requests()
        .select("*")
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def active_request(customer_id: str) -> dict | None:
    """The caller's request with status in (pending, approved, paused), or None."""
    res = (
        _requests()
        .select("*")
        .eq("customer_id", customer_id)
        .in_("status", list(ACTIVE_STATUSES))
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None


def create_request(
    customer_id: str, cycle: str, daily_quantity_l: float, start_date: date
) -> dict:
    """Insert a pending request. end_date = start_date + cycle days."""
    end_date = start_date + timedelta(days=int(cycle))
    payload = {
        "customer_id": customer_id,
        "cycle": cycle,
        "status": "pending",
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "plan_details": {"daily_quantity_l": daily_quantity_l},
    }
    res = _requests().insert(payload).execute()
    rows = res.data or []
    return rows[0] if rows else payload


def set_status(request_id: str, status: str) -> dict | None:
    """Transition a request to a new status; returns the updated row or None."""
    res = (
        _requests()
        .update({"status": status, "updated_at": datetime.now(timezone.utc).isoformat()})
        .eq("id", request_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else None
