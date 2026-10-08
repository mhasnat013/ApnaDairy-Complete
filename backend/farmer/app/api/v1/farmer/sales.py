"""ApnaDairy — manager-driven daily sale HTTP endpoints.

Thin layer only: parse input, take identity from the auth token (NEVER the
body), call sales_service, map service errors to HTTP codes. All ownership
and state rules live in the service.

Manager-only: POST /start, POST /{id}/iot-result, POST /{id}/offer.
Farmer-only:  POST /{id}/accept, POST /{id}/refuse.
Both:         GET / (farmer sees his own sales, manager sees the center's).
"""

from fastapi import APIRouter, Depends, Header, HTTPException

from app.core.deps import current_farmer, current_manager
from app.schemas.farmer.sales import (
    AcceptResponse,
    IoTResultRequest,
    IoTResultResponse,
    OfferSummary,
    RefuseRequest,
    RefuseResponse,
    SaleListItem,
    SaleStartRequest,
    SaleStartResponse,
)
from app.services.farmer import sales_service

router = APIRouter(prefix="/api/v1/farmer/sales", tags=["Farmer — Sales"])


def _service_error(exc: ValueError) -> HTTPException:
    """Map service ValueErrors to HTTP codes (404 missing, 403 forbidden, 400 rest)."""
    message = str(exc)
    lowered = message.lower()
    if "not found" in lowered:
        return HTTPException(status_code=404, detail=message)
    if "forbidden" in lowered or "not allowed" in lowered or "not linked" in lowered:
        return HTTPException(status_code=403, detail=message)
    return HTTPException(status_code=400, detail=message)


def _optional_farmer(
    authorization: str | None = Header(None),
) -> tuple | None:
    """current_farmer that returns None instead of raising.

    Lets GET /sales serve both roles from one endpoint; tests override this
    (or current_farmer) via dependency_overrides.
    """
    try:
        return current_farmer(authorization=authorization)
    except HTTPException:
        return None


def _optional_manager(
    authorization: str | None = Header(None),
) -> tuple | None:
    """current_manager that returns None instead of raising (see _optional_farmer)."""
    try:
        return current_manager(authorization=authorization)
    except HTTPException:
        return None


def _sales_viewer(
    farmer_ctx: tuple | None = Depends(_optional_farmer),
    manager_ctx: tuple | None = Depends(_optional_manager),
) -> tuple[str, str]:
    """Resolve the caller for GET /sales: ("farmer", farmers.id) or ("manager", center id).

    Tries the farmer identity first, then the manager identity; 401 when
    neither resolves.
    """
    if farmer_ctx is not None:
        _profile, _farmer_profile, farmer_row = farmer_ctx
        if farmer_row is not None:
            return ("farmer", farmer_row["id"])
        # Authenticated farmer, but no manager has accepted the registration
        # yet. This is NOT an auth failure — return an empty list instead of
        # 401 (which would log the user out of the app).
        return ("none", "")
    if manager_ctx is not None:
        _profile, center = manager_ctx
        return ("manager", center["id"])
    raise HTTPException(status_code=401, detail="Login required.")


def _farmer_identity(ctx) -> tuple[str, str | None]:
    """Extract (farmers.id, profiles.id) from the current_farmer tuple.

    403 when the caller has no farmers row yet (manager has not accepted
    the registration, so there is nothing to sell).
    """
    profile, _farmer_profile, farmer_row = ctx
    if farmer_row is None:
        raise HTTPException(
            status_code=403,
            detail="No farmer record yet. Ask your area manager to accept "
            "your registration first.",
        )
    caller_profile_id = profile["id"] if profile else farmer_row.get("profile_id")
    return farmer_row["id"], caller_profile_id


@router.post("/start", response_model=SaleStartResponse)
def start_sale(
    payload: SaleStartRequest, ctx=Depends(current_manager)
) -> dict:
    """Manager starts a daily sale for one of his linked farmers."""
    _profile, center = ctx
    try:
        return sales_service.start_sale(center["id"], payload.farmer_id, payload.quantity_l)
    except ValueError as exc:
        raise _service_error(exc)


@router.post("/{sale_id}/iot-result", response_model=IoTResultResponse)
def record_iot_result(
    sale_id: str, payload: IoTResultRequest, ctx=Depends(current_manager)
) -> dict:
    """Manager posts IoT readings; returns freshness score + AI price."""
    _profile, center = ctx
    try:
        return sales_service.record_iot_result(
            center["id"],
            sale_id,
            payload.temperature_c,
            payload.ph,
            payload.tds_ppm,
            payload.ec_ms,
        )
    except ValueError as exc:
        raise _service_error(exc)


@router.post("/{sale_id}/offer", response_model=OfferSummary)
def send_offer(sale_id: str, ctx=Depends(current_manager)) -> dict:
    """Manager sends the offer (idempotent: re-validates and returns the summary)."""
    _profile, center = ctx
    try:
        return sales_service.get_offer_summary(center["id"], sale_id)
    except ValueError as exc:
        raise _service_error(exc)


@router.post("/{sale_id}/accept", response_model=AcceptResponse)
def accept_sale(sale_id: str, ctx=Depends(current_farmer)) -> dict:
    """Farmer accepts the offer; returns the receipt number and total."""
    farmer_id, caller_profile_id = _farmer_identity(ctx)
    try:
        return sales_service.accept_sale(farmer_id, sale_id, caller_profile_id)
    except ValueError as exc:
        raise _service_error(exc)


@router.post("/{sale_id}/refuse", response_model=RefuseResponse)
def refuse_sale(
    sale_id: str, payload: RefuseRequest, ctx=Depends(current_farmer)
) -> dict:
    """Farmer refuses the offer with an optional reason."""
    farmer_id, caller_profile_id = _farmer_identity(ctx)
    try:
        return sales_service.refuse_sale(
            farmer_id, sale_id, payload.reason, caller_profile_id
        )
    except ValueError as exc:
        raise _service_error(exc)


@router.get("/", response_model=list[SaleListItem])
def list_sales(viewer=Depends(_sales_viewer)) -> list[dict]:
    """Sales history: the farmer's own sales, or the manager's center sales."""
    role, ident = viewer
    if role == "none":
        return []
    try:
        if role == "farmer":
            return sales_service.list_sales_for_farmer(ident)
        return sales_service.list_sales_for_center(ident)
    except ValueError as exc:
        raise _service_error(exc)
