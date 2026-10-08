"""/checkout — place orders from the cart (one order per area manager).

POST /checkout/ {address_id, payment_method, note?}
Optional Idempotency-Key header: repeating a request with the same key
returns the already-created orders instead of duplicating them.
"""
from typing import Optional

from fastapi import APIRouter, Depends, Header

from app.core.deps import get_current_customer
from app.schemas.checkout import CheckoutIn, CheckoutOut
from app.services import order_service as svc

router = APIRouter(prefix="/checkout", tags=["checkout"])


@router.post("/", response_model=CheckoutOut)
def place_order(
    payload: CheckoutIn,
    customer_id: str = Depends(get_current_customer),
    idempotency_key: Optional[str] = Header(default=None),
):
    orders = svc.checkout(
        customer_id=customer_id,
        address_id=payload.address_id,
        payment_method=payload.payment_method,
        note=payload.note,
        idempotency_key=idempotency_key,
    )
    return CheckoutOut(orders=orders)
