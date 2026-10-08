"""/orders — list own orders, detail (+ items + delivery timeline),
cancel, reorder."""
from typing import Optional

from fastapi import APIRouter, Depends, Query

from app.core.deps import get_current_customer
from app.schemas import orders as schemas
from app.services import order_service as svc

router = APIRouter(prefix="/orders", tags=["orders"])


@router.get("/", response_model=schemas.OrderListOut)
def list_orders(
    status: Optional[schemas.OrderStatus] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    customer_id: str = Depends(get_current_customer),
):
    return svc.list_orders(
        customer_id, status=status, page=page, page_size=page_size
    )


@router.get("/{order_id}", response_model=schemas.OrderOut)
def order_detail(
    order_id: str,
    customer_id: str = Depends(get_current_customer),
):
    return svc.get_order_detail(customer_id, order_id)


@router.post("/{order_id}/cancel", response_model=schemas.OrderOut)
def cancel_order(
    order_id: str,
    customer_id: str = Depends(get_current_customer),
):
    return svc.cancel_order(customer_id, order_id)


@router.post("/{order_id}/reorder", response_model=schemas.ReorderOut)
def reorder(
    order_id: str,
    customer_id: str = Depends(get_current_customer),
):
    return svc.reorder(customer_id, order_id)
