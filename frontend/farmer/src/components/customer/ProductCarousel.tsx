// ProductCarousel — horizontal scroll of product cards (featured / value picks).
import React from 'react';
import { ScrollView, Pressable, View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import type { Product } from '../../types/customerModels';

interface Props {
  products: Product[];
  onPress: (product: Product) => void;
}

function priceOf(p: Product): string {
  const v = p.final_price ?? p.price ?? 0;
  return `Rs ${Number(v).toFixed(0)}`;
}

/** Horizontal product card rail. */
export function ProductCarousel({ products, onPress }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {products.map((p, i) => (
        <Pressable key={String(p.id ?? i)} onPress={() => onPress(p)} style={styles.card}>
          <View style={styles.thumb}>
            <Text style={styles.thumbText}>{(p.name ?? '?').slice(0, 1).toUpperCase()}</Text>
          </View>
          <Text style={styles.name} numberOfLines={2}>{p.name ?? 'Product'}</Text>
          <Text style={styles.manager} numberOfLines={1}>{p.manager?.center_name ?? ''}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{priceOf(p)}</Text>
            {p.unit ? <Text style={styles.unit}>/{p.unit}</Text> : null}
          </View>
          {p.discount_pct ? (
            <View style={styles.offBadge}>
              <Text style={styles.offText}>{Number(p.discount_pct).toFixed(0)}% off</Text>
            </View>
          ) : null}
        </Pressable>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 20, paddingVertical: 4, gap: 12 },
  card: {
    width: 150, backgroundColor: colors.ivory, borderRadius: 20, padding: 12,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  thumb: {
    height: 90, borderRadius: 14, backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center', marginBottom: 8,
  },
  thumbText: { fontSize: 32, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  name: { fontSize: 14, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', minHeight: 36 },
  manager: { fontSize: 12, color: colors.sage, marginTop: 2, fontFamily: 'BricolageGrotesque_400Regular' },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: 6 },
  price: { fontSize: 16, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  unit: { fontSize: 12, color: colors.sage, marginLeft: 2, fontFamily: 'BricolageGrotesque_400Regular' },
  offBadge: {
    position: 'absolute', top: 8, right: 8, backgroundColor: colors.amber,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3,
  },
  offText: { fontSize: 11, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
});
