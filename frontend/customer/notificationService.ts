// Notification service — order/payment/complaint event notifications.
// Polling-based (Phase 1); push comes in Phase 2.
import { b2cGet, b2cPost, b2cDelete, qs } from '../../api/b2cClient';
import type { CustomerNotification, NotificationList } from '../../types/customerModels';

/** Paginated notifications; unread_only filters to unread. */
export async function listNotifications(
  unreadOnly = false,
  page = 1,
  pageSize = 20,
): Promise<NotificationList> {
  return b2cGet<NotificationList>(
    '/api/v1/notifications/' + qs({ unread_only: unreadOnly, page, page_size: pageSize }),
  );
}

/** Mark one notification read. */
export async function markNotificationRead(notificationId: string): Promise<CustomerNotification> {
  return b2cPost<CustomerNotification>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    {},
  );
}

/** Mark all notifications read. Returns the count marked. */
export async function markAllNotificationsRead(): Promise<number> {
  const res = await b2cPost<{ marked: number }>('/api/v1/notifications/read-all', {});
  return res.marked;
}

/** Delete a notification. */
export async function deleteNotification(notificationId: string): Promise<void> {
  await b2cDelete<void>(`/api/v1/notifications/${encodeURIComponent(notificationId)}`);
}
