// GreetingHeader — personalized greeting + verified badge + dues banner.
import React from 'react';
import { font } from './src/theme/theme';
import { formatRs } from './src/utils/format';
import { View, Text, StyleSheet } from 'react-native';
import { colors } from '../../theme/colors';
import { StatusBadge } from '../common/StatusBadge';

const F = font.family;

interface Props {
  greeting: string;
  customerName: string | null;
  isVerified: boolean;
  pendingDues: number;
  unreadNotifications: number;
  onDuesPress?: () => void;
}

/** Top of the customer home: greeting, name, verification + dues. */
export function GreetingHeader({ greeting, customerName, isVerified, pendingDues, onDuesPress }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <View style={styles.textCol}>
          <Text style={styles.greeting}>{greeting}</Text>
          {customerName ? <Text style={styles.name}>{customerName}</Text> : null}
        </View>
        <StatusBadge status={isVerified ? 'APPROVED' : 'PENDING'} label={isVerified ? 'Verified' : 'Unverified'} />
      </View>
      {!isVerified ? (
        <Text style={styles.hint}>Complete verification to start ordering fresh milk.</Text>
      ) : null}
      {pendingDues > 0 ? (
        <View style={styles.dues}>
          <Text style={styles.duesText}>Pending dues: {formatRs(pendingDues)}</Text>
          {onDuesPress ? <Text style={styles.duesLink} onPress={onDuesPress}>Pay now</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  textCol: { flex: 1, marginRight: 12 },
  greeting: { fontSize: 15, color: colors.sage, fontFamily: F },
  name: { fontSize: 24, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginTop: 2 },
  hint: { fontSize: 13, color: colors.sage, marginTop: 8, fontFamily: F },
  dues: {
    marginTop: 12, backgroundColor: colors.amberTint, borderRadius: 16, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  duesText: { fontSize: 14, color: colors.amberDark, fontFamily: 'BricolageGrotesque_700Bold' },
  duesLink: { fontSize: 14, color: colors.forest, fontFamily: 'BricolageGrotesque_700Bold' },
});
