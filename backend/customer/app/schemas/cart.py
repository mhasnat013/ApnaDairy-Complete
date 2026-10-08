"""Cart schemas: add/update items and the cart response.

CONVENTION: cart_id = customer_id. There is no separate carts table; each
customer owns exactly one cart, keyed by their customer id in the
customer_cart_items table (mobile project).
"""

from pydantic import BaseModel, Field


class CartItemIn(BaseModel):
    product_id: str = Field(min_length=1)
    quantity: int = Field(ge=1)


class CartItemUpdate(BaseModel):
    # quantity == 0 is treated as "delete this item".
    quantity: int = Field(ge=0)


class CartItemOut(BaseModel):
    id: str
    product_id: str
    product_name: str
    quantity: int
    unit_price: float
    line_total: float


class CartOut(BaseModel):
    items: list[CartItemOut]
    total_items: int
    total_amount: float
