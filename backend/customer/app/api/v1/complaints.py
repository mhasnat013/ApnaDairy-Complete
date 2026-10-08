"""/complaints — create (category + optional photo), list, detail, messages.

Unverified users may complain about account issues only (enforced by the
client and staff triage; the API scope here is the caller's own rows).
"""

from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import ValidationError

from app.core.deps import get_current_customer
from app.schemas.complaints import ComplaintIn, ComplaintMessageIn, ComplaintOut
from app.services import complaint_service as svc

router = APIRouter(prefix="/complaints", tags=["complaints"])


@router.post("/", response_model=ComplaintOut, status_code=201)
async def create_complaint(
    order_id: Optional[str] = Form(None),
    category: str = Form(...),
    subject: str = Form(...),
    description: str = Form(...),
    photo: Optional[UploadFile] = File(None),
    customer_id: str = Depends(get_current_customer),
):
    try:
        payload = ComplaintIn(
            order_id=order_id or None,
            category=category,
            subject=subject,
            description=description,
        )
    except ValidationError as exc:
        first = exc.errors()[0]
        loc = ".".join(str(p) for p in first["loc"])
        raise HTTPException(
            status_code=422, detail=f"{loc}: {first['msg']}."
        )

    photo_bytes = await photo.read() if photo is not None else None
    row = svc.create_complaint(
        customer_id=customer_id,
        order_id=payload.order_id,
        category=payload.category,
        subject=payload.subject,
        description=payload.description,
        photo_bytes=photo_bytes,
        photo_content_type=photo.content_type if photo is not None else None,
    )
    return row


@router.get("/", response_model=List[ComplaintOut])
def list_complaints(
    status: Optional[str] = None,
    customer_id: str = Depends(get_current_customer),
):
    if status is not None and status not in svc.STATUSES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid status. Use one of: {', '.join(svc.STATUSES)}.",
        )
    return svc.list_complaints(customer_id, status=status)


@router.get("/{complaint_id}", response_model=ComplaintOut)
def complaint_detail(
    complaint_id: str,
    customer_id: str = Depends(get_current_customer),
):
    return svc.get_complaint(customer_id, complaint_id)


@router.post("/{complaint_id}/messages", response_model=List[Dict[str, Any]])
def post_message(
    complaint_id: str,
    body: ComplaintMessageIn,
    customer_id: str = Depends(get_current_customer),
):
    return svc.add_message(customer_id, complaint_id, body.text)
