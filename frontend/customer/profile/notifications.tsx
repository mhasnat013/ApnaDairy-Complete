// Customer notifications: list, mark read, unread count.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { colors } from '../../../src/theme/colors';
import {
  listNotifications, markNotificationRead, markAllNotificationsRead,
  type AppNotification,
} from '../../../src/services/customer/accountService';

export default function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await listNotifications();
      setItems(res.items);
      setUnread(res.unread_count);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const markRead = async (n: AppNotification) => {
    if (n.is_read) return;
    try {
      await markNotificationRead(n.id);
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  const markAll = async () => {
    try {
      await markAllNotificationsRead();
      setItems((list) => list.map((x) => ({ ...x, is_read: true })));
      setUnread(0);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    }
  };

  return (
    <Screen title="Notifications" subtitle={unread > 0 ? `${unread} unread` : 'All caught up'}>
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {unread > 0 && (
            <Pressable style={styles.markAll} onPress={markAll}>
              <Text style={styles.markAllText}>Mark all read</Text>
            </Pressable>
          )}
          {items.map((n) => (
            <Pressable key={n.id} onPress={() => markRead(n)}>
              <Card style={[styles.card, !n.is_read && styles.unreadCard]}>
                <View style={styles.row}>
                  {!n.is_read && <View style={styles.dot} />}
                  <View style={styles.info}>
                    <Text style={[styles.title, !n.is_read && styles.titleUnread]}>{n.title}</Text>
                    {n.body ? <Text style={styles.body}>{n.body}</Text> : null}
                    <Text style={styles.time}>
                      {n.created_at ? new Date(n.created_at).toLocaleString('en-PK') : ''}
                    </Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          ))}
          {items.length === 0 && (
            <Text style={styles.empty}>No notifications yet.</Text>
          )}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  markAll: { alignSelf: 'flex-end', marginBottom: 12 },
  markAllText: { fontSize: 14, fontWeight: '600', color: colors.forest },
  card: { marginBottom: 10 },
  unreadCard: { borderWidth: 1.5, borderColor: colors.amber },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.amber, marginTop: 6, marginRight: 10 },
  info: { flex: 1 },
  title: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_600SemiBold' },
  titleUnread: { fontWeight: '700' },
  body: { fontSize: 14, color: colors.sage, marginTop: 4, lineHeight: 20 },
  time: { fontSize: 12, color: colors.sage, marginTop: 6 },
  empty: { textAlign: 'center', color: colors.sage, marginVertical: 24, fontSize: 15 },
});
