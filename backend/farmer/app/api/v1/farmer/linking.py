# ApnaDairy — v2 farmer<->manager linking HTTP router (farmer side).
# Thin layer: current_farmer dependency -> service call -> validated response.
# The farmer's identity ALWAYS comes from the auth token (profiles.id via
# current_farmer), never from the request body. Route paths are the locked
# v2 contract: /api/v1/farmer/cities, /api/v1/farmer/managers?city=,
# /api/v1/farmer/manager-request (POST/GET/DELETE).

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import current_farmer
from app.schemas.farmer.linking import (
    CityManagerOut,
    CityOut,
    ManagerRequestCreate,
    ManagerRequestOut,
)
from app.services.farmer import linking_service
from app.services.farmer.linking_service import (
    AlreadyLinkedError,
    DuplicateRequestError,
    ManagerNotFoundError,
    NoPendingRequestError,
)

router = APIRouter(prefix="/api/v1/farmer", tags=["farmer-linking"])


def _farmer_profile_id(ctx: tuple) -> str:
    """Extract the caller's profiles.id from the current_farmer tuple.

    current_farmer returns (profile, farmer_profile, farmer_row); the
    dependency itself raises 401/403, so reaching here means authenticated.
    """
    profile, _farmer_profile, _farmer_row = ctx
    if not profile or not profile.get("id"):
        raise HTTPException(status_code=403, detail="Farmer profile not found.")
    return profile["id"]


@router.get("/cities", response_model=list[CityOut])
def read_cities(ctx: tuple = Depends(current_farmer)) -> list[dict]:
    """List all major Pakistani cities with area-manager counts (sorted)."""
    _farmer_profile_id(ctx)  # auth gate
    return linking_service.list_cities()


@router.get("/managers", response_model=list[CityManagerOut])
def read_managers_by_city(
    city: str | None = Query(default=None),
    ctx: tuple = Depends(current_farmer),
) -> list[CityManagerOut]:
    """List area managers in a city (case-insensitive). City is required."""
    _farmer_profile_id(ctx)  # auth gate
    if not city or not city.strip():
        raise HTTPException(
            status_code=400, detail="Query parameter 'city' is required."
        )
    return linking_service.list_managers_by_city(city)


@router.post("/manager-request", response_model=ManagerRequestOut, status_code=201)
def create_manager_request(
    data: ManagerRequestCreate, ctx: tuple = Depends(current_farmer)
) -> ManagerRequestOut:
    """Send a registration request to one area manager (exclusive)."""
    farmer_profile_id = _farmer_profile_id(ctx)
    try:
        return linking_service.create_manager_request(
            farmer_profile_id, data.area_manager_id.strip(), data.note
        )
    except ManagerNotFoundError:
        raise HTTPException(status_code=404, detail="Area manager not found.")
    except AlreadyLinkedError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    except DuplicateRequestError as exc:
        raise HTTPException(status_code=409, detail=str(exc))


@router.get("/manager-request", response_model=ManagerRequestOut | None)
def read_my_manager_request(
    ctx: tuple = Depends(current_farmer),
) -> ManagerRequestOut | None:
    """Return the farmer's latest registration request (any status), or null."""
    return linking_service.get_latest_request(_farmer_profile_id(ctx))


@router.delete("/manager-request", response_model=ManagerRequestOut)
def cancel_my_manager_request(
    ctx: tuple = Depends(current_farmer),
) -> ManagerRequestOut:
    """Cancel the farmer's own pending registration request."""
    try:
        return linking_service.cancel_manager_request(_farmer_profile_id(ctx))
    except NoPendingRequestError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
