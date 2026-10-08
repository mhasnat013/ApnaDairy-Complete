// Payment service — payment history, outstanding dues, and new payments.
// Bank transfer REQUIRES a receipt screenshot (multipart upload).
// test_card only works when the backend runs in test mode (honest demo).
import { b2cGet, b2cPostForm, type UploadFile } from '../../api/b2cClient';
import type { Dues, Payment, PaymentMethod } from '../../types/customerModels';

/** Payment history for the logged-in customer. */
export async function paymentHistory(): Promise<Payment[]> {
  return b2cGet<Payment[]>('/api/v1/payments/history');
}

/** Outstanding dues (unpaid orders + total). */
export async function paymentDues(): Promise<Dues> {
  return b2cGet<Dues>('/api/v1/payments/dues');
}

/** Detail of one payment. */
export async function getPayment(paymentId: string): Promise<Payment> {
  return b2cGet<Payment>(`/api/v1/payments/${encodeURIComponent(paymentId)}`);
}

/**
 * Record a payment for an order.
 * - cod: no receipt needed.
 * - bank_transfer: receipt screenshot REQUIRED.
 * - test_card: demo only, backend test mode must be on.
 */
export async function createPayment(
  orderId: string,
  method: PaymentMethod,
  receipt?: UploadFile,
): Promise<Payment> {
  if (method === 'bank_transfer' && !receipt) {
    throw new Error('A receipt screenshot is required for bank transfer.');
  }
  return b2cPostForm<Payment>(
    '/api/v1/payments/',
    { order_id: orderId, method },
    { receipt },
  );
}
