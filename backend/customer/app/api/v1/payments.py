"""/payments — COD, bank-transfer proof upload, demo card charge."""
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.deps import get_current_customer
from app.schemas.payments import DuesOut, DueOrder, PaymentHistoryOut, PaymentOut
from app.services import payment_service

router = APIRouter(prefix="/payments", tags=["payments"])

ALLOWED_METHODS = ("cod", "bank_transfer", "test_card")


@router.post("/", response_model=PaymentOut, status_code=201)
async def create_payment(
    order_id: str = Form(...),
    method: str = Form(...),
    receipt: Optional[UploadFile] = File(None),
    customer_id: str = Depends(get_current_customer),
):
    if method not in ALLOWED_METHODS:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid method. Use one of: {', '.join(ALLOWED_METHODS)}.",
        )

    client = payment_service.get_mobile_client()

    order = payment_service.get_order(client, order_id)
    if order is None or str(order.get("customer_id")) != customer_id:
        raise HTTPException(status_code=404, detail="Order not found.")

    if payment_service.get_active_payment_for_order(client, order_id):
        raise HTTPException(
            status_code=409, detail="A payment already exists for this order."
        )

    amount = float(order.get("total_amount") or 0)
    receipt_path: Optional[str] = None

    if method == "bank_transfer":
        if receipt is None:
            raise HTTPException(
                status_code=422,
                detail="Receipt screenshot is required for bank transfer.",
            )

    if method == "test_card":
        # DEV ONLY: no real card processing exists in this build.
        if not payment_service.test_mode_enabled():
            raise HTTPException(
                status_code=403, detail="Card payments are disabled."
            )
        status = "paid"
    elif method == "bank_transfer":
        status = "submitted"  # staff verifies the screenshot later
    else:  # cod
        status = "pending"  # cash collected on delivery, staff verifies later

    # Create the payment row with a client-generated id so the receipt upload
    # path ({customer_id}/{payment_id}.jpg) is known before inserting.
    import uuid as _uuid

    payment_id = str(_uuid.uuid4())
    if method == "bank_transfer":
        contents = await receipt.read()
        receipt_path = payment_service.upload_receipt(
            client, customer_id, payment_id, contents, receipt.content_type
        )

    row = payment_service.create_payment(
        client,
        order_id=str(order.get("id")),
        customer_id=customer_id,
        amount=amount,
        method=method,
        status=status,
        receipt_path=receipt_path,
        payment_id=payment_id,
    )
    row["test_mode"] = payment_service.test_mode_enabled()
    return row


@router.get("/history", response_model=List[PaymentHistoryOut])
def payment_history(customer_id: str = Depends(get_current_customer)):
    client = payment_service.get_mobile_client()
    payments = payment_service.list_payments(client, customer_id)
    orders = payment_service.list_customer_orders(client, customer_id)
    totals = {str(o.get("id")): float(o.get("total_amount") or 0) for o in orders}
    return [
        {
            "id": str(p.get("id")),
            "order_id": str(p.get("order_id")),
            "order_total": totals.get(str(p.get("order_id"))),
            "customer_id": str(p.get("customer_id")),
            "amount": float(p.get("amount") or 0),
            "method": str(p.get("method")),
            "status": str(p.get("status")),
            "receipt_path": p.get("receipt_path"),
            "created_at": p.get("created_at"),
        }
        for p in payments
    ]


@router.get("/dues", response_model=DuesOut)
def payment_dues(customer_id: str = Depends(get_current_customer)):
    client = payment_service.get_mobile_client()
    unpaid, total = payment_service.compute_dues(client, customer_id)
    return {"unpaid_orders": [DueOrder(**o) for o in unpaid], "total_dues": total}


@router.get("/{payment_id}", response_model=PaymentOut)
def payment_detail(
    payment_id: str, customer_id: str = Depends(get_current_customer)
):
    client = payment_service.get_mobile_client()
    payment = payment_service.get_payment(client, payment_id)
    if payment is None or str(payment.get("customer_id")) != customer_id:
        raise HTTPException(status_code=404, detail="Payment not found.")
    return payment
