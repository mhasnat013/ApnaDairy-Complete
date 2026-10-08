// app/customer/cart/index.tsx
// Cart tab: items list with quantity steppers, totals, clear cart,
// and "Proceed to Checkout" (routes to checkout flow when built).
// Data: GET /cart/, PUT /cart/items/{id}, DELETE /cart/items/{id}.
import React, { useCallback, useEffect, useState } from 'react';
import { formatRs } from '../../src/utils/format';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { getCart, updateCartItem, removeCartItem, clearCart } from '../../../src/services/customer/cartService';
import type { Cart, CartItem } from '../../../src/types/customerModels';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';

const F = font.family;


function QtyStepper({ qty, onChange, small }: { qty: number; onChange: (q: number) => void; small?: boolean }): React.JSX.Element {
  const size = small ? 36 : 44;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => onChange(qty - 1)}
        accessibilityLabel="Decrease quantity"
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: colors.cream,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.forest }}>−</Text>
      </TouchableOpacity>
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.ink, marginHorizontal: 12, minWidth: 24, textAlign: 'center' }}>
        {qty}
      </Text>
      <TouchableOpacity
        onPress={() => onChange(qty + 1)}
        accessibilityLabel="Increase quantity"
        style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: colors.forest,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.cream }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function CartScreen(): React.JSX.Element {
  const [cart, setCart] = useState<Cart | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setCart(await getCart());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The cart could not be loaded.');
    }
  }, []);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  // Refresh every time the tab gains focus (items added from detail screen).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const changeQty = useCallback(async (item: CartItem, qty: number) => {
    setBusyId(item.id);
    try {
      if (qty <= 0) {
        await removeCartItem(item.id);
      } else {
        await updateCartItem(item.id, qty);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The quantity could not be updated.');
    } finally {
      setBusyId(null);
    }
  }, [load]);

  const handleClear = useCallback(async () => {
    try {
      await clearCart();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The cart could not be cleared.');
    }
  }, [load]);

  const goCheckout = useCallback(() => {
    router.push('/customer/checkout' as never);
  }, []);

  const goMarketplace = useCallback(() => {
    router.push('/customer/marketplace');
  }, []);

  if (loading || !cart) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.forest} />
        <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 12 }}>Loading...</Text>
      </View>
    );
  }

  const empty = cart.items.length === 0;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={{ padding: 16, paddingBottom: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 24, color: colors.ink }}>Cart</Text>
          <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2 }}>
            {cart.total_items} items
          </Text>
        </View>
        {!empty ? (
          <TouchableOpacity onPress={handleClear} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_600SemiBold', fontSize: 13, color: colors.danger }}>Clear cart</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? (
        <View style={{ marginHorizontal: 16, backgroundColor: colors.dangerTint, borderRadius: 16, padding: 14, marginBottom: 8 }}>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink }}>{error}</Text>
        </View>
      ) : null}

      {empty ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.ink }}>Your cart is empty</Text>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 8, textAlign: 'center' }}>
            Choose fresh milk and traditional dairy products from the marketplace.
          </Text>
          <View style={{ marginTop: 20, width: '100%' }}>
            <AppButton label="Browse marketplace" onPress={goMarketplace} />
          </View>
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={cart.items}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 16 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
            renderItem={({ item }) => (
              <View
                style={{
                  backgroundColor: colors.ivory, borderRadius: 20, padding: 14,
                  marginBottom: 12, flexDirection: 'row', alignItems: 'center',
                }}
              >
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.ink }} numberOfLines={2}>
                    {item.product_name}
                  </Text>
                  <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2 }}>
                    {formatRs(item.unit_price)} per
                  </Text>
                  <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.forest, marginTop: 4 }}>
                    {formatRs(item.line_total)}
                  </Text>
                </View>
                {busyId === item.id ? (
                  <ActivityIndicator size="small" color={colors.forest} />
                ) : (
                  <QtyStepper small qty={item.quantity} onChange={(q) => changeQty(item, q)} />
                )}
              </View>
            )}
          />

          {/* Totals + checkout */}
          <View
            style={{
              backgroundColor: colors.ivory, borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: 20, paddingBottom: 28,
            }}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
              <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage }}>Subtotal</Text>
              <Text style={{ fontFamily: 'BricolageGrotesque_600SemiBold', fontSize: 14, color: colors.ink }}>
                {formatRs(cart.total_amount)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
              <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 17, color: colors.ink }}>Total</Text>
              <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 20, color: colors.forest }}>
                {formatRs(cart.total_amount)}
              </Text>
            </View>
            <AppButton label="Proceed to checkout" onPress={goCheckout} />
          </View>
        </View>
      )}
    </View>
    </SafeAreaView>
  );
}
