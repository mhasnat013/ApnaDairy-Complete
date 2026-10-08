// Order status chip — theme colors, no emojis.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../../src/theme/colors';
import { statusLabel, statusTone } from '../../../src/services/customer/orderService';

const TONE: Record<string, { bg: string; fg: string }> = {
  warning: { bg: colors.amberTint, fg: colors.amberDark },
  info: { bg: '#dbe9f4', fg: '#1d5c8a' },
  success: { bg: '#dcefe3', fg: colors.success },
  danger: { bg: colors.dangerTint, fg: colors.danger },
  muted: { bg: '#e8e2d2', fg: colors.sage },
};

export function OrderStatusChip({ status }: { status: string }) {
  const c = TONE[statusTone(status)] ?? TONE.muted;
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      <Text style={[styles.text, { color: c.fg }]}>{statusLabel(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, alignSelf: 'flex-start' },
  text: { fontSize: 12, fontFamily: 'BricolageGrotesque_700Bold' },
});
