"""/customer/addresses — customer address book (default + list + CRUD)."""
from fastapi import APIRouter, Depends

from app.core.deps import get_current_customer
from app.schemas.addresses import AddressIn, AddressOut, AddressUpdate
from app.services import address_service

router = APIRouter(prefix="/customer/addresses", tags=["addresses"])


@router.get("/", response_model=list[AddressOut])
def list_addresses(customer_id: str = Depends(get_current_customer)):
    return address_service.list_addresses(customer_id)


@router.post("/", response_model=AddressOut, status_code=201)
def create_address(payload: AddressIn, customer_id: str = Depends(get_current_customer)):
    return address_service.create_address(customer_id, payload.model_dump())


@router.put("/{address_id}", response_model=AddressOut)
def update_address(address_id: str, payload: AddressUpdate, customer_id: str = Depends(get_current_customer)):
    return address_service.update_address(address_id, customer_id, payload.model_dump())


@router.delete("/{address_id}")
def delete_address(address_id: str, customer_id: str = Depends(get_current_customer)):
    return address_service.delete_address(address_id, customer_id)


@router.post("/{address_id}/set-default", response_model=AddressOut)
def set_default_address(address_id: str, customer_id: str = Depends(get_current_customer)):
    return address_service.set_default_address(address_id, customer_id)
