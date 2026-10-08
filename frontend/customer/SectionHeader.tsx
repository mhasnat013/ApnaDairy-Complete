// SectionHeader — feed section title + optional "see all" action.
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';

interface Props {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
}

/** "Featured" ... "See all ›" row. */
export function SectionHeader({ title, actionLabel, onAction }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction}>
          <Text style={styles.action}>{actionLabel} ›</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, marginTop: 16, marginBottom: 8,
  },
  title: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  action: { fontSize: 14, color: colors.forest, fontFamily: 'BricolageGrotesque_600SemiBold' },
});
