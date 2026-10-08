// CategoryChips — horizontal product-category filter chips.
import React from 'react';
import { ScrollView, Pressable, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

export const HOME_CATEGORIES = ['All', 'Milk', 'Desi Ghee', 'Cheese', 'Butter', 'Yogurt'] as const;

interface Props {
  selected: string;
  onSelect: (category: string) => void;
}

/** Horizontally scrollable category filter chips. */
export function CategoryChips({ selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {HOME_CATEGORIES.map((c) => {
        const active = c === selected;
        return (
          <Pressable
            key={c}
            onPress={() => onSelect(c)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{c}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 20, paddingVertical: 8, gap: 8 },
  chip: {
    backgroundColor: colors.ivory, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.line,
  },
  chipActive: { backgroundColor: colors.forest, borderColor: colors.forest },
  label: { fontSize: 14, color: colors.ink, fontFamily: 'BricolageGrotesque_600SemiBold' },
  labelActive: { color: colors.ivory },
});
