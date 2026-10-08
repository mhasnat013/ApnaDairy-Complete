"""/cart — one cart per customer (cart_id = customer_id)."""
from fastapi import APIRouter, Depends, Response, status

from app.core.deps import get_current_customer
from app.schemas.cart import CartItemIn, CartItemOut, CartItemUpdate, CartOut
from app.services import cart_service

router = APIRouter(prefix="/cart", tags=["cart"])


@router.get("/", response_model=CartOut)
def read_cart(customer_id: str = Depends(get_current_customer)):
    return cart_service.get_cart(customer_id)


@router.post("/items", response_model=CartItemOut, status_code=status.HTTP_201_CREATED)
def add_cart_item(
    payload: CartItemIn,
    customer_id: str = Depends(get_current_customer),
):
    return cart_service.add_item(customer_id, payload.product_id, payload.quantity)


@router.put("/items/{item_id}")
def update_cart_item(
    item_id: str,
    payload: CartItemUpdate,
    customer_id: str = Depends(get_current_customer),
):
    updated = cart_service.update_item(customer_id, item_id, payload.quantity)
    if updated is None:  # quantity == 0: item deleted
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    return updated


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_cart_item(
    item_id: str,
    customer_id: str = Depends(get_current_customer),
):
    cart_service.delete_item(customer_id, item_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/", status_code=status.HTTP_204_NO_CONTENT)
def clear_cart(customer_id: str = Depends(get_current_customer)):
    cart_service.clear_cart(customer_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
