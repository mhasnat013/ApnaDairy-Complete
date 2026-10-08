"""/home — verified home feed + explore (unverified) feed + search."""
from typing import Optional

from fastapi import APIRouter, Depends

from app.core.deps import get_current_customer
from app.schemas import home as schemas
from app.services import home_service as svc

router = APIRouter(prefix="/home", tags=["home"])


@router.get("/feed/", response_model=schemas.HomeFeedOut)
def home_feed():
    """Public explore feed (no auth required)."""
    return svc.get_home_feed(None)


@router.get("/feed/me", response_model=schemas.HomeFeedOut)
def home_feed_me(customer_id: str = Depends(get_current_customer)):
    """Personalized home feed for the logged-in customer."""
    return svc.get_home_feed(customer_id)
