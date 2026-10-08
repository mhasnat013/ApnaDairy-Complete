// app/customer/marketplace/index.tsx
// Marketplace: product list with search, category filter, and sort.
// Data: GET /marketplace/products/ via marketplaceService.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { formatRs } from '../../src/utils/format';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { listProducts } from '../../../src/services/customer/marketplaceService';
import type { Product } from '../../../src/types/customerModels';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';

const F = font.family;


const CATEGORIES = ['Sab', 'Doodh', 'Dahi', 'Makhan', 'Desi Ghee', 'Paneer'];
// English display labels for the category chips. The chip VALUES stay unchanged:
// they are passed to the marketplace API (exact match on the web `products`
// table's category column) and arrive from the home screen via route params.
const CATEGORY_LABELS: Record<string, string> = {
  Sab: 'All',
  Doodh: 'Milk',
  Dahi: 'Yogurt',
  Makhan: 'Butter',
  'Desi Ghee': 'Desi Ghee',
  Paneer: 'Paneer',
};
const SORTS: Array<{ key: 'newest' | 'price_asc' | 'price_desc'; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'price_asc', label: 'Price: low to high' },
  { key: 'price_desc', label: 'Price: high to low' },
];

function ProductRow({ item, onPress }: { item: Product; onPress: () => void }): React.JSX.Element {
  const price = item.final_price ?? item.price;
  const hasDiscount = (item.discount_pct ?? 0) > 0;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: colors.ivory, borderRadius: 20, padding: 14,
        marginBottom: 12, flexDirection: 'row',
      }}
    >
      <View
        style={{
          width: 76, height: 76, borderRadius: 16, backgroundColor: colors.cream,
          alignItems: 'center', justifyContent: 'center', marginRight: 12,
        }}
      >
        <Text style={{ fontFamily: F, fontSize: 11, color: colors.sage }}>Photo</Text>
      </View>
      <View style={{ flex: 1, justifyContent: 'center' }}>
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.ink }} numberOfLines={1}>
          {item.name ?? 'Product'}
        </Text>
        <Text style={{ fontFamily: F, fontSize: 12, color: colors.sage, marginTop: 2 }} numberOfLines={1}>
          {[item.manager?.center_name, item.unit ? `/${item.unit}` : null].filter(Boolean).join(' ')}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.forest }}>
            {formatRs(price)}
          </Text>
          {hasDiscount ? (
            <View style={{ backgroundColor: colors.amber, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 8 }}>
              <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 11, color: colors.ink }}>
                -{item.discount_pct}%
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export default function MarketplaceScreen(): React.JSX.Element {
  const params = useLocalSearchParams<{ category?: string }>();
  const [items, setItems] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [category, setCategory] = useState(params.category ?? 'Sab');
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc'>('newest');
  // Debounce: wait 400ms after the last keystroke before searching, so we
  // don't fire a request per character.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sequence guard: ignore responses from older requests that finish after
  // a newer one (stale results).
  const requestSeq = useRef(0);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      setError(null);
      const res = await listProducts({
        q: debouncedQuery.trim() || undefined,
        category: category !== 'Sab' ? category : undefined,
        sort,
        page_size: 50,
      });
      // Only apply if this is still the latest request.
      if (seq === requestSeq.current) {
        setItems(res.items ?? []);
      }
    } catch (e) {
      if (seq === requestSeq.current) {
        setError(e instanceof Error ? e.message : 'The products could not be loaded.');
      }
    }
  }, [debouncedQuery, category, sort]);

  useEffect(() => {
    if (params.category) setCategory(params.category);
  }, [params.category]);

  // Debounce the query text: 400ms after last keystroke.
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQuery(query), 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [query]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openProduct = useCallback((id: string | null) => {
    if (id) router.push(`/customer/marketplace/${encodeURIComponent(id)}`);
  }, []);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<View style={{ flex: 1, backgroundColor: colors.cream }}>
      <View style={{ padding: 16, paddingBottom: 8 }}>
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 24, color: colors.ink }}>Marketplace</Text>
        <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2 }}>
          Fresh milk and traditional dairy products
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => load()}
          placeholder="Search products..."
          placeholderTextColor={colors.sage}
          returnKeyType="search"
          style={{
            backgroundColor: colors.ivory, borderRadius: 999, marginTop: 12,
            paddingHorizontal: 18, minHeight: 48, fontFamily: F, fontSize: 15, color: colors.ink }}
        />
      </View>

      {/* Category chips */}
      <View style={{ paddingHorizontal: 16, marginBottom: 4 }}>
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={CATEGORIES}
          keyExtractor={(c) => c}
          renderItem={({ item: cat }) => {
            const active = category === cat;
            return (
              <TouchableOpacity
                onPress={() => setCategory(cat)}
                style={{
                  backgroundColor: active ? colors.forest : colors.ivory,
                  borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9,
                  marginRight: 8, minHeight: 40, justifyContent: 'center',
                }}
              >
                <Text style={{ fontFamily: 'BricolageGrotesque_600SemiBold', fontSize: 13, color: active ? colors.cream : colors.ink }}>
                  {CATEGORY_LABELS[cat] ?? cat}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      </View>

      {/* Sort row */}
      <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginVertical: 8 }}>
        {SORTS.map((s) => {
          const active = sort === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              onPress={() => setSort(s.key)}
              style={{ marginRight: 16, paddingVertical: 6 }}
            >
              <Text
                style={{
                  fontFamily: active ? 'BricolageGrotesque_700Bold' : 'BricolageGrotesque_400Regular',
                  fontSize: 13, color: active ? colors.forest : colors.sage,
                  textDecorationLine: active ? 'underline' : 'none' }}
              >
                {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : error ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink, textAlign: 'center' }}>{error}</Text>
          <TouchableOpacity onPress={onRefresh} style={{ marginTop: 12 }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.forest }}>
              Try again
            </Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item, i) => String(item.id ?? i)}
          contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
          renderItem={({ item }) => <ProductRow item={item} onPress={() => openProduct(item.id)} />}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', marginTop: 48 }}>
              <Text style={{ fontFamily: F, fontSize: 15, color: colors.sage }}>No products found.</Text>
            </View>
          }
        />
      )}
    </View>
    </SafeAreaView>
  );
}
