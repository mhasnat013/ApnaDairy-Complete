// Customer profile tab: identity card, verification banner, menu navigation.
import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { colors } from '../../../src/theme/colors';
import { getProfile, logout, type CustomerProfile } from '../../../src/services/customer/accountService';
import { clearSession } from '../../../src/api/client';

interface MenuItem {
  label: string;
  hint: string;
  route: string;
}

const MENU: MenuItem[] = [
  { label: 'Addresses', hint: 'Delivery addresses', route: '/customer/profile/addresses' },
  { label: 'Payments', hint: 'Payment history and outstanding dues', route: '/customer/profile/payments' },
  { label: 'Complaints', hint: 'File a complaint', route: '/customer/profile/complaints' },
  { label: 'Notifications', hint: 'Order updates', route: '/customer/profile/notifications' },
  { label: 'Verification', hint: 'Account verification', route: '/customer/verification' },
  { label: 'Permanent customer', hint: 'Monthly subscription', route: '/customer/permanent' },
];

function statusLabel(status: string): string {
  switch (status) {
    case 'approved': return 'Verified';
    case 'rejected': return 'Rejected';
    case 'in_review': return 'Under review';
    default: return 'Pending verification';
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'approved': return colors.success;
    case 'rejected': return colors.danger;
    default: return colors.amber;
  }
}

export default function CustomerProfileScreen() {
  const router = useRouter();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setProfile(await getProfile());
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout', style: 'destructive',
        onPress: async () => {
          try { await logout(); } catch { /* stateless anyway */ }
          await clearSession();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || 'Customer';

  return (
    <Screen title="Profile" subtitle="ApnaDairy">
      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <Card>
            <View style={styles.identityRow}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.identityText}>
                <Text style={styles.name}>{name}</Text>
                <Text style={styles.sub}>{profile?.phone || ''}</Text>
                <Text style={styles.sub}>{profile?.email || ''}</Text>
              </View>
            </View>
            <View style={[styles.banner, { borderColor: statusColor(profile?.verification_status || 'pending') }]}>
              <Text style={[styles.bannerText, { color: statusColor(profile?.verification_status || 'pending') }]}>
                {statusLabel(profile?.verification_status || 'pending')}
              </Text>
              {(profile?.verification_status || 'pending') !== 'approved' && (
                <Pressable onPress={() => router.push('/customer/verification' as never)}>
                  <Text style={styles.bannerLink}>Complete verification</Text>
                </Pressable>
              )}
            </View>
          </Card>

          <View style={styles.menu}>
            {MENU.map((item) => (
              <Pressable
                key={item.route}
                style={styles.menuRow}
                onPress={() => router.push(item.route as never)}
              >
                <View>
                  <Text style={styles.menuLabel}>{item.label}</Text>
                  <Text style={styles.menuHint}>{item.hint}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.menuRow, styles.logoutRow]} onPress={handleLogout}>
              <Text style={styles.logoutLabel}>Logout</Text>
            </Pressable>
          </View>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 32 },
  identityRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center', marginRight: 16,
  },
  avatarText: { color: colors.ivory, fontSize: 26, fontFamily: 'BricolageGrotesque_700Bold' },
  identityText: { flex: 1 },
  name: { fontSize: 20, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  sub: { fontSize: 14, color: colors.sage, marginTop: 2 },
  banner: {
    marginTop: 16, borderWidth: 1.5, borderRadius: 12, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  bannerText: { fontSize: 15, fontFamily: 'BricolageGrotesque_700Bold' },
  bannerLink: { fontSize: 14, fontWeight: '600', color: colors.forest, textDecorationLine: 'underline' },
  menu: { marginTop: 16 },
  menuRow: {
    backgroundColor: colors.ivory, borderRadius: 16, padding: 16, marginBottom: 10,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  menuLabel: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  menuHint: { fontSize: 13, color: colors.sage, marginTop: 2 },
  chevron: { fontSize: 24, color: colors.sage },
  logoutRow: { justifyContent: 'center' },
  logoutLabel: { fontSize: 16, color: colors.danger, fontFamily: 'BricolageGrotesque_700Bold' },
});
