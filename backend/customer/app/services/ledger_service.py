"""Permanent-customer ledger (MOBILE project: customer_ledger).

Sign convention: charges the customer OWES are stored as NEGATIVE amounts
(subscription_charge, adjustment). Payments the customer MAKES are stored as
POSITIVE amounts. balance = sum(amount), so a negative balance means the
customer still owes money; a zero/positive balance means dues are clear.
"""

from app.db.supabase_client import get_mobile_client

_LEDGER_TABLE = "customer_ledger"


def get_ledger(customer_id: str) -> dict:
    """Own ledger entries newest-first plus the signed balance."""
    res = (
        get_mobile_client()
        .table(_LEDGER_TABLE)
        .select("*")
        .eq("customer_id", customer_id)
        .order("created_at", desc=True)
        .execute()
    )
    entries = res.data or []
    balance = sum(float(e.get("amount") or 0) for e in entries)
    return {"entries": entries, "balance": balance}
