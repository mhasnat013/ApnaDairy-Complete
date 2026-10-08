"""Order schemas: order cards, detail (items + delivery timeline), cancel, reorder.

Binds to the real mobile tables:
- customer_orders: id, customer_id, area_manager_id, address_id, status,
  customer_checkout (JSON), total_amount, currency, web_order_id,
  created_at, updated_at
- customer_order_items: id, order_id, product_id, product_name,
  quantity, unit_price
- customer_deliveries: id, order_id, customer_id, ..., events (JSON), status

Statuses: pending, confirmed, approved, packed, out_for_delivery,
delivered, cancelled, rejected.
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

OrderStatus = Literal[
    "pending",
    "accepted",
    "preparing",
    "dispatched",
    "delivered",
    "cancelled",
    "rejected",
]


class OrderItemOut(BaseModel):
    id: str
    order_id: str
    product_id: str
    product_name: str = ""
    quantity: int = 0
    unit_price: float = 0.0
    line_total: float = 0.0


class TimelineEvent(BaseModel):
    """One entry of a delivery timeline (from customer_deliveries.events JSON).

    Parsed defensively: plain strings become the message; dicts keep
    whatever keys they carry (type / message / created_at).
    """

    type: str = ""
    message: str = ""
    created_at: Optional[str] = None


class OrderOut(BaseModel):
    id: str
    customer_id: str
    area_manager_id: str
    address_id: str
    status: str = "pending"
    payment_method: str = ""
    note: Optional[str] = None
    total_amount: float = 0.0
    currency: str = "PKR"
    created_at: Optional[str] = None
    items: list[OrderItemOut] = Field(default_factory=list)
    timeline: list[TimelineEvent] = Field(default_factory=list)


class OrderListOut(BaseModel):
    orders: list[OrderOut]
    page: int
    page_size: int
    total: int


class ReorderOut(BaseModel):
    """Result of copying an order's items back into the caller's cart.

    added_items = total quantity copied; total_amount = value of the
    copied lines (unit_price * quantity each).
    """

    added_items: int
    total_amount: float
