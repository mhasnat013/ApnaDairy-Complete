# ApnaDairy — farmer profile endpoints. farmer_id ALWAYS comes from the auth
# dependency (the verified token), never from the request body, so a farmer can
# only read/update their own profile.

from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import current_farmer, require_web_farmer_id
from app.schemas.farmer.profile import FarmUpdate, PersonalUpdate, ProfileOut
from app.services.farmer import profile_service

router = APIRouter(prefix="/api/v1/farmer/profile", tags=["farmer-profile"])


@router.get("/", response_model=ProfileOut)
def read_own_profile(ctx: tuple = Depends(current_farmer)) -> ProfileOut:
    """Return the calling farmer's own profile.

    New users have no `farmers` row yet (manager hasn't accepted the
    registration). Fall back to the basic `profiles` row so the Profile
    tab works from day one instead of 404ing.
    """
    profile, _farmer_profile, _farmer_row = ctx
    try:
        return profile_service.get_profile(require_web_farmer_id(ctx))
    except (KeyError, HTTPException):
        if not profile or not profile.get("id"):
            raise HTTPException(status_code=404, detail="Farmer profile not found")
        return ProfileOut(
            id=profile["id"],
            name=profile.get("full_name") or "",
            phone=profile.get("phone") or "",
            email=profile.get("email"),
            verification_status="INCOMPLETE",
            role="farmer",
        )


# RULE: profile edits write farmer-safe fields only (name/phone/village/farm_name
# on the portal side). The web `farmers` registry columns are READ-ONLY here and
# are written only via the onboarding/verification flow, never from these endpoints.
@router.put("/personal", response_model=ProfileOut)
def update_personal(data: PersonalUpdate, ctx: tuple = Depends(current_farmer)) -> ProfileOut:
    """Partially update the calling farmer's name/phone."""
    try:
        return profile_service.update_personal(require_web_farmer_id(ctx), data)
    except KeyError:
        raise HTTPException(status_code=404, detail="Farmer profile not found")


@router.put("/farm", response_model=ProfileOut)
def update_farm(data: FarmUpdate, ctx: tuple = Depends(current_farmer)) -> ProfileOut:
    """Partially update the calling farmer's farm details."""
    try:
        return profile_service.update_farm(require_web_farmer_id(ctx), data)
    except KeyError:
        raise HTTPException(status_code=404, detail="Farmer profile not found")
