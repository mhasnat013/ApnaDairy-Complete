// Farmer Profile tab: identity header, verification card, hub menu, logout.
import React, { useCallback, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, Alert, ActivityIndicator, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { shouldRefetch } from '../../../src/utils/focusCache';
import { Screen } from '../../../src/components/common/Screen';
import { Card } from '../../../src/components/common/Card';
import { StatusBadge } from '../../../src/components/common/StatusBadge';
import { AppButton } from '../../../src/components/common/AppButton';
import { ErrorRetry } from '../../../src/components/common/ErrorRetry';
import { colors } from '../../../src/theme/colors';
import { signOutReal } from '../../../src/services/authService';
import { getProfile } from '../../../src/services/farmerService';
import type { Farmer } from '../../../src/types/farmerModels';

/** Hub menu rows and their routes. */
const MENU: Array<{ label: string; route: string }> = [
  { label: 'Personal details', route: '/profile/edit-personal' },
  { label: 'Farm details', route: '/profile/edit-farm' },
  { label: 'My documents', route: '/profile/my-documents' },
  { label: 'Payments', route: '/payments' },
  { label: 'Complaints', route: '/complaints' },
  { label: 'Notifications', route: '/notifications' },
  { label: 'Change password', route: '/profile/change-password' },
];

/** Badge label matching the farmer's verification status. */
function verificationLabel(status: Farmer['verificationStatus']): string {
  if (status === 'APPROVED') return 'Verified farmer';
  if (status === 'REJECTED') return 'Verification rejected';
  if (status === 'SUBMITTED' || status === 'PENDING') return 'Verification in review';
  return 'Verification incomplete';
}

/** Short line explaining the current verification state. */
function verificationMessage(status: Farmer['verificationStatus']): string {
  if (status === 'APPROVED') return 'Your profile is approved. You can sell milk to your manager.';
  if (status === 'REJECTED') return 'Your documents were rejected. Check the details and resubmit.';
  if (status === 'SUBMITTED' || status === 'PENDING') return 'Your documents are being reviewed. This usually takes 1-2 days.';
  return 'Complete your profile and upload documents to get verified.';
}

/** First letters of first + last name for the avatar circle. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}

/** Profile tab screen. */
export default function ProfileScreen() {
  const router = useRouter();
  const [farmer, setFarmer] = useState<Farmer | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /** Reload profile every time the tab regains focus (edits reflect instantly). */
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getProfile()
      .then(setFarmer)
      .catch(() => setError('Profile could not be loaded. Please check your connection.'))
      .finally(() => setLoading(false));
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!shouldRefetch('profile')) return; // 30s cache: skip refetch spam
      let alive = true;
      setLoading(true);
      setError(null);
      getProfile()
        .then((f) => { if (alive) setFarmer(f); })
        .catch(() => { if (alive) setError('Profile could not be loaded. Please check your connection.'); })
        .finally(() => { if (alive) setLoading(false); });
      return () => { alive = false; };
    }, []),
  );

  /** Ask for confirmation, clear the session, return to login. */
  const onLogout = () => {
    Alert.alert('Log out', 'Are you sure you want to log out?', [
      { text: 'No', style: 'cancel' },
      {
        text: 'Yes, log out',
        style: 'destructive',
        onPress: async () => {
          await signOutReal();
          router.replace('/(auth)/login');
        },
      },
    ]);
  };

  /** Loading state. */
  if (loading) {
    return (
      <Screen title="Profile">
        <View style={styles.center}><ActivityIndicator size="large" color={colors.forest} /></View>
      </Screen>
    );
  }

  /** Error state with retry. */
  if (error || !farmer) {
    return (
      <Screen title="Profile">
        <ErrorRetry message={error ?? 'Something went wrong.'} onRetry={load} />
      </Screen>
    );
  }

  return (
    <Screen title="Profile">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.list}>
        {/* Identity header card */}
        <Card>
          <View style={styles.headerRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(farmer.name)}</Text>
            </View>
            <View style={styles.headerInfo}>
              <Text style={styles.name}>{farmer.name}</Text>
              <Text style={styles.phone}>{farmer.phone}</Text>
            </View>
          </View>
          <View style={styles.badgeRow}>
            <StatusBadge status={farmer.verificationStatus} label={verificationLabel(farmer.verificationStatus)} />
          </View>
        </Card>

        {/* Verification status card */}
        <Card>
          <Text style={styles.cardTitle}>Verification status</Text>
          <Text style={styles.cardMessage}>{verificationMessage(farmer.verificationStatus)}</Text>
          <AppButton label="View verification status" variant="outline" onPress={() => router.push('/verification' as never)} />
        </Card>

        {/* Hub menu */}
        <Card style={styles.menuCard}>
          {MENU.map((item, i) => (
            <Pressable
              key={item.route}
              onPress={() => router.push(item.route as never)}
              style={[styles.menuRow, i < MENU.length - 1 && styles.menuDivider]}
            >
              <Text style={styles.menuLabel}>{item.label}</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          ))}
        </Card>

        {/* Logout */}
        <View style={styles.logoutWrap}>
          <AppButton label="Log out" variant="danger" onPress={onLogout} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: 32, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: {
    width: 64, height: 64, borderRadius: 32, backgroundColor: colors.forest,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: colors.ivory, fontSize: 22, fontFamily: 'BricolageGrotesque_700Bold' },
  headerInfo: { flex: 1, gap: 4 },
  name: { fontSize: 20, color: colors.ink, fontFamily: 'BricolageGrotesque_600SemiBold' },
  phone: { fontSize: 14, color: colors.sage, fontFamily: 'BricolageGrotesque_400Regular' },
  badgeRow: { marginTop: 12, alignSelf: 'flex-start' },
  cardTitle: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_700Bold' },
  cardMessage: { fontSize: 14, color: colors.sage, marginTop: 6, marginBottom: 14, fontFamily: 'BricolageGrotesque_400Regular' },
  menuCard: { paddingVertical: 0, paddingHorizontal: 16 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 0, paddingVertical: 16, minHeight: 56,
  },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  menuLabel: { fontSize: 16, color: colors.ink, fontFamily: 'BricolageGrotesque_500Medium' },
  chevron: { fontSize: 24, color: colors.sage, fontFamily: 'BricolageGrotesque_400Regular' },
  logoutWrap: { width: '100%' },
});
