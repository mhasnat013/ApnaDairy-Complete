// Order detail: items, totals, payment status, timeline, cancel / reorder / track.
import React, { useCallback, useEffect, useState } from 'react';
import { formatRs } from '../../../src/utils/format';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../../src/components/common/Screen';
import { Card } from '../../../../src/components/common/Card';
import { AppButton } from '../../../../src/components/common/AppButton';
import { colors } from '../../../../src/theme/colors';
import { OrderStatusChip } from '../../../../src/components/customer/OrderStatusChip';
import {
  CANCELLABLE,
  cancelOrder,
  getOrder,
  reorder,
  statusLabel,
} from '../../../../src/services/customer/orderService';
import type { Order } from '../../../../src/types/customerModels';

export default function OrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const orderId = Array.isArray(id) ? id[0] : id;
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    setError(null);
    try {
      setOrder(await getOrder(orderId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load order.');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    load();
  }, [load]);

  const onCancel = useCallback(() => {
    Alert.alert('Cancel order?', 'This cannot be undone.', [
      { text: 'Keep order', style: 'cancel' },
      {
        text: 'Cancel order',
        style: 'destructive',
        onPress: async () => {
          setActing(true);
          try {
            const updated = await cancelOrder(orderId);
            setOrder(updated);
          } catch (e) {
            Alert.alert('Cancel failed', e instanceof Error ? e.message : 'Try again.');
          } finally {
            setActing(false);
          }
        },
      },
    ]);
  }, [orderId]);

  const onReorder = useCallback(async () => {
    setActing(true);
    try {
      const res = await reorder(orderId);
      Alert.alert(
        'Added to cart',
        `${res.added_items} items (Rs ${res.total_amount.toFixed(2)}) copied to your cart.`,
        [{ text: 'Go to cart', onPress: () => router.push('/customer/cart' as never) }, { text: 'Stay' }],
      );
    } catch (e) {
      Alert.alert('Reorder failed', e instanceof Error ? e.message : 'Try again.');
    } finally {
      setActing(false);
    }
  }, [orderId]);

  if (loading) {
    return (
      <Screen title="Order">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  if (error || !order) {
    return (
      <Screen title="Order">
        <View style={styles.center}>
          <Text style={styles.errorText}>{error ?? 'Order not found.'}</Text>
          <AppButton label="Retry" variant="outline" onPress={load} />
        </View>
      </Screen>
    );
  }

  const cancellable = CANCELLABLE.has(order.status);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title={`Order #${order.id.slice(0, 8)}`}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Card style={styles.headCard}>
          <View style={styles.row}>
            <OrderStatusChip status={order.status} />
            <Text style={styles.total}>{formatRs(order.total_amount)}</Text>
          </View>
          <Text style={styles.meta}>
            Placed {order.created_at ? new Date(order.created_at).toLocaleString() : '—'}
          </Text>
          <Text style={styles.meta}>
            Payment: {order.payment_method ? order.payment_method.replace('_', ' ').toUpperCase() : '—'}
          </Text>
        </Card>

        <Text style={styles.sectionTitle}>Items</Text>
        <Card>
          {order.items.map((it) => (
            <View key={it.id} style={styles.lineRow}>
              <View style={styles.flex}>
                <Text style={styles.itemName}>{it.product_name || 'Product'}</Text>
                <Text style={styles.muted}>Qty {it.quantity} × {formatRs(it.unit_price)}</Text>
              </View>
              <Text style={styles.lineAmount}>{formatRs(it.line_total)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.lineRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatRs(order.total_amount)}</Text>
          </View>
        </Card>

        {order.timeline.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Delivery timeline</Text>
            <Card>
              {order.timeline.map((ev, i) => (
                <View key={i} style={styles.timelineRow}>
                  <View style={styles.dot} />
                  <View style={styles.flex}>
                    <Text style={styles.timelineMsg}>{ev.message || ev.type || statusLabel(order.status)}</Text>
                    {ev.created_at ? <Text style={styles.muted}>{new Date(ev.created_at).toLocaleString()}</Text> : null}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <View style={styles.cta}>
          <AppButton
            label="Track Delivery"
            onPress={() => router.push({ pathname: '/customer/orders/track', params: { orderId: order.id } } as never)}
          />
          <View style={styles.gap} />
          <AppButton label="Reorder" variant="outline" onPress={onReorder} loading={acting} />
          {cancellable ? (
            <>
              <View style={styles.gap} />
              <AppButton label="Cancel Order" variant="outline" onPress={onCancel} loading={acting} />
            </>
          ) : null}
        </View>
      </ScrollView>
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorText: { color: colors.danger, marginBottom: 12, textAlign: 'center' },
  headCard: { marginTop: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  flex: { flex: 1 },
  total: { fontSize: 22, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  meta: { fontSize: 13, color: colors.sage, marginTop: 6 },
  sectionTitle: {
    fontSize: 17, color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold', marginTop: 20, marginBottom: 10 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  itemName: { fontSize: 15, fontWeight: '600', color: colors.ink },
  lineAmount: { fontSize: 15, fontWeight: '600', color: colors.ink },
  muted: { fontSize: 12, color: colors.sage, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  totalLabel: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  totalAmount: { fontSize: 18, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  timelineRow: { flexDirection: 'row', marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 16, backgroundColor: colors.amber, marginTop: 5, marginRight: 12 },
  timelineMsg: { fontSize: 14, color: colors.ink },
  cta: { marginTop: 24 },
  gap: { height: 12 },
});
