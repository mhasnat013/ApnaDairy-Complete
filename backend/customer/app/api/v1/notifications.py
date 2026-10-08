"""/notifications — list, mark read, delete. All scoped to the caller."""

from fastapi import APIRouter, Depends, Query

from app.core.deps import get_current_customer
from app.schemas.notifications import (
    DeleteOut,
    NotificationListOut,
    NotificationOut,
    ReadAllOut,
)
from app.services import notification_service as svc

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/", response_model=NotificationListOut)
def list_notifications(
    unread_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    customer_id: str = Depends(get_current_customer),
) -> dict:
    return svc.list_notifications(customer_id, unread_only, page, page_size)


@router.post("/{notification_id}/read", response_model=NotificationOut)
def mark_read(
    notification_id: str,
    customer_id: str = Depends(get_current_customer),
) -> dict:
    return svc.mark_read(customer_id, notification_id)


@router.post("/read-all", response_model=ReadAllOut)
def mark_all_read(
    customer_id: str = Depends(get_current_customer),
) -> dict:
    return svc.mark_all_read(customer_id)


@router.delete("/{notification_id}", response_model=DeleteOut)
def delete_notification(
    notification_id: str,
    customer_id: str = Depends(get_current_customer),
) -> dict:
    return svc.delete_notification(customer_id, notification_id)
