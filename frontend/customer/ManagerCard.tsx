// ManagerCard — area manager / shop row card for the home feed.
import React from 'react';
import { font } from './src/theme/theme';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

const F = font.family;

export interface HomeManager {
  id: string;
  center_name?: string | null;
  city?: string | null;
  distance_km?: number | null;
}

interface Props {
  manager: HomeManager;
  onPress?: () => void;
}

/** Single nearby-manager row. */
export function ManagerCard({ manager, onPress }: Props) {
  return (
    <Pressable onPress={onPress} style={styles.card}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{(manager.center_name ?? 'M').slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.col}>
        <Text style={styles.name} numberOfLines={1}>{manager.center_name ?? 'Milk shop'}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          {[manager.city, manager.distance_km != null ? `${Number(manager.distance_km).toFixed(1)} km` : null]
            .filter(Boolean).join(' · ')}
        </Text>
      </View>
      <Text style={styles.arrow}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ivory,
    borderRadius: 20, padding: 14, marginHorizontal: 20, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 8, elevation: 2,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 20, backgroundColor: colors.cream,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  avatarText: { fontSize: 20, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
  col: { flex: 1 },
  name: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  sub: { fontSize: 13, color: colors.sage, marginTop: 2, fontFamily: F },
  arrow: { fontSize: 24, color: colors.sage, marginLeft: 8 },
});
