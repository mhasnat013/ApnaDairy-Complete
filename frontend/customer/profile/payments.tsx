// Customer payments: outstanding dues banner + payment history.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { colors } from '../../../src/theme/colors';
import { paymentDues, paymentHistory, type Dues, type PaymentRecord } from '../../../src/services/customer/accountService';

function fmt(n: number): string {
  return `Rs ${n.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`;
}

export default function PaymentsScreen() {
  const [dues, setDues] = useState<Dues | null>(null);
  const [history, setHistory] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [d, h] = await Promise.all([paymentDues(), paymentHistory()]);
      setDues(d);
      setHistory(h);
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Payments" subtitle="Payment history and outstanding dues">
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {dues && dues.total_dues > 0 && (
            <Card style={[styles.card, styles.duesCard]}>
              <Text style={styles.duesTitle}>Outstanding dues</Text>
              <Text style={styles.duesAmount}>{fmt(dues.total_dues)}</Text>
              <Text style={styles.duesHint}>
                {dues.unpaid_orders.length} unpaid order{dues.unpaid_orders.length === 1 ? '' : 's'}.
                Please clear your dues to place new orders.
              </Text>
            </Card>
          )}

          <Text style={styles.section}>Payment history</Text>
          {history.map((p) => (
            <Card key={p.id} style={styles.card}>
              <View style={styles.row}>
                <View style={styles.info}>
                  <Text style={styles.amount}>{fmt(p.amount)}</Text>
                  <Text style={styles.detail}>{p.method.replace('_', ' ').toUpperCase()} • Order {p.order_id.slice(0, 8)}</Text>
                  <Text style={styles.detail}>{p.created_at ? new Date(p.created_at).toLocaleDateString('en-PK') : ''}</Text>
                </View>
                <Text style={[styles.status, { color: p.status === 'paid' || p.status === 'verified' ? colors.success : colors.amber }]}>
                  {p.status}
                </Text>
              </View>
            </Card>
          ))}
          {history.length === 0 && (
            <Text style={styles.empty}>No payments yet.</Text>
          )}
        </ScrollView>
      )}
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  card: { marginBottom: 12 },
  duesCard: { borderWidth: 2, borderColor: colors.amber },
  duesTitle: { fontSize: 15, fontWeight: '600', color: colors.ink },
  duesAmount: { fontSize: 32, color: colors.danger, fontFamily: 'BricolageGrotesque_700Bold', marginTop: 4 },
  duesHint: { fontSize: 14, color: colors.sage, marginTop: 8 },
  section: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold', marginTop: 8, marginBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  info: { flex: 1 },
  amount: { fontSize: 18, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  detail: { fontSize: 13, color: colors.sage, marginTop: 2 },
  status: { fontSize: 14, fontWeight: '700', textTransform: 'capitalize' },
  empty: { textAlign: 'center', color: colors.sage, marginVertical: 24, fontSize: 15 },
});
