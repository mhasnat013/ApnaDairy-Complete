// Customer order service — typed wrappers over the B2C API.
// Shapes mirror backend schemas/orders.py. customer_id is derived
// server-side from the JWT; the client never sends it.
import { b2cGet, b2cPost, qs } from '../../api/b2cClient';
import type {
  Address,
  Cart,
  CheckoutResult,
  Order,
  OrderItem,
  OrderList,
  OrderStatus,
  PaymentMethod,
  ReorderResult,
  TimelineEvent,
} from '../../types/customerModels';

export type { Order, OrderItem, OrderList, OrderStatus, ReorderResult, TimelineEvent };

export interface RiderInfo {
  name: string | null;
  phone: string | null;
  rating: number | null;
  vehicle_label: string | null;
  vehicle_plate: string | null;
}

export interface Delivery {
  delivery_id: string;
  order_id: string;
  status: string | null;
  rider: RiderInfo | null;
  message: string | null;
  live: { latitude: number | null; longitude: number | null };
  messages: Array<{ from: string; text: string; created_at: string }>;
  events: TimelineEvent[];
}

/** Random UUID v4 for the Idempotency-Key header (one per checkout attempt). */
export function newIdempotencyKey(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Paginated orders, optionally filtered by status. */
export async function listOrders(
  status?: OrderStatus,
  page = 1,
  pageSize = 20,
): Promise<OrderList> {
  return b2cGet<OrderList>('/api/v1/orders/' + qs({ status, page, page_size: pageSize }));
}

/** Order detail with items + delivery timeline. */
export async function getOrder(orderId: string): Promise<Order> {
  return b2cGet<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}`);
}

/** Cancel an order (only pending/accepted). */
export async function cancelOrder(orderId: string): Promise<Order> {
  return b2cPost<Order>(`/api/v1/orders/${encodeURIComponent(orderId)}/cancel`, {});
}

/** Copy a previous order's items back into the cart. */
export async function reorder(orderId: string): Promise<ReorderResult> {
  return b2cPost<ReorderResult>(`/api/v1/orders/${encodeURIComponent(orderId)}/reorder`, {});
}

/** Delivery tracking: rider, live location, chat, timeline. */
export async function trackOrder(orderId: string): Promise<Delivery> {
  return b2cGet<Delivery>(`/api/v1/rider/order/${encodeURIComponent(orderId)}`);
}

/** Statuses the customer is allowed to cancel from (matches backend CANCELLABLE_STATUSES). */
export const CANCELLABLE = new Set<OrderStatus>(['pending', 'accepted']);

/** Short human label for an order status (no emojis). */
export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    pending: 'Pending',
    accepted: 'Accepted',
    preparing: 'Preparing',
    dispatched: 'Dispatched',
    delivered: 'Delivered',
    cancelled: 'Cancelled',
    rejected: 'Rejected',
  };
  return map[status] ?? status;
}

/** Chip color key for an order status. */
export function statusTone(status: string): 'warning' | 'info' | 'success' | 'danger' | 'muted' {
  switch (status) {
    case 'pending':
      return 'warning';
    case 'accepted':
    case 'preparing':
    case 'dispatched':
      return 'info';
    case 'delivered':
      return 'success';
    case 'cancelled':
    case 'rejected':
      return 'danger';
    default:
      return 'muted';
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases — existing customer screens import these names.
// New code should use listOrders/getOrder/trackOrder/checkout/addressService.
// ---------------------------------------------------------------------------

/** @deprecated Use listAddresses() from addressService. */
export async function fetchAddresses(): Promise<Address[]> {
  const { listAddresses } = await import('./addressService');
  return listAddresses();
}

/** Cart summary shape used by the checkout screen. */
export interface CartSummary {
  items: Array<{ product_name: string; quantity: number; line_total: number }>;
  total_items: number;
  total_amount: number;
}

/** @deprecated Use getCart() from cartService. */
export async function fetchCartSummary(): Promise<CartSummary> {
  const { getCart } = await import('./cartService');
  const cart: Cart = await getCart();
  return {
    items: cart.items.map((i) => ({
      product_name: i.product_name,
      quantity: i.quantity,
      line_total: i.line_total,
    })),
    total_items: cart.total_items,
    total_amount: cart.total_amount,
  };
}

export type { PaymentMethod };

/** @deprecated Use checkout() from checkoutService. */
export async function placeOrder(
  addressId: string,
  paymentMethod: PaymentMethod,
  note?: string,
): Promise<CheckoutResult> {
  const { checkout } = await import('./checkoutService');
  return checkout({ address_id: addressId, payment_method: paymentMethod, note });
}

/** @deprecated Use listOrders() — this returns the orders array directly. */
export async function fetchOrders(status?: OrderStatus): Promise<Order[]> {
  const res = await listOrders(status);
  return res.orders;
}

/** @deprecated Use getOrder(). */
export const fetchOrderDetail = getOrder;

/** @deprecated Use trackOrder(). */
export const fetchDelivery = trackOrder;
