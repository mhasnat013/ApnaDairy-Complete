"""Marketplace schemas: public product browsing + customer wishlist."""
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ManagerOut(BaseModel):
    id: Optional[str] = None
    center_name: Optional[str] = None
    city: Optional[str] = None


class ProductOut(BaseModel):
    id: Optional[str] = None
    name: Optional[str] = None
    category: Optional[str] = None
    milk_type: Optional[str] = None
    unit: Optional[str] = None
    price: Optional[float] = None
    discount_pct: Optional[float] = None
    final_price: Optional[float] = None
    stock_qty: Optional[float] = None
    made_on: Optional[str] = None
    expires_on: Optional[str] = None
    freshness_days: Optional[int] = None
    is_available: Optional[bool] = None
    description: Optional[str] = None
    manager: ManagerOut = Field(default_factory=ManagerOut)


class ProductListOut(BaseModel):
    items: List[ProductOut] = []
    page: int = 1
    page_size: int = 20
    total: int = 0


class WishlistAddIn(BaseModel):
    product_id: str


class WishlistItemOut(BaseModel):
    product_id: str
    created_at: Optional[str] = None
    added: bool = True
    product: Optional[Dict[str, Any]] = None


class WishlistOut(BaseModel):
    items: List[WishlistItemOut] = []
