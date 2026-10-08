"""/marketplace — product catalog (public, WEB project read-only) + wishlist (auth)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.deps import get_current_customer
from app.schemas import marketplace as schemas
from app.services import marketplace_service as svc

router = APIRouter(prefix="/marketplace", tags=["marketplace"])


@router.get("/products/", response_model=schemas.ProductListOut)
def list_products(
    category: Optional[str] = Query(default=None),
    milk_type: Optional[str] = Query(default=None),
    city: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    sort: str = Query(default="newest"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
):
    return svc.list_products(
        category=category,
        milk_type=milk_type,
        city=city,
        q=q,
        sort=sort,
        page=page,
        page_size=page_size,
    )


@router.get("/products/{product_id}", response_model=schemas.ProductOut)
def product_detail(product_id: str):
    product = svc.get_product(product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Product not found.")
    return product


@router.get("/wishlist/", response_model=schemas.WishlistOut)
def wishlist_list(customer_id: str = Depends(get_current_customer)):
    return svc.get_wishlist(customer_id)


@router.post("/wishlist/", response_model=schemas.WishlistItemOut)
def wishlist_add(
    body: schemas.WishlistAddIn,
    customer_id: str = Depends(get_current_customer),
):
    return svc.add_to_wishlist(customer_id, body.product_id)


@router.delete("/wishlist/{product_id}", status_code=204)
def wishlist_delete(
    product_id: str,
    customer_id: str = Depends(get_current_customer),
):
    svc.remove_from_wishlist(customer_id, product_id)
    return None
