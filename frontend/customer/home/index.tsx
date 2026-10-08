// app/customer/home/index.tsx
// Customer Home tab: greeting header, category chips, featured products
// carousel, nearby manager cards, and value picks.
// Data: GET /home/feed/me via homeService (falls back to public feed).
import React, { useCallback, useEffect, useState } from 'react';
import { formatRs } from '../../src/utils/format';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { getHomeFeed } from '../../../src/services/customer/homeService';
import type { HomeFeed, Product } from '../../../src/types/customerModels';
import { colors } from '../../../src/theme/colors';
import { font } from '../../../src/theme/theme';

const F = font.family;

function getInitials(name: string | null): string {
  if (!name) return 'A';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}


// Category values double as API filter parameters (sent via
// goMarketplace → marketplace screen → listProducts({ category })) — keep
// the backend-side strings unchanged and translate only labels elsewhere.
const CATEGORIES = ['Doodh', 'Dahi', 'Makhan', 'Desi Ghee', 'Paneer'];
// English display labels for the category chips. The chip VALUES stay unchanged:
// they are API filter parameters (sent via goMarketplace to the marketplace screen).
const CATEGORY_LABELS: Record<string, string> = {
  Doodh: 'Milk',
  Dahi: 'Yogurt',
  Makhan: 'Butter',
  'Desi Ghee': 'Desi Ghee',
  Paneer: 'Paneer',
};

// Small product card for horizontal carousels.
function ProductCard({ item, onPress }: { item: Product; onPress: () => void }): React.JSX.Element {
  const price = item.final_price ?? item.price;
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        width: 150, backgroundColor: colors.ivory, borderRadius: 20,
        padding: 12, marginRight: 12,
      }}
    >
      <View
        style={{
          height: 84, borderRadius: 16, backgroundColor: colors.cream,
          alignItems: 'center', justifyContent: 'center', marginBottom: 8,
        }}
      >
        <Text style={{ fontFamily: F, fontSize: 12, color: colors.sage }}>Photo</Text>
      </View>
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 14, color: colors.ink }} numberOfLines={1}>
        {item.name ?? 'Product'}
      </Text>
      <Text style={{ fontFamily: F, fontSize: 12, color: colors.sage, marginTop: 2 }} numberOfLines={1}>
        {item.manager?.center_name ?? ''}
      </Text>
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.forest, marginTop: 4 }}>
        {formatRs(price)}
        {item.unit ? <Text style={{ fontSize: 12, color: colors.sage }}> / {item.unit}</Text> : null}
      </Text>
    </TouchableOpacity>
  );
}

// Manager card: shop name, city.
function ManagerCard({ manager }: { manager: Record<string, unknown> }): React.JSX.Element {
  const name = String(manager['center_name'] ?? manager['name'] ?? 'Shop');
  const city = String(manager['city'] ?? '');
  return (
    <View
      style={{
        backgroundColor: colors.ivory, borderRadius: 20, padding: 16,
        marginBottom: 10, flexDirection: 'row', alignItems: 'center',
      }}
    >
      <View
        style={{
          width: 48, height: 48, borderRadius: 20, backgroundColor: colors.forest,
          alignItems: 'center', justifyContent: 'center', marginRight: 12,
        }}
      >
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.cream }}>
          {getInitials(name)}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 16, color: colors.ink }} numberOfLines={1}>
          {name}
        </Text>
        <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage, marginTop: 2 }}>
          {city}
        </Text>
      </View>
    </View>
  );
}

function SectionTitle({ title, onSeeAll }: { title: string; onSeeAll?: () => void }): React.JSX.Element {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 18 }}>
      <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 17, color: colors.ink }}>{title}</Text>
      {onSeeAll ? (
        <TouchableOpacity onPress={onSeeAll}>
          <Text style={{ fontFamily: 'BricolageGrotesque_600SemiBold', fontSize: 13, color: colors.forest }}>View all</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export default function CustomerHomeScreen(): React.JSX.Element {
  const [feed, setFeed] = useState<HomeFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      setFeed(await getHomeFeed());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The feed could not be loaded.');
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

  const openProduct = useCallback((id: string | null) => {
    if (id) router.push(`/customer/marketplace/${encodeURIComponent(id)}`);
  }, []);

  const goMarketplace = useCallback((category?: string) => {
    router.push({
      pathname: '/customer/marketplace',
      params: category ? { category } : {},
    });
  }, []);

  if (loading && !feed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={colors.forest} />
        <Text style={{ fontFamily: F, fontSize: 14, color: colors.sage, marginTop: 12 }}>Loading...</Text>
      </View>
    );
  }

  if (error && !feed) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 }}>
        <Text style={{ fontFamily: F, fontSize: 16, color: colors.ink, textAlign: 'center', marginBottom: 16 }}>
          {error}
        </Text>
        <TouchableOpacity
          onPress={() => {
            setLoading(true);
            load().finally(() => setLoading(false));
          }}
          style={{ backgroundColor: colors.forest, borderRadius: 999, paddingHorizontal: 28, paddingVertical: 14 }}
        >
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 15, color: colors.cream }}>
            Please try again
          </Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!feed) {
    return <View style={{ flex: 1, backgroundColor: colors.cream }} />;
  }

  const featured = (feed.featured ?? []) as unknown as Product[];
  const valuePicks = (feed.value_picks ?? []) as unknown as Product[];
  const managers = feed.nearby_managers ?? [];

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<ScrollView
      style={{ flex: 1, backgroundColor: colors.cream }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.forest} />}
    >
      {error ? (
        <View style={{ backgroundColor: colors.dangerTint, borderRadius: 16, padding: 14, marginBottom: 12 }}>
          <Text style={{ fontFamily: F, fontSize: 14, color: colors.ink }}>{error}</Text>
          <TouchableOpacity onPress={onRefresh} style={{ marginTop: 8 }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 14, color: colors.forest }}>
              Please try again
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Greeting header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
        <View
          style={{
            width: 52, height: 52, borderRadius: 20, backgroundColor: colors.forest,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 18, color: colors.cream }}>
            {getInitials(feed.customer_name)}
          </Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={{ fontFamily: F, fontSize: 13, color: colors.sage }}>
            {feed.greeting || 'Hello,'}
          </Text>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 20, color: colors.ink }}>
            {feed.customer_name ?? 'Guest'}
          </Text>
        </View>
        {!feed.is_verified ? (
          <View style={{ backgroundColor: colors.amber, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 }}>
            <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 11, color: colors.ink }}>Verification pending</Text>
          </View>
        ) : null}
      </View>

      {/* Dues banner */}
      {feed.pending_dues > 0 ? (
        <View style={{ backgroundColor: colors.amber, borderRadius: 16, padding: 14, marginBottom: 4 }}>
          <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', fontSize: 14, color: colors.ink }}>
            Outstanding dues: {formatRs(feed.pending_dues)}
          </Text>
          <Text style={{ fontFamily: F, fontSize: 12, color: colors.ink, marginTop: 2 }}>
            Please clear your outstanding dues to keep placing new orders.
          </Text>
        </View>
      ) : null}

      {/* Category chips */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
        {CATEGORIES.map((cat) => {
          const active = activeCat === cat;
          return (
            <TouchableOpacity
              key={cat}
              onPress={() => {
                setActiveCat(active ? null : cat);
                if (!active) goMarketplace(cat);
              }}
              style={{
                backgroundColor: active ? colors.forest : colors.ivory,
                borderRadius: 999, paddingHorizontal: 18, paddingVertical: 10,
                marginRight: 10, minHeight: 44, justifyContent: 'center',
              }}
            >
              <Text style={{ fontFamily: 'BricolageGrotesque_600SemiBold', fontSize: 14, color: active ? colors.cream : colors.ink }}>
                {CATEGORY_LABELS[cat] ?? cat}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Featured carousel */}
      {featured.length > 0 ? (
        <View>
          <SectionTitle title="Featured" onSeeAll={() => goMarketplace()} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {featured.map((p, i) => (
              <ProductCard key={String(p.id ?? i)} item={p} onPress={() => openProduct(p.id)} />
            ))}
          </ScrollView>
        </View>
      ) : null}

      {/* Nearby managers */}
      {managers.length > 0 ? (
        <View>
          <SectionTitle title="Nearby shops" />
          {managers.slice(0, 3).map((m, i) => (
            <ManagerCard key={String((m as Record<string, unknown>)['id'] ?? i)} manager={m as Record<string, unknown>} />
          ))}
        </View>
      ) : null}

      {/* Value picks */}
      {valuePicks.length > 0 ? (
        <View>
          <SectionTitle title="Great value" onSeeAll={() => goMarketplace()} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {valuePicks.map((p, i) => (
              <ProductCard key={String(p.id ?? `v${i}`)} item={p} onPress={() => openProduct(p.id)} />
            ))}
          </ScrollView>
        </View>
      ) : null}
    </ScrollView>
    </SafeAreaView>
  );
}
