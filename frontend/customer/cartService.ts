// Cart service — one cart per customer (server resolves the cart row).
import { b2cGet, b2cPost, b2cPut, b2cDelete } from '../../api/b2cClient';
import type { Cart, CartItem } from '../../types/customerModels';

/** Current cart with totals. */
export async function getCart(): Promise<Cart> {
  return b2cGet<Cart>('/api/v1/cart/');
}

/** Add a product (quantity >= 1). */
export async function addToCart(productId: string, quantity: number): Promise<CartItem> {
  if (quantity < 1) throw new Error('Quantity must be at least 1.');
  return b2cPost<CartItem>('/api/v1/cart/items', { product_id: productId, quantity });
}

/**
 * Set an item's quantity. quantity == 0 deletes the item (server returns
 * 204, so this resolves to null).
 */
export async function updateCartItem(itemId: string, quantity: number): Promise<CartItem | null> {
  if (quantity < 0) throw new Error('Invalid quantity.');
  return b2cPut<CartItem | null>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`, {
    quantity,
  });
}

/** Remove an item from the cart. */
export async function removeCartItem(itemId: string): Promise<void> {
  await b2cDelete<void>(`/api/v1/cart/items/${encodeURIComponent(itemId)}`);
}

/** Empty the cart. */
export async function clearCart(): Promise<void> {
  await b2cDelete<void>('/api/v1/cart/');
}
