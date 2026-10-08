// Address service — customer delivery addresses (customer-isolated server-side).
import { b2cGet, b2cPost, b2cPut, b2cDelete } from '../../api/b2cClient';
import type { Address, AddressInput } from '../../types/customerModels';

/** All addresses for the logged-in customer. */
export async function listAddresses(): Promise<Address[]> {
  return b2cGet<Address[]>('/api/v1/customer/addresses/');
}

/** Create a new address. */
export async function createAddress(input: AddressInput): Promise<Address> {
  if (!input.label.trim() || !input.recipient_name.trim() || !input.address_line.trim() || !input.city.trim()) {
    throw new Error('Please fill in all required address fields.');
  }
  return b2cPost<Address>('/api/v1/customer/addresses/', input);
}

/** Partial update of an address. */
export async function updateAddress(
  addressId: string,
  input: Partial<AddressInput>,
): Promise<Address> {
  return b2cPut<Address>(`/api/v1/customer/addresses/${encodeURIComponent(addressId)}`, input);
}

/** Delete an address. */
export async function deleteAddress(addressId: string): Promise<void> {
  await b2cDelete<void>(`/api/v1/customer/addresses/${encodeURIComponent(addressId)}`);
}

/** Mark an address as the default. */
export async function setDefaultAddress(addressId: string): Promise<Address> {
  return b2cPost<Address>(
    `/api/v1/customer/addresses/${encodeURIComponent(addressId)}/set-default`,
    {},
  );
}
