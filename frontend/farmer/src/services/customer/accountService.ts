// Customer account services: profile, addresses, payments, complaints,
// notifications, verification. Thin wrappers over src/api/b2cClient —
// the Supabase access token is attached automatically from the session store.
import { b2cDelete, b2cGet, b2cPost, b2cPostForm, b2cPut, type UploadFile } from '../../api/b2cClient';

// ---------- profile ----------

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

export function getProfile(): Promise<CustomerProfile> {
  return b2cGet<CustomerProfile>('/api/v1/profile/');
}

export function updateProfile(data: { first_name?: string; last_name?: string; phone?: string }): Promise<CustomerProfile> {
  return b2cPut<CustomerProfile>('/api/v1/profile/', data);
}

// ---------- addresses ----------

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

export interface AddressForm {
  label: string;
  recipient_name: string;
  phone: string;
  address_line: string;
  city: string;
  is_default?: boolean;
}

export function listAddresses(): Promise<Address[]> {
  return b2cGet<Address[]>('/api/v1/customer/addresses/');
}

export function createAddress(data: AddressForm): Promise<Address> {
  return b2cPost<Address>('/api/v1/customer/addresses/', data);
}

export function updateAddress(id: string, data: Partial<AddressForm>): Promise<Address> {
  return b2cPut<Address>(`/api/v1/customer/addresses/${id}`, data);
}

export function deleteAddress(id: string): Promise<void> {
  return b2cDelete<void>(`/api/v1/customer/addresses/${id}`);
}

export function setDefaultAddress(id: string): Promise<Address> {
  return b2cPost<Address>(`/api/v1/customer/addresses/${id}/set-default`, {});
}

// ---------- payments ----------

export interface PaymentRecord {
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

export function paymentHistory(): Promise<PaymentRecord[]> {
  return b2cGet<PaymentRecord[]>('/api/v1/payments/history');
}

export function paymentDues(): Promise<Dues> {
  return b2cGet<Dues>('/api/v1/payments/dues');
}

// ---------- complaints ----------

export type ComplaintCategory = 'quality' | 'rider' | 'order' | 'payment'; // must match DB enum customer_complaint_category

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

export function listComplaints(): Promise<Complaint[]> {
  return b2cGet<Complaint[]>('/api/v1/complaints/');
}

export function getComplaint(id: string): Promise<Complaint> {
  return b2cGet<Complaint>(`/api/v1/complaints/${id}`);
}

export function createComplaint(
  data: { order_id?: string; category: ComplaintCategory; subject: string; description: string },
  photo?: UploadFile,
): Promise<Complaint> {
  return b2cPostForm<Complaint>(
    '/api/v1/complaints/',
    { order_id: data.order_id, category: data.category, subject: data.subject, description: data.description },
    { photo },
  );
}

export function postComplaintMessage(complaintId: string, text: string): Promise<ComplaintMessage[]> {
  return b2cPost<ComplaintMessage[]>(`/api/v1/complaints/${complaintId}/messages`, { text });
}

// ---------- notifications ----------

export interface AppNotification {
  id: string;
  customer_id: string;
  title: string;
  body?: string | null;
  kind: string;
  is_read: boolean;
  created_at?: string | null;
}

export interface NotificationList {
  items: AppNotification[];
  unread_count: number;
  page: number;
  page_size: number;
}

export function listNotifications(): Promise<NotificationList> {
  return b2cGet<NotificationList>('/api/v1/notifications/');
}

export function markNotificationRead(id: string): Promise<AppNotification> {
  return b2cPost<AppNotification>(`/api/v1/notifications/${id}/read`, {});
}

export function markAllNotificationsRead(): Promise<{ marked: number }> {
  return b2cPost<{ marked: number }>('/api/v1/notifications/read-all', {});
}

export function deleteNotification(id: string): Promise<void> {
  return b2cDelete<void>(`/api/v1/notifications/${id}`);
}

// ---------- verification ----------
// Canonical implementations live in ./verificationService. Re-exported here
// (plus thin backward-compatible aliases) so existing imports keep working.

export {
  getVerificationStatus,
  submitVerification,
  type VerificationStatus,
  type VerificationSubmitForm,
} from './verificationService';
export { getVerificationStatus as verificationStatus } from './verificationService';
import { uploadDocument } from './verificationService';
import type { DocType } from './verificationService';
export type { DocType };

/** Backward-compatible alias: delegates to verificationService.uploadDocument. */
export function uploadVerificationDocument(
  docType: DocType,
  file: UploadFile,
): Promise<{ path: string; doc_type: DocType }> {
  return uploadDocument(file.uri, file.name, file.mimeType, docType);
}

// ---------- auth helpers ----------

export function logout(): Promise<{ logged_out: boolean }> {
  return b2cPost<{ logged_out: boolean }>('/api/v1/auth/logout', {});
}
