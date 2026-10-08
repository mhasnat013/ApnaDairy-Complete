// My Orders — list of the customer's orders with status chips.
import React, { useCallback, useEffect, useState } from 'react';
import { formatRs } from '../../src/utils/format';
import { View, Text, StyleSheet, FlatList, Pressable, ActivityIndicator, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import { OrderStatusChip } from '../../../src/components/customer/OrderStatusChip';
import { listOrders } from '../../../src/services/customer/orderService';
import type { Order, OrderStatus } from '../../../src/types/customerModels';

const FILTERS = ['all', 'pending', 'accepted', 'preparing', 'dispatched', 'delivered', 'cancelled'] as const;

export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (status?: OrderStatus) => {
    setError(null);
    try {
      const list = await listOrders(status);
      setOrders(list.orders);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(filter === 'all' ? undefined : filter);
  }, [filter, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load(filter === 'all' ? undefined : filter);
  }, [filter, load]);

  const renderItem = ({ item }: { item: Order }) => (
    <Pressable onPress={() => router.push(`/customer/orders/${item.id}` as never)}>
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Text style={styles.orderId} numberOfLines={1}>
              #{item.id.slice(0, 8)}
            </Text>
            <Text style={styles.meta}>
              {item.items.length} item{item.items.length === 1 ? '' : 's'} · {formatRs(item.total_amount)}
            </Text>
            <Text style={styles.date}>
              {item.created_at ? new Date(item.created_at).toLocaleDateString() : ''}
              {item.payment_method ? ` · ${item.payment_method.replace('_', ' ').toUpperCase()}` : ''}
            </Text>
          </View>
          <OrderStatusChip status={item.status} />
        </View>
      </Card>
    </Pressable>
  );

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="My Orders" subtitle="Track your milk orders">
      <View style={styles.filters}>
        <FlatList
          horizontal
          data={FILTERS as unknown as string[]}
          keyExtractor={(f) => f}
          showsHorizontalScrollIndicator={false}
          renderItem={({ item: f }) => (
            <Pressable
              onPress={() => setFilter(f as (typeof FILTERS)[number])}
              style={[styles.filterPill, filter === f && styles.filterActive]}
            >
              <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </Text>
            </Pressable>
          )}
        />
      </View>
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <AppButton label="Retry" variant="outline" onPress={() => { setLoading(true); load(filter === 'all' ? undefined : filter); }} />
        </View>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.muted}>No orders yet.</Text>
            </View>
          }
        />
      )}
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  filters: { marginVertical: 8 },
  filterPill: {
    borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.ivory, marginRight: 8, borderWidth: 1, borderColor: colors.line,
  },
  filterActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  filterText: { fontSize: 13, fontWeight: '600', color: colors.ink },
  filterTextActive: { color: colors.ivory },
  list: { paddingBottom: 24 },
  card: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, marginRight: 8 },
  orderId: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  meta: { fontSize: 14, color: colors.ink, marginTop: 4 },
  date: { fontSize: 12, color: colors.sage, marginTop: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  muted: { fontSize: 14, color: colors.sage },
  errorText: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
});
