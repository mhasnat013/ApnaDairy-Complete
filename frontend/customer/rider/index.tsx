// app/customer/rider/index.tsx
// Rider tab: shows the active delivery (latest non-delivered order) with
// rider details. Full live map + chat live in orders/[id]/track.
// Data: GET /orders/ + GET /rider/order/{id} via orderService.
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { fetchOrders, trackOrder, type Order, type Delivery } from '../../../src/services/customer/orderService';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';

const F = font.family;

const ACTIVE = new Set(['pending', 'accepted', 'preparing', 'dispatched']);

export default function RiderScreen(): React.JSX.Element {
  const [order, setOrder] = useState<Order | null>(null);
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const orders = await fetchOrders();
      const active = orders.find((o) => ACTIVE.has(o.status)) ?? null;
      setOrder(active);
      if (active) {
        try {
          setDelivery(await trackOrder(active.id));
        } catch {
          setDelivery(null);
        }
      } else {
        setDelivery(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The rider details could not be loaded.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const callRider = useCallback(() => {
    const phone = delivery?.rider?.phone;
    if (phone) Linking.openURL(`tel:${phone}`);
  }, [delivery]);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.forest} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<ScrollView
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
    >
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 24, color: colors.ink }}>Rider</Text>
      <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2, marginBottom: 16 }}>
        Delivery information
      </Text>

      {error ? (
        <View style={{ backgroundColor: colors.dangerTint, borderRadius: 16, padding: 14, marginBottom: 12 }}>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink }}>{error}</Text>
        </View>
      ) : null}

      {!order ? (
        <View style={{ backgroundColor: colors.ivory, borderRadius: 20, padding: 24, alignItems: 'center' }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 17, color: colors.ink }}>
            No active delivery
          </Text>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 8, textAlign: 'center' }}>
            When your order is on its way, the rider's details will appear here.
          </Text>
          <View style={{ marginTop: 16, width: '100%' }}>
            <AppButton label="View orders" onPress={() => router.push('/customer/orders')} variant="outline" />
          </View>
        </View>
      ) : (
        <View style={{ backgroundColor: colors.ivory, borderRadius: 20, padding: 20 }}>
          <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage }}>Order #{order.id.slice(0, 8)}</Text>
          {delivery?.rider ? (
            <View style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View
                  style={{
                    width: 56, height: 56, borderRadius: 20, backgroundColor: colors.forest,
                    alignItems: 'center', justifyContent: 'center', marginRight: 14,
                  }}
                >
                  <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 20, color: colors.cream }}>
                    {(delivery.rider.name ?? 'R').charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.ink }}>
                    {delivery.rider.name ?? 'Rider'}
                  </Text>
                  <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2 }}>
                    {delivery.rider.phone ?? ''}
                  </Text>
                </View>
              </View>
              {delivery.rider.phone ? (
                <TouchableOpacity
                  onPress={callRider}
                  style={{
                    backgroundColor: colors.forest, borderRadius: 999, marginTop: 16,
                    minHeight: 52, alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.cream }}>
                    Call rider
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : (
            <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 12 }}>
              A rider has not been assigned yet.
            </Text>
          )}
          <TouchableOpacity
            onPress={() => router.push(`/customer/orders/${encodeURIComponent(order.id)}` as never)}
            style={{ marginTop: 14, alignItems: 'center', minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.forest }}>
              Track order →
            </Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </SafeAreaView>
  );
}