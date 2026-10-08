// Delivery tracking: rider card, status timeline, call + message rider.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Linking, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import { OrderStatusChip } from '../../../src/components/customer/OrderStatusChip';
import {
  trackOrder,
  getOrder,
  type Delivery,
} from '../../../src/services/customer/orderService';

/** Fixed 5-stage journey. Order status vocabulary matches the DB CHECK constraint. */
const JOURNEY = [
  { key: 'placed', label: 'Order placed' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'delivered', label: 'Delivered' },
] as const;

/** Map the current order status to a journey index (cancelled/rejected = -1). */
function journeyIndex(status: string): number {
  const order = ['pending', 'accepted', 'preparing', 'dispatched', 'delivered'];
  const i = order.indexOf(status);
  return i; // -1 for cancelled / rejected / unknown
}

export default function TrackOrderScreen() {
  const router = useRouter();
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const oid = Array.isArray(orderId) ? orderId[0] : orderId;
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [orderStatus, setOrderStatus] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!oid) return;
    setLoading(true);
    setError(null);
    try {
      const [del, ord] = await Promise.all([
        trackOrder(oid).catch(() => null),
        getOrder(oid),
      ]);
      setDelivery(del);
      setOrderStatus(ord.status);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load delivery.');
    } finally {
      setLoading(false);
    }
  }, [oid]);

  useEffect(() => {
    load();
  }, [load]);

  const callRider = useCallback(() => {
    const phone = delivery?.rider?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  }, [delivery]);

  const messageRider = useCallback(() => {
    if (!oid) return;
    // Typed routes manifest regenerates on next `expo start`; cast keeps tsc green meanwhile.
    router.push({
      pathname: '/customer/orders/[id]/chat' as '/customer/orders/[id]',
      params: {
        id: oid,
        deliveryId: delivery?.delivery_id ?? '',
        riderName: delivery?.rider?.name ?? '',
      },
    });
  }, [oid, delivery, router]);

  const riderInitial = (delivery?.rider?.name ?? 'R').trim().charAt(0).toUpperCase() || 'R';
  const stage = journeyIndex(orderStatus);

  if (loading) {
    return (
      <Screen title="Track order">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen title="Track order">
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <AppButton label="Retry" variant="outline" onPress={load} />
        </View>
      </Screen>
    );
  }

  const rider = delivery?.rider;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Track order" subtitle={oid ? `Order #${oid.slice(0, 8)}` : undefined}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Card style={styles.headCard}>
          <View style={styles.row}>
            <Text style={styles.label}>Order status</Text>
            <OrderStatusChip status={orderStatus} />
          </View>
          {delivery?.status ? (
            <View style={[styles.row, styles.mt]}>
              <Text style={styles.label}>Delivery status</Text>
              <OrderStatusChip status={delivery.status} />
            </View>
          ) : null}
        </Card>

        <Text style={styles.sectionTitle}>Rider</Text>
        {rider ? (
          <Card>
            <View style={styles.riderRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{riderInitial}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.riderName}>{rider.name ?? 'Rider'}</Text>
                {rider.phone ? <Text style={styles.riderMeta}>{rider.phone}</Text> : null}
                {rider.vehicle_label || rider.vehicle_plate ? (
                  <Text style={styles.riderMeta}>
                    {[rider.vehicle_label, rider.vehicle_plate].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {rider.rating != null ? <Text style={styles.riderMeta}>Rating: {rider.rating.toFixed(1)} / 5</Text> : null}
              </View>
            </View>
            <View style={styles.ctaRow}>
              {rider.phone ? (
                <View style={styles.ctaHalf}>
                  <AppButton label="Call Rider" onPress={callRider} />
                </View>
              ) : null}
              {delivery?.delivery_id ? (
                <View style={styles.ctaHalf}>
                  <AppButton label="Message Rider" variant="outline" onPress={messageRider} />
                </View>
              ) : null}
            </View>
          </Card>
        ) : (
          <Card>
            <Text style={styles.muted}>
              {delivery?.message ?? 'Rider not assigned yet. The area manager will assign one soon.'}
            </Text>
          </Card>
        )}

        <Text style={styles.sectionTitle}>Journey</Text>
        <Card>
          {JOURNEY.map((s, i) => {
            const done = stage >= 0 && i <= stage;
            const current = stage >= 0 && i === stage;
            return (
              <View key={s.key} style={styles.journeyRow}>
                <View style={styles.journeyRail}>
                  <View style={[styles.journeyDot, done && styles.journeyDotDone, current && styles.journeyDotCurrent]} />
                  {i < JOURNEY.length - 1 ? (
                    <View style={[styles.journeyLine, i < stage && styles.journeyLineDone]} />
                  ) : null}
                </View>
                <View style={styles.flex}>
                  <Text style={[styles.journeyLabel, done ? styles.journeyLabelDone : styles.muted]}>
                    {s.label}
                  </Text>
                  {current ? <Text style={styles.journeyNow}>Current stage</Text> : null}
                </View>
              </View>
            );
          })}
          {stage < 0 ? (
            <Text style={styles.muted}>Order {orderStatus} — journey ended.</Text>
          ) : null}
        </Card>

        {delivery && delivery.events.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Updates</Text>
            <Card>
              {delivery.events.map((ev, i) => (
                <View key={i} style={styles.timelineRow}>
                  <View style={styles.dot} />
                  <View style={styles.flex}>
                    <Text style={styles.timelineMsg}>{ev.message || ev.type}</Text>
                    {ev.created_at ? (
                      <Text style={styles.muted}>{new Date(ev.created_at).toLocaleString()}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <Pressable onPress={load} style={styles.refresh}>
          <Text style={styles.refreshText}>Refresh status</Text>
        </Pressable>
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
  mt: { marginTop: 10 },
  flex: { flex: 1 },
  label: { fontSize: 14, color: colors.sage },
  sectionTitle: {
    fontSize: 17, color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold', marginTop: 20, marginBottom: 10 },
  riderName: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  riderRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 52, height: 52, borderRadius: 20,
    backgroundColor: colors.forest, alignItems: 'center', justifyContent: 'center',
    marginRight: 14,
  },
  avatarText: { color: colors.ivory, fontSize: 22, fontFamily: 'BricolageGrotesque_700Bold' },
  ctaRow: { flexDirection: 'row', marginTop: 16, marginHorizontal: -6 },
  ctaHalf: { flex: 1, marginHorizontal: 6 },
  journeyRow: { flexDirection: 'row', marginBottom: 4 },
  journeyRail: { alignItems: 'center', marginRight: 14, width: 16 },
  journeyDot: { width: 14, height: 14, borderRadius: 16, backgroundColor: colors.line, borderWidth: 2, borderColor: colors.line },
  journeyDotDone: { backgroundColor: colors.forest, borderColor: colors.forest },
  journeyDotCurrent: { backgroundColor: colors.amber, borderColor: colors.amber },
  journeyLine: { width: 2, flex: 1, minHeight: 22, backgroundColor: colors.line, marginVertical: 2 },
  journeyLineDone: { backgroundColor: colors.forest },
  journeyLabel: { fontSize: 15, fontFamily: 'BricolageGrotesque_600SemiBold' },
  journeyLabelDone: { color: colors.ink },
  journeyNow: { fontSize: 12, color: colors.amber, fontWeight: '700', marginTop: 2 },
  riderMeta: { fontSize: 14, color: colors.ink, marginTop: 4 },
  muted: { fontSize: 14, color: colors.sage, lineHeight: 20 },
  cta: { marginTop: 16 },
  timelineRow: { flexDirection: 'row', marginBottom: 12 },
  dot: { width: 10, height: 10, borderRadius: 16, backgroundColor: colors.amber, marginTop: 5, marginRight: 12 },
  timelineMsg: { fontSize: 14, color: colors.ink },
  refresh: { marginTop: 20, alignItems: 'center', paddingVertical: 12 },
  refreshText: { fontSize: 15, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
});
