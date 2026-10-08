"""/rider — active delivery for an order: rider card, live location, chat, rating."""
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_current_customer
from app.schemas.rider import DeliveryOut, MessageIn, RateIn, RiderInfo
from app.services import rider_service

router = APIRouter(prefix="/rider", tags=["rider"])


def _delivery_out(row: dict) -> DeliveryOut:
    """Build DeliveryOut defensively. Rider info is returned as null with an
    honest message when the rider is not assigned yet — never fabricated."""
    if row.get("rider_name") or row.get("rider_id"):
        rider = RiderInfo(
            name=row.get("rider_name"),
            phone=row.get("rider_phone"),
            rating=row.get("rider_rating"),
            photo_path=row.get("rider_photo_path"),
            vehicle_label=row.get("vehicle_label"),
            vehicle_plate=row.get("vehicle_plate"),
        )
        message = None
    else:
        rider = None
        message = "Rider not assigned yet."
    return DeliveryOut(
        delivery_id=str(row.get("id")),
        order_id=str(row.get("order_id")),
        status=row.get("status"),
        rider=rider,
        message=message,
        live={"latitude": row.get("current_latitude"), "longitude": row.get("current_longitude")},
        messages=row.get("messages") if isinstance(row.get("messages"), list) else [],
        events=row.get("events") if isinstance(row.get("events"), list) else [],
    )


@router.get("/order/{order_id}", response_model=DeliveryOut)
def delivery_for_order(order_id: str, customer_id: str = Depends(get_current_customer)):
    row = rider_service.get_latest_delivery_for_order(order_id, customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Delivery not found for this order.")
    return _delivery_out(row)


@router.post("/deliveries/{delivery_id}/message")
def send_message(
    delivery_id: str,
    payload: MessageIn,
    customer_id: str = Depends(get_current_customer),
):
    messages = rider_service.append_customer_message(delivery_id, customer_id, payload.text)
    if messages is None:
        raise HTTPException(status_code=404, detail="Delivery not found.")
    return {"messages": messages}


@router.post("/deliveries/{delivery_id}/rate")
def rate_delivery(
    delivery_id: str,
    payload: RateIn,
    customer_id: str = Depends(get_current_customer),
):
    try:
        row = rider_service.rate_delivery(delivery_id, customer_id, payload.rating, payload.comment)
    except ValueError as exc:
        if str(exc) == "not_delivered":
            raise HTTPException(
                status_code=422,
                detail="Delivery can only be rated after it is delivered.",
            )
        raise
    if row is None:
        raise HTTPException(status_code=404, detail="Delivery not found.")
    return {"ok": True}
