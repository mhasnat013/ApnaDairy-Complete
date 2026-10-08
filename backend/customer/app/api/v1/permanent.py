"""/permanent — permanent-customer subscription requests and ledger.

Only SuperAdmin-verified customers (customer_profiles.verification_status =
'approved') may request a permanent subscription. All data lives in the MOBILE
project; the WEB project is never touched here.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_current_customer
from app.schemas import permanent as schemas
from app.services import ledger_service, permanent_service

router = APIRouter(prefix="/permanent", tags=["permanent"])

_UNVERIFIED_MSG = "Only verified customers can request permanent subscription."


def _require_verified(customer_id: str) -> None:
    if permanent_service.get_verification_status(customer_id) != "approved":
        raise HTTPException(status_code=403, detail=_UNVERIFIED_MSG)


def _to_out(row: dict) -> schemas.PermanentRequestOut:
    plan = row.get("plan_details") or {}
    return schemas.PermanentRequestOut(
        id=str(row.get("id")),
        customer_id=str(row.get("customer_id")),
        cycle=row.get("cycle"),
        status=row.get("status"),
        start_date=row.get("start_date"),
        end_date=row.get("end_date"),
        daily_quantity_l=plan.get("daily_quantity_l") if isinstance(plan, dict) else None,
        rejection_reason=row.get("rejection_reason"),
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
    )


@router.post("/request", response_model=schemas.PermanentRequestOut, status_code=201)
def request_permanent(
    body: schemas.PermanentRequestIn,
    customer_id: str = Depends(get_current_customer),
):
    """Request a permanent subscription (15- or 30-day cycle), starting pending."""
    _require_verified(customer_id)
    if permanent_service.active_request(customer_id) is not None:
        raise HTTPException(
            status_code=409,
            detail="You already have an active permanent subscription request.",
        )
    row = permanent_service.create_request(
        customer_id, body.cycle, body.daily_quantity_l, body.start_date
    )
    return _to_out(row)


@router.get("/status")
def subscription_status(customer_id: str = Depends(get_current_customer)):
    """Latest subscription request, or {"status": "none"} when there is none."""
    row = permanent_service.latest_request(customer_id)
    return _to_out(row) if row else {"status": "none"}


def _own_request(request_id: str, customer_id: str) -> dict:
    row = permanent_service.get_request(request_id, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Subscription request not found.")
    return row


@router.post("/requests/{request_id}/pause", response_model=schemas.PermanentRequestOut)
def pause_request(request_id: str, customer_id: str = Depends(get_current_customer)):
    _require_verified(customer_id)
    row = _own_request(request_id, customer_id)
    if row.get("status") != "approved":
        raise HTTPException(
            status_code=409, detail="Only an approved request can be paused."
        )
    return _to_out(permanent_service.set_status(request_id, "paused"))


@router.post("/requests/{request_id}/resume", response_model=schemas.PermanentRequestOut)
def resume_request(request_id: str, customer_id: str = Depends(get_current_customer)):
    _require_verified(customer_id)
    row = _own_request(request_id, customer_id)
    if row.get("status") != "paused":
        raise HTTPException(
            status_code=409, detail="Only a paused request can be resumed."
        )
    return _to_out(permanent_service.set_status(request_id, "approved"))


@router.post("/requests/{request_id}/cancel", response_model=schemas.PermanentRequestOut)
def cancel_request(request_id: str, customer_id: str = Depends(get_current_customer)):
    _require_verified(customer_id)
    row = _own_request(request_id, customer_id)
    if row.get("status") not in ("pending", "approved", "paused"):
        raise HTTPException(
            status_code=409, detail="This request can no longer be cancelled."
        )
    return _to_out(permanent_service.set_status(request_id, "cancelled"))


@router.get("/ledger", response_model=schemas.LedgerOut)
def get_ledger(customer_id: str = Depends(get_current_customer)):
    """Own ledger entries newest-first plus the signed balance."""
    data = ledger_service.get_ledger(customer_id)
    return schemas.LedgerOut(
        entries=[
            schemas.LedgerEntryOut(
                id=str(e.get("id")),
                entry_type=e.get("entry_type"),
                amount=e.get("amount") or 0,
                ref=e.get("ref"),
                created_at=e.get("created_at"),
            )
            for e in data["entries"]
        ],
        balance=data["balance"],
    )
