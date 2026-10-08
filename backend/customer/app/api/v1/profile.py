"""/profile — get/update the authenticated customer's own profile.

Only first_name / last_name / phone may be changed here; protected fields
(email, role, verification_status, auth_user_id) are rejected with a 422.
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.deps import get_current_customer
from app.schemas.profile import ProfileOut, ProfileUpdate
from app.services import profile_service

router = APIRouter(prefix="/profile", tags=["profile"])


@router.get("/", response_model=ProfileOut)
def get_my_profile(customer_id: str = Depends(get_current_customer)):
    row = profile_service.get_profile(customer_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return row


@router.put("/", response_model=ProfileOut)
def update_my_profile(
    payload: ProfileUpdate,
    customer_id: str = Depends(get_current_customer),
):
    # extra="forbid" on ProfileUpdate already 422s on protected fields.
    row = profile_service.update_profile(
        customer_id, payload.model_dump(exclude_unset=True)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found.")
    return row
