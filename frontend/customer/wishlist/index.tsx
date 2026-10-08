// Customer wishlist screen — saved products with quick add-to-cart.
// Route: app/customer/wishlist/index.tsx (linked from Profile menu;
// becomes a tab automatically if the tab worker adds it to _layout).
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { WishlistHeart } from '../../../src/components/customer/WishlistHeart';
import { colors } from '../../../src/theme/colors';
import {
  listWishlist,
  removeFromWishlist,
} from '../../../src/services/customer/marketplaceService';
import { addToCart } from '../../../src/services/customer/cartService';
import type { WishlistItem } from '../../../src/types/customerModels';

function productName(item: WishlistItem): string {
  const p = item.product;
  if (p && typeof p.name === 'string') return p.name;
  return 'Product';
}

function productPrice(item: WishlistItem): string {
  const p = item.product;
  const raw = p ? (p.final_price ?? p.price) : null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? `Rs ${n.toFixed(0)}` : '';
}

export default function WishlistScreen() {
  const router = useRouter();
  // Forward-referenced routes (built by parallel workers); typed as never
  // until expo-router regenerates route types.
  const go = (path: string) => router.push(path as never);
  const [items, setItems] = useState<WishlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addingId, setAddingId] = useState<string | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      setItems(await listWishlist());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wishlist.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function handleRemove(productId: string) {
    setItems((prev) => prev.filter((i) => i.product_id !== productId));
    try {
      await removeFromWishlist(productId);
    } catch {
      load(); // restore on failure
    }
  }

  async function handleAddToCart(productId: string) {
    setAddingId(productId);
    try {
      await addToCart(productId, 1);
      go('/customer/cart');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to cart.');
    } finally {
      setAddingId(null);
    }
  }

  function renderItem({ item }: { item: WishlistItem }) {
    return (
      <Card style={styles.card}>
        <View style={styles.row}>
          <Pressable
            style={styles.info}
            onPress={() => go(`/customer/marketplace/${item.product_id}`)}
          >
            <Text style={styles.name} numberOfLines={2}>
              {productName(item)}
            </Text>
            {productPrice(item) ? <Text style={styles.price}>{productPrice(item)}</Text> : null}
          </Pressable>
          <WishlistHeart
            productId={item.product_id}
            initialWishlisted
            onToggle={(w) => {
              if (!w) setItems((prev) => prev.filter((i) => i.product_id !== item.product_id));
            }}
          />
        </View>
        <View style={styles.actions}>
          <AppButton
            label="Add to Cart"
            onPress={() => handleAddToCart(item.product_id)}
            loading={addingId === item.product_id}
          />
          <Pressable onPress={() => handleRemove(item.product_id)} style={styles.removeHit}>
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Screen title="Wishlist" subtitle="Your saved products">
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : error && items.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <AppButton label="Retry" onPress={() => load()} variant="outline" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.product_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} colors={[colors.forest]} />
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Text style={styles.emptyTitle}>No saved items yet</Text>
              <Text style={styles.emptyBody}>
                Tap the heart on any product to save it here.
              </Text>
              <AppButton
                label="Browse Marketplace"
                onPress={() => go('/customer/marketplace')}
                variant="outline"
              />
            </View>
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 24, gap: 12 },
  card: { marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  info: { flex: 1, marginRight: 8 },
  name: {
    fontSize: 16,
    color: colors.ink,
    fontFamily: 'BricolageGrotesque_700Bold' },
  price: { fontSize: 15, fontWeight: '600', color: colors.forest, marginTop: 4 },
  actions: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 12 },
  removeHit: { padding: 8 },
  removeText: { fontSize: 14, color: colors.danger, fontWeight: '600' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 60 },
  emptyTitle: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  emptyBody: { fontSize: 14, color: colors.sage, textAlign: 'center', marginBottom: 8 },
  errorText: { fontSize: 14, color: colors.danger, textAlign: 'center', marginBottom: 8 },
});
