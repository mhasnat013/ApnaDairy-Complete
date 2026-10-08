// ApnaDairy — shared customer (B2C) domain types.
// Mirrors backend/customer/app/schemas/*.py. Single source of truth for
// customer screens and services; services re-export from here.

export interface ManagerOut {
  id?: string | null;
  center_name?: string | null;
  city?: string | null;
  phone?: string | null;
}

export interface Product {
  id?: string | null;
  name?: string | null;
  category?: string | null;
  milk_type?: string | null;
  unit?: string | null;
  price?: number | null;
  discount_pct?: number | null;
  final_price?: number | null;
  stock_qty?: number | null;
  made_on?: string | null;
  expires_on?: string | null;
  freshness_days?: number | null;
  is_available?: boolean | null;
  description?: string | null;
  image_url?: string | null;
  manager?: ManagerOut | null;
}

export interface ProductList {
  items: Product[];
  total: number;
  page: number;
  page_size: number;
}

export interface WishlistItem {
  id: string;
  product_id: string;
  product?: Product | null;
  created_at?: string | null;
}

export interface CartItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface Cart {
  items: CartItem[];
  total_items: number;
  total_amount: number;
}

export type PaymentMethod = 'cod' | 'bank_transfer' | 'card' | string;

export interface CheckoutResult {
  order_id: string;
  total_amount: number;
  payment_method: PaymentMethod;
  status: string;
}

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'
  | string;

export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  line_total: number;
}

export interface TimelineEvent {
  at?: string | null;
  status: string;
  note?: string | null;
}

export interface Order {
  id: string;
  customer_id: string;
  area_manager_id: string;
  address_id: string;
  status: OrderStatus;
  payment_method: string;
  note?: string | null;
  total_amount: number;
  currency: string;
  created_at?: string | null;
  items: OrderItem[];
  timeline: TimelineEvent[];
}

export interface OrderList {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
}

export interface ReorderResult {
  order_id: string;
  total_amount: number;
}

export interface CustomerProfile {
  id: string;
  auth_user_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
  role: string;
  verification_status: string;
  area_manager_id?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface Address {
  id: string;
  customer_id: string;
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: boolean | null;
}

export interface AddressInput {
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  latitude?: number | null;
  longitude?: number | null;
  is_default?: boolean;
}

export interface Payment {
  id: string;
  order_id: string;
  order_total?: number | null;
  customer_id: string;
  amount: number;
  method: string;
  status: string;
  receipt_path?: string | null;
  created_at?: string | null;
}

export interface Dues {
  unpaid_orders: Array<{ order_id: string; total_amount: number; status: string }>;
  total_dues: number;
}

export type ComplaintCategory = 'quality' | 'rider' | 'order' | 'payment' | string;
export type ComplaintStatus = 'open' | 'in_review' | 'resolved' | 'closed' | string;

export interface ComplaintMessage {
  sender: string;
  text: string;
  created_at?: string;
}

export interface Complaint {
  id: string;
  customer_id: string;
  order_id?: string | null;
  category: string;
  subject: string;
  description: string;
  photo_path?: string | null;
  status: string;
  messages: ComplaintMessage[];
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CustomerNotification {
  id: string;
  customer_id: string;
  title: string;
  body?: string | null;
  kind: string;
  is_read: boolean;
  created_at?: string | null;
}

export interface NotificationList {
  items: CustomerNotification[];
  unread_count: number;
  page: number;
  page_size: number;
}

export interface HomeFeed {
  greeting?: string | null;
  banners?: Array<{ id: string; title: string; image_url?: string | null }> | null;
  categories?: string[] | null;
  featured?: Product[] | null;
  nearby_managers?: ManagerOut[] | null;
}
