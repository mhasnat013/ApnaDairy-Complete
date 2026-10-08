"""Checkout schemas: place an order from the caller's cart.

Checkout always creates ONE customer_orders row PER area_manager
(never merged), reading the cart from mobile customer_cart_items and
the product names / manager mapping / prices from the WEB products
table (read-only).
"""

from typing import Literal, Optional

from pydantic import BaseModel, Field

from app.schemas.orders import OrderOut

PaymentMethod = Literal["cod", "bank_transfer", "test_card"]


class CheckoutIn(BaseModel):
    address_id: str = Field(min_length=1)
    payment_method: PaymentMethod
    note: Optional[str] = Field(default=None, max_length=500)


class CheckoutOut(BaseModel):
    orders: list[OrderOut]
