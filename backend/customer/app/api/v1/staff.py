"""/staff — staff (web-admin) API: orders, payments, complaints, customers.

Every endpoint is gated by ``require_staff`` from ``app.core.deps``
(X-Staff-Key header == STAFF_API_KEY env; 401 missing, 403 wrong).
"""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.deps import require_staff
from app.schemas.staff import (
    AssignRiderIn,
    RespondComplaintIn,
    StaffOrderStatusIn,
    VerifyCustomerIn,
    VerifyPaymentIn,
)
from app.services import staff_service


router = APIRouter(
    prefix="/staff", tags=["staff"], dependencies=[Depends(require_staff)]
)


# ---------------------------------------------------------------- orders ----


@router.get("/orders")
def staff_list_orders(
    area_manager_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return staff_service.list_orders(area_manager_id, status, page, page_size)


@router.post("/orders/{order_id}/status")
def staff_set_order_status(order_id: str, body: StaffOrderStatusIn):
    return staff_service.set_order_status(order_id, body.status, body.note)


@router.post("/orders/{order_id}/assign-rider")
def staff_assign_rider(order_id: str, body: AssignRiderIn):
    return staff_service.assign_rider(
        order_id,
        body.rider_name,
        body.rider_phone,
        body.vehicle_label,
        body.vehicle_plate,
    )


# --------------------------------------------------------------- payments ----


@router.get("/payments")
def staff_list_payments(status: Optional[str] = Query(default=None)):
    return staff_service.list_payments(status)


@router.post("/payments/{payment_id}/verify")
def staff_verify_payment(payment_id: str, body: VerifyPaymentIn):
    return staff_service.verify_payment(payment_id, body.verified, body.note)


# ------------------------------------------------------------- complaints ----


@router.get("/complaints")
def staff_list_complaints(status: Optional[str] = Query(default=None)):
    return staff_service.list_complaints(status)


@router.post("/complaints/{complaint_id}/respond")
def staff_respond_complaint(complaint_id: str, body: RespondComplaintIn):
    return staff_service.respond_complaint(complaint_id, body.text, body.status)


# -------------------------------------------------------------- customers ----


@router.get("/customers")
def staff_list_customers(
    verification_status: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return staff_service.list_customers(verification_status, page, page_size)


@router.post("/customers/{customer_id}/verify")
def staff_verify_customer(customer_id: str, body: VerifyCustomerIn):
    return staff_service.verify_customer(
        customer_id, body.approved, body.rejection_reason, body.area_manager_id
    )
