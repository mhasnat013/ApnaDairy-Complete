"""Staff (web-admin) schemas: order status changes, rider assignment, payment
verification, complaint responses, customer verification."""
from typing import Optional

from pydantic import BaseModel, Field


class StaffOrderStatusIn(BaseModel):
    status: str = Field(..., description="Target order status.")
    note: Optional[str] = Field(default=None, description="Optional staff note.")


class AssignRiderIn(BaseModel):
    rider_name: str
    rider_phone: str
    vehicle_label: Optional[str] = None
    vehicle_plate: Optional[str] = None


class VerifyPaymentIn(BaseModel):
    verified: bool
    note: Optional[str] = None


class RespondComplaintIn(BaseModel):
    text: str
    status: Optional[str] = Field(
        default=None, description="open | in_review | resolved | rejected"
    )


class VerifyCustomerIn(BaseModel):
    approved: bool
    rejection_reason: Optional[str] = None
    area_manager_id: Optional[str] = None


class StaffOrderOut(BaseModel):
    id: str
    customer_id: Optional[str] = None
    area_manager_id: Optional[str] = None
    status: Optional[str] = None
    total_amount: Optional[float] = None
    currency: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class StaffPaymentOut(BaseModel):
    id: str
    order_id: Optional[str] = None
    customer_id: Optional[str] = None
    amount: Optional[float] = None
    method: Optional[str] = None
    status: Optional[str] = None
    receipt_path: Optional[str] = None
    verified_by: Optional[str] = None
    created_at: Optional[str] = None


class StaffComplaintOut(BaseModel):
    id: str
    customer_id: Optional[str] = None
    order_id: Optional[str] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class StaffCustomerOut(BaseModel):
    id: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    role: Optional[str] = None
    verification_status: Optional[str] = None
    area_manager_id: Optional[str] = None
    created_at: Optional[str] = None
