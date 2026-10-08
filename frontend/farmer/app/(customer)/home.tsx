// Customer home screen — the landing screen after customer login/signup.
// Loads the real customer profile from the B2C backend (POST /api/v1/auth/me)
// and shows the account status. The full customer marketplace, cart, orders
// and other screens plug in here as they are merged from the customer build.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable, Alert } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Screen } from '../../src/components/common/Screen';
import { AppButton } from '../../src/components/common/AppButton';
import { Card } from '../../src/components/common/Card';
import { Logo } from '../../src/components/common/Logo';
import { colors } from '../../src/theme/colors';
import { getSession, clearSession } from '../../src/api/client';
import { getB2CBaseUrl } from '../../src/services/customerAuthService';

interface CustomerMe {
  user_id: string;
  customer_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  role: string;
  verification_status: string;
}

/** Fetch the signed-in customer's profile from the real B2C backend. */
async function fetchCustomerMe(): Promise<CustomerMe> {
  const session = await getSession();
  if (!session || session.role !== 'customer') {
    throw new Error('Not signed in as a customer.');
  }
  const res = await fetch(`${getB2CBaseUrl()}/api/v1/auth/me`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.token}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(typeof detail === 'string' ? detail : 'Could not load your profile.');
  }
  return data as CustomerMe;
}

export default function CustomerHomeScreen() {
  const router = useRouter();
  const [me, setMe] = useState<CustomerMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMe(await fetchCustomerMe());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your profile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, log out',
        style: 'destructive',
        onPress: async () => {
          await clearSession();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const displayName =
    [me?.first_name, me?.last_name].filter(Boolean).join(' ') || 'Customer';

  return (
    <Screen title="Home" subtitle="Welcome to ApnaDairy">
      <View style={styles.brand}>
        <Logo size={72} />
        <Text style={styles.brandName}>ApnaDairy</Text>
        <Text style={styles.brandTag}>Pure milk, delivered fresh</Text>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      ) : error || !me ? (
        <Card style={styles.card}>
          <Text style={styles.error}>{error ?? 'Something went wrong.'}</Text>
          <View style={styles.gap}>
            <AppButton label="Retry" onPress={load} />
          </View>
        </Card>
      ) : (
        <Card style={styles.card}>
          <Text style={styles.hello}>Hello, {displayName}!</Text>
          <Text style={styles.row}>Email: {me.email}</Text>
          {me.phone ? <Text style={styles.row}>Phone: {me.phone}</Text> : null}
          <Text style={styles.row}>
            Verification: {me.verification_status === 'verified' ? 'Verified' : 'Pending verification'}
          </Text>
          <Text style={styles.note}>
            Your customer account is ready. Marketplace, cart and orders are
            coming to this home screen next.
          </Text>
        </Card>
      )}

      <Pressable onPress={handleLogout} style={styles.linkRow}>
        <Text style={styles.link}>Log out</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  brandName: { fontSize: 26, fontFamily: 'BricolageGrotesque_700Bold', color: colors.forest, marginTop: 8 },
  brandTag: { fontSize: 14, color: colors.sage, marginTop: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  card: { marginTop: 12 },
  hello: { fontSize: 20, fontWeight: '700', color: colors.ink, marginBottom: 12 },
  row: { fontSize: 15, color: colors.ink, marginTop: 6 },
  note: { fontSize: 14, color: colors.sage, marginTop: 16, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  gap: { marginTop: 12 },
  linkRow: { alignItems: 'center', marginTop: 24 },
  link: { color: colors.forest, fontWeight: '700', fontSize: 15 },
});
