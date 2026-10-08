"""Complaint schemas: create payload, output row, customer message input."""

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

ComplaintCategory = Literal["quality", "rider", "order", "payment"]  # must match DB enum customer_complaint_category


class ComplaintIn(BaseModel):
    order_id: Optional[str] = None
    category: ComplaintCategory
    subject: str = Field(min_length=3)
    description: str = Field(min_length=10)


class ComplaintMessageIn(BaseModel):
    text: str = Field(min_length=1)


class ComplaintOut(BaseModel):
    id: str
    customer_id: str
    order_id: Optional[str] = None
    category: str
    subject: str
    description: str
    photo_path: Optional[str] = None
    status: str
    messages: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
