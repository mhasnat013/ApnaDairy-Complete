// Checkout service — turns the cart into one order per area manager.
// Prices are calculated server-side; the client never sends a total.
// Pass an idempotency key to make retries safe (same key = same order).
import { b2cPost } from '../../api/b2cClient';
import type { CheckoutResult, PaymentMethod } from '../../types/customerModels';

export interface CheckoutInput {
  address_id: string;
  payment_method: PaymentMethod;
  note?: string;
}

/** Place the order. Returns one Order per area manager in the cart. */
export async function checkout(
  input: CheckoutInput,
  idempotencyKey?: string,
): Promise<CheckoutResult> {
  if (!input.address_id) throw new Error('Please select a delivery address.');
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  return b2cPost<CheckoutResult>('/api/v1/checkout/', input, headers);
}
