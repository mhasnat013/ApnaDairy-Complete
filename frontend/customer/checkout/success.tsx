// Order confirmation after a successful checkout.
import React from 'react';
import { formatRs } from '../../src/utils/format';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { AppButton } from '../../../src/components/common/AppButton';
import { colors } from '../../../src/theme/colors';

export default function CheckoutSuccessScreen() {
  const params = useLocalSearchParams<{ orderId?: string; count?: string; total?: string }>();
  const orderId = typeof params.orderId === 'string' ? params.orderId : '';
  const count = typeof params.count === 'string' ? params.count : '1';
  const total = typeof params.total === 'string' ? params.total : '0';

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
<Screen title="Order placed">
      <View style={styles.wrap}>
        <Card style={styles.card}>
          <Text style={styles.heading}>Thank you! Order received.</Text>
          <Text style={styles.body}>
            {count} order{count === '1' ? '' : 's'} placed for {formatRs(Number(total))}.
            The area manager will confirm shortly.
          </Text>
          {orderId ? (
            <View style={styles.idBox}>
              <Text style={styles.idLabel}>Order ID</Text>
              <Text style={styles.idValue} selectable>{orderId}</Text>
            </View>
          ) : null}
        </Card>
        <View style={styles.cta}>
          <AppButton
            label="Track Order"
            onPress={() =>
              router.replace({
                pathname: '/customer/orders/track' as never,
                params: { orderId },
              })
            }
          />
          <View style={styles.gap} />
          <AppButton
            label="Continue Shopping"
            variant="outline"
            onPress={() => router.replace('/customer/marketplace' as never)}
          />
        </View>
      </View>
    </Screen>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: 'center' },
  card: { alignItems: 'center', paddingVertical: 28 },
  heading: {
    fontSize: 22, color: colors.forest,
    fontFamily: 'BricolageGrotesque_700Bold', marginBottom: 10, textAlign: 'center' },
  body: { fontSize: 15, color: colors.ink, textAlign: 'center', lineHeight: 22 },
  idBox: {
    marginTop: 16, backgroundColor: colors.cream, borderRadius: 16,
    padding: 12, width: '100%',
  },
  idLabel: { fontSize: 12, color: colors.sage, marginBottom: 4 },
  idValue: { fontSize: 13, color: colors.ink, fontWeight: '600' },
  cta: { marginTop: 24 },
  gap: { height: 12 },
});
