// app/customer/marketplace/[id].tsx
// Product detail: image placeholder, price, freshness badge, quantity
// stepper, Add to Cart, wishlist toggle.
// Data: GET /marketplace/products/{id}, POST /cart/items,
// POST/DELETE /marketplace/wishlist/.
import React, { useCallback, useEffect, useState } from 'react';
import { formatRs } from '../../../src/utils/format';
import {
  ActivityIndicator,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { getProduct, listWishlist, addToWishlist, removeFromWishlist } from '../../../src/services/customer/marketplaceService';
import { addToCart } from '../../../src/services/customer/cartService';
import type { Product } from '../../../src/types/customerModels';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';

const F = font.family;


// Freshness badge color: green = fresh, amber = use soon, red-ish = low.
function freshnessStyle(days: number | null | undefined): { bg: string; label: string } {
  if (days == null) return { bg: colors.sage, label: 'Unknown' };
  if (days >= 7) return { bg: colors.forest, label: `Fresh (${days} days)` };
  if (days >= 2) return { bg: colors.amber, label: `${days} days remaining` };
  return { bg: colors.danger, label: `${days} days remaining` };
}

function Stepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <TouchableOpacity
        onPress={() => onChange(Math.max(1, qty - 1))}
        accessibilityLabel="Decrease quantity"
        style={{
          width: 48, height: 48, borderRadius: 20, backgroundColor: colors.ivory,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 22, color: colors.forest }}>−</Text>
      </TouchableOpacity>
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 20, color: colors.ink, marginHorizontal: 18, minWidth: 32, textAlign: 'center' }}>
        {qty}
      </Text>
      <TouchableOpacity
        onPress={() => onChange(Math.min(99, qty + 1))}
        accessibilityLabel="Increase quantity"
        style={{
          width: 48, height: 48, borderRadius: 20, backgroundColor: colors.forest,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 22, color: colors.cream }}>+</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ProductDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [wishlisted, setWishlisted] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setError(null);
        const p = await getProduct(id);
        setProduct(p);
        try {
          const wl = await listWishlist();
          setWishlisted(wl.some((w) => w.product_id === p.id));
        } catch {
          // wishlist is optional; ignore
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'The product could not be loaded.');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const toggleWishlist = useCallback(async () => {
    if (!product?.id) return;
    const was = wishlisted;
    setWishlisted(!was);
    try {
      if (was) await removeFromWishlist(product.id);
      else await addToWishlist(product.id);
    } catch {
      setWishlisted(was); // revert on failure
    }
  }, [product, wishlisted]);

  const handleAddToCart = useCallback(async () => {
    if (!product?.id) return;
    setAdding(true);
    setAdded(false);
    try {
      await addToCart(product.id, qty);
      setAdded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The item could not be added to the cart.');
    } finally {
      setAdding(false);
    }
  }, [product, qty]);

  const goToCart = useCallback(() => {
    router.push('/customer/cart');
  }, []);

  if (loading || !product) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        {error ? (
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink, textAlign: 'center' }}>{error}</Text>
            <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
              <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.forest }}>Go back</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.forest} />
        )}
      </View>
    );
  }

  const price = product.final_price ?? product.price;
  const fresh = freshnessStyle(product.freshness_days);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<ScrollView style={{ flex: 1, backgroundColor: colors.cream }} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* Image placeholder + back + wishlist */}
      <View style={{ height: 280, backgroundColor: colors.ivory, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage }}>Photo</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityLabel="Back"
          style={{
            position: 'absolute', top: 52, left: 16,
            width: 44, height: 44, borderRadius: 20, backgroundColor: colors.cream,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 20, color: colors.ink }}>‹</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={toggleWishlist}
          accessibilityLabel="Wishlist"
          style={{
            position: 'absolute', top: 52, right: 16,
            width: 44, height: 44, borderRadius: 20, backgroundColor: colors.cream,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <View
            style={{
              width: 18, height: 18, borderRadius: 16,
              backgroundColor: wishlisted ? colors.amber : 'transparent',
              borderWidth: 2, borderColor: wishlisted ? colors.amber : colors.sage,
            }}
          />
        </TouchableOpacity>
      </View>

      <View style={{ padding: 20 }}>
        {/* Freshness badge */}
        <View style={{ alignSelf: 'flex-start', backgroundColor: fresh.bg, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6, marginBottom: 10 }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 12, color: fresh.bg === colors.amber ? colors.ink : colors.cream }}>
            {fresh.label}
          </Text>
        </View>

        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 24, color: colors.ink }}>
          {product.name ?? 'Product'}
        </Text>
        <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 4 }}>
          {[product.manager?.center_name, product.manager?.city].filter(Boolean).join(' • ')}
          {product.milk_type ? ` • ${product.milk_type}` : ''}
        </Text>

        {/* Price */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', marginTop: 12 }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 28, color: colors.forest }}>
            {formatRs(price)}
          </Text>
          {product.unit ? (
            <Text style={{ fontFamily: F, fontSize: 15, color: colors.sage }}> / {product.unit}</Text>
          ) : null}
          {(product.discount_pct ?? 0) > 0 ? (
            <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginLeft: 10, textDecorationLine: 'line-through' }}>
              {formatRs(product.price)}
            </Text>
          ) : null}
        </View>

        {/* Description */}
        {product.description ? (
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink, marginTop: 14, lineHeight: 22 }}>
            {product.description}
          </Text>
        ) : null}

        {/* Stock */}
        <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 10 }}>
          {product.is_available === false ? 'Currently unavailable' : `Available: ${product.stock_qty ?? '—'} ${product.unit ?? ''}`}
        </Text>

        {/* Quantity + Add to cart */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 20 }}>
          <Stepper qty={qty} onChange={setQty} />
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.ink }}>
            {formatRs((price ?? 0) * qty)}
          </Text>
        </View>

        <View style={{ marginTop: 16 }}>
          <AppButton
            label={added ? 'Added to cart' : 'Add to cart'}
            onPress={handleAddToCart}
            loading={adding}
            disabled={product.is_available === false}
          />
        </View>
        {added ? (
          <TouchableOpacity onPress={goToCart} style={{ marginTop: 12, alignItems: 'center', minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.forest }}>
              View cart →
            </Text>
          </TouchableOpacity>
        ) : null}

        {error ? (
          <Text style={{ fontFamily: F, fontSize: 13, color: colors.danger, marginTop: 12 }}>{error}</Text>
        ) : null}
      </View>
    </ScrollView>
    </SafeAreaView>
  );
}
