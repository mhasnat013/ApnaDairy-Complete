// Notifications tab — offers, payments, and verification updates.
// Tapping a notification marks it read and opens the matching screen.
// Real data via engagementService (GET /api/v1/farmer/notifications/).

import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { shouldRefetch } from '../../src/utils/focusCache';
import { Screen } from '../../src/components/common/Screen';
import { Card } from '../../src/components/common/Card';
import { ErrorRetry } from '../../src/components/common/ErrorRetry';
import { EmptyState } from '../../src/components/common/EmptyState';
import { colors } from '../../src/theme/colors';
import type { AppNotification } from '../../src/types/farmerModels';
import {
  getNotifications,
  markRead,
  markAllRead,
} from '../../src/services/engagementService';

// Type label shown under each notification title.
const TYPE_LABEL: Record<string, string> = {
  offer_received: 'Offer',
  payment_received: 'Payment',
  verification: 'Verification',
  manager_assigned: 'Manager',
  complaint_reply: 'Complaint',
  info: 'Notice',
};

// Deep-link route per notification type; undefined means tap does nothing.
function routeFor(n: AppNotification): '/sales' | '/payments' | '/complaints' | undefined {
  if (n.type === 'offer_received') return '/sales';
  if (n.type === 'payment_received') return '/payments';
  if (n.type === 'complaint_reply') return '/complaints';
  return undefined;
}

// Single notification row: unread gets an amber dot + bold title.
function NotificationRow({ item, onPress }: { item: AppNotification; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.rowPress}>
      <Card style={styles.rowCard}>
        <View style={styles.row}>
          {!item.read && <View style={styles.dot} />}
          <View style={styles.rowText}>
            <Text style={[styles.title, !item.read && styles.titleUnread]}>{item.title}</Text>
            <Text style={styles.type}>{TYPE_LABEL[item.type] ?? 'Notice'}</Text>
            <Text style={styles.message} numberOfLines={2}>
              {item.message}
            </Text>
            <Text style={styles.date}>{item.date}</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

// Notifications tab screen.
export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reloads notifications from the service.
  const load = useCallback(async () => {
    try {
      setError(null);
      setLoading(true);
      setItems(await getNotifications());
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Notifications could not be loaded. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // Refresh when the screen gains focus (skipped if fetched <30s ago).
  useFocusEffect(useCallback(() => {
    if (shouldRefetch('notifications')) load();
  }, [load]));

  // Tap: mark read, then follow the type's deep link.
  async function handlePress(item: AppNotification) {
    if (!item.read) {
      await markRead(item.id);
      setItems((prev) => prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)));
    }
    const route = routeFor(item);
    if (route) router.push(route);
  }

  // Marks everything read.
  async function handleMarkAll() {
    await markAllRead();
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
  }

  const unreadCount = items.filter((n) => !n.read).length;

  if (loading) {
    return (
      <Screen title="Notifications">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="Notifications">
        <ErrorRetry message={error} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen title="Notifications">
      {unreadCount > 0 && (
        <Pressable onPress={handleMarkAll} style={styles.markAll}>
          <Text style={styles.markAllText}>Mark all as read</Text>
        </Pressable>
      )}
      <FlatList
        data={items}
        keyExtractor={(n) => n.id}
        renderItem={({ item }) => <NotificationRow item={item} onPress={() => handlePress(item)} />}
        ListEmptyComponent={
          <EmptyState title="No notifications" message="You are all caught up." />
        }
        contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.list}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 48 },
  markAll: {
    alignSelf: 'flex-end',
    marginBottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  markAllText: { color: colors.forest, fontSize: 14, fontFamily: 'BricolageGrotesque_700Bold' },
  list: { paddingBottom: 24 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  rowPress: { marginBottom: 12 },
  rowCard: { padding: 16 },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.amber,
    marginTop: 7,
    marginRight: 12,
  },
  rowText: { flex: 1 },
  title: {
    fontSize: 16,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque_400Regular',
  },
  titleUnread: { fontFamily: 'BricolageGrotesque_700Bold' },
  type: {
    fontSize: 12,
    color: colors.sage,
    marginTop: 4,
    fontFamily: 'BricolageGrotesque_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  message: { fontSize: 14, color: colors.ink, marginTop: 4, fontFamily: 'BricolageGrotesque_400Regular', lineHeight: 20 },
  date: { fontSize: 12, color: colors.sage, marginTop: 8, fontFamily: 'BricolageGrotesque_400Regular' },
});
