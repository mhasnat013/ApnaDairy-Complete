"""/verification — KYC submission, status, and private document upload."""
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.core.deps import get_current_customer
from app.schemas.verification import (
    DocType,
    DocumentUploadOut,
    VerificationStatusOut,
    VerificationSubmitIn,
)
from app.services import verification_service

router = APIRouter(prefix="/verification", tags=["verification"])


@router.post("/submit")
def submit_verification(
    payload: VerificationSubmitIn,
    customer_id: str = Depends(get_current_customer),
):
    if verification_service.has_active_submission(customer_id):
        raise HTTPException(
            status_code=409,
            detail="A verification submission is already under review.",
        )
    return verification_service.create_submission(
        customer_id, payload.model_dump(exclude_none=True)
    )


@router.get("/status", response_model=VerificationStatusOut)
def get_verification_status(customer_id: str = Depends(get_current_customer)):
    row = verification_service.latest_submission(customer_id)
    if row is None:
        return VerificationStatusOut(status="pending")
    return VerificationStatusOut(
        status=row.get("status", "pending"),
        rejection_reason=row.get("rejection_reason"),
        submitted_at=row.get("submitted_at"),
    )


@router.post("/documents", response_model=DocumentUploadOut)
def upload_document(
    file: Annotated[UploadFile, File()],
    doc_type: Annotated[DocType, Form()],
    customer_id: str = Depends(get_current_customer),
):
    try:
        contents = file.file.read()
        path = verification_service.store_document(
            customer_id, contents, file.filename or "document", doc_type
        )
    except HTTPException:
        raise
    except Exception as exc:
        if "not found" in str(exc).lower():
            raise HTTPException(
                status_code=503,
                detail="Document storage not configured yet.",
            ) from exc
        raise HTTPException(status_code=500, detail="Document upload failed.") from exc
    return DocumentUploadOut(path=path, doc_type=doc_type)
