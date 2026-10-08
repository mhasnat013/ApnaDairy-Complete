// Customer rider service — delivery chat + rating over the B2C API.
// customer_id is derived server-side from the JWT; the client never sends it.
import { b2cPost } from '../../api/b2cClient';

export interface RiderMessage {
  from: string;
  text: string;
  created_at: string;
}

/** Append a customer message to the delivery chat thread. Returns the full thread. */
export async function sendRiderMessage(
  deliveryId: string,
  text: string,
): Promise<RiderMessage[]> {
  const res = await b2cPost<{ messages: RiderMessage[] }>(
    `/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}/message`,
    { text },
  );
  return res.messages ?? [];
}

/** Rate the delivery (only allowed after delivered, per backend). */
export async function rateDelivery(
  deliveryId: string,
  rating: number,
  comment?: string,
): Promise<void> {
  await b2cPost<{ ok: boolean }>(
    `/api/v1/rider/deliveries/${encodeURIComponent(deliveryId)}/rate`,
    { rating, comment: comment ?? null },
  );
}
