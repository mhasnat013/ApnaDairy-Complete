// Customer checkout: address selector, payment method, server-priced summary.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatRs } from '../../src/utils/format';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import {
  listAddresses,
} from '../../../src/services/customer/addressService';
import { getCart } from '../../../src/services/customer/cartService';
import { checkout } from '../../../src/services/customer/checkoutService';
import { newIdempotencyKey } from '../../../src/services/customer/orderService';
import type {
  Address,
  Cart,
  PaymentMethod,
} from '../../../src/types/customerModels';

const PAYMENT_OPTIONS: Array<{ value: PaymentMethod; label: string; hint: string }> = [
  { value: 'cod', label: 'Cash on Delivery', hint: 'Pay in cash when your order arrives' },
  { value: 'bank_transfer', label: 'Bank Transfer', hint: 'Upload the transfer screenshot after ordering' },
  { value: 'test_card', label: 'Card (Test Mode)', hint: 'Demo card payment — clearly marked as test' },
];

export default function CheckoutScreen() {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentMethod>('cod');
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Idempotency key: generated ONCE per checkout session and reused across
  // retries. Only rotated after a SUCCESSFUL order, so a failed attempt
  // followed by a retry hits the same idempotency key server-side (no
  // duplicate orders on double-tap / network blips).
  const idempotencyKey = useRef(newIdempotencyKey());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [addrs, summary] = await Promise.all([listAddresses(), getCart()]);
      setAddresses(addrs);
      setCart(summary);
      const def = addrs.find((a) => a.is_default) ?? addrs[0];
      setSelectedAddress(def ? def.id : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load checkout.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onPlaceOrder = useCallback(async () => {
    if (!selectedAddress) {
      Alert.alert('Select address', 'Please select a delivery address first.');
      return;
    }
    if (!cart || cart.total_items === 0) {
      Alert.alert('Your cart is empty', 'Your cart is empty.');
      return;
    }
    setPlacing(true);
    try {
      const res = await checkout(
        { address_id: selectedAddress, payment_method: payment },
        idempotencyKey.current,
      );
      const first = res.orders[0];
      // Rotate the key now that the order is placed — the next checkout
      // session needs a fresh key.
      idempotencyKey.current = newIdempotencyKey();
      router.replace({
        pathname: '/customer/checkout/success' as never,
        params: {
          orderId: first ? first.id : '',
          count: String(res.orders.length),
          total: String(res.orders.reduce((s, o) => s + o.total_amount, 0)),
        },
      });
    } catch (e) {
      Alert.alert('Order failed', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setPlacing(false);
    }
  }, [selectedAddress, payment, cart]);

  if (loading) {
    return (
      <Screen title="Checkout">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Checkout" subtitle="Review and place your order">
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {error ? (
          <Card style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <AppButton label="Retry" variant="outline" onPress={load} />
          </Card>
        ) : null}

        <Text style={styles.sectionTitle}>Delivery address</Text>
        {addresses.length === 0 ? (
          <Card>
            <Text style={styles.muted}>No saved addresses. Add one from Profile first.</Text>
          </Card>
        ) : (
          addresses.map((a) => {
            const active = a.id === selectedAddress;
            return (
              <Pressable key={a.id} onPress={() => setSelectedAddress(a.id)}>
                <Card style={[styles.addrCard, active && styles.addrActive]}>
                  <View style={styles.row}>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.addrLabel}>
                        {a.label}
                        {a.is_default ? ' (Default)' : ''}
                      </Text>
                      <Text style={styles.addrText}>
                        {a.recipient_name} — {a.phone}
                      </Text>
                      <Text style={styles.addrText}>
                        {a.address_line}, {a.city}
                      </Text>
                    </View>
                  </View>
                </Card>
              </Pressable>
            );
          })
        )}

        <Text style={styles.sectionTitle}>Payment method</Text>
        {PAYMENT_OPTIONS.map((opt) => {
          const active = payment === opt.value;
          return (
            <Pressable key={opt.value} onPress={() => setPayment(opt.value)}>
              <Card style={[styles.addrCard, active && styles.addrActive]}>
                <View style={styles.row}>
                  <View style={[styles.radio, active && styles.radioActive]}>
                    {active ? <View style={styles.radioDot} /> : null}
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.addrLabel}>{opt.label}</Text>
                    <Text style={styles.muted}>{opt.hint}</Text>
                  </View>
                </View>
              </Card>
            </Pressable>
          );
        })}

        <Text style={styles.sectionTitle}>Order summary</Text>
        <Card>
          {(cart?.items ?? []).map((it, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.lineName}>
                {it.product_name} × {it.quantity}
              </Text>
              <Text style={styles.lineAmount}>{formatRs(it.line_total)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.lineRow}>
            <Text style={styles.totalLabel}>Total (server-calculated)</Text>
            <Text style={styles.totalAmount}>{formatRs((cart?.total_amount ?? 0))}</Text>
          </View>
          <Text style={styles.muted}>Prices are calculated by the server — never edited on device.</Text>
        </Card>

        <View style={styles.cta}>
          <AppButton
            label={placing ? 'Placing order...' : 'Place Order'}
            onPress={onPlaceOrder}
            loading={placing}
            disabled={!selectedAddress || (cart?.total_items ?? 0) === 0}
          />
        </View>
      </ScrollView>
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    fontSize: 17, color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold', marginTop: 20, marginBottom: 10 },
  addrCard: { marginBottom: 10 },
  addrActive: { borderWidth: 2, borderColor: colors.forest },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  flex: { flex: 1 },
  radio: {
    width: 22, height: 22, borderRadius: 16, borderWidth: 2,
    borderColor: colors.sage, marginRight: 12, marginTop: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  radioActive: { borderColor: colors.forest },
  radioDot: { width: 10, height: 10, borderRadius: 16, backgroundColor: colors.forest },
  addrLabel: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  addrText: { fontSize: 14, color: colors.ink, marginTop: 2 },
  muted: { fontSize: 13, color: colors.sage, marginTop: 4 },
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  lineName: { fontSize: 14, color: colors.ink, flex: 1 },
  lineAmount: { fontSize: 14, fontWeight: '600', color: colors.ink },
  divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
  totalLabel: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  totalAmount: { fontSize: 18, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  cta: { marginTop: 24 },
  errorCard: { borderWidth: 1, borderColor: colors.danger, marginBottom: 12 },
  errorText: { color: colors.danger, marginBottom: 12 },
});
