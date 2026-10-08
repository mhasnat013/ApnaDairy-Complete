"""Payment request/response schemas.

customer_payments (mobile project): id UUID, order_id UUID, customer_id UUID,
amount NUMERIC, method TEXT, status TEXT, receipt_path TEXT,
verified_by TEXT, created_at.
"""
from typing import List, Literal, Optional

from pydantic import BaseModel

PaymentMethod = Literal["cod", "bank_transfer", "test_card"]


class PaymentIn(BaseModel):
    order_id: str
    method: PaymentMethod


class PaymentOut(BaseModel):
    id: str
    order_id: str
    customer_id: str
    amount: float
    method: str
    status: str
    receipt_path: Optional[str] = None
    verified_by: Optional[str] = None
    created_at: Optional[str] = None
    # True when the payment was recorded while PAYMENTS_TEST_MODE=true
    # (dev/test only — never claim a real charge in this mode).
    test_mode: bool = False


class PaymentHistoryOut(BaseModel):
    id: str
    order_id: str
    order_total: Optional[float] = None
    customer_id: str
    amount: float
    method: str
    status: str
    receipt_path: Optional[str] = None
    created_at: Optional[str] = None


class DueOrder(BaseModel):
    order_id: str
    total_amount: float
    status: str


class DuesOut(BaseModel):
    unpaid_orders: List[DueOrder]
    total_dues: float
