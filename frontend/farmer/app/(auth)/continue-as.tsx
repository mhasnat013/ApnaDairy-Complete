// Continue-as screen: shown ONCE after a real Google sign-in when the Google
// user has NO role yet (no farmer profile row).
// The user picks Farmer or Customer; the role is IMMUTABLE once saved.
// Back signs the Google session out and returns to login WITHOUT saving.
// The Customer card is selectable (yellow selected state) but the customer
// app is not part of this farmer build, so continuing as Customer shows a
// notice instead of creating anything.
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen } from '../../src/components/common/Screen';
import { AppButton } from '../../src/components/common/AppButton';
import { colors } from '../../src/theme/colors';
import { clearSession } from '../../src/api/client';
import { linkGoogleProfile } from '../../src/api/googleAuth';
import { Role, getWebSupabaseClient } from '../../src/services/authService';

/** One big selectable role card. The selected card uses the landing-page
 *  yellow (amber token) so the choice is unmistakable. */
function RoleCard({
  role, title, desc, selected, onPress,
}: {
  role: Role; title: string; desc: string; selected: boolean; onPress: (r: Role) => void;
}) {
  return (
    <Pressable onPress={() => onPress(role)} style={[styles.card, selected && styles.cardSelected]}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardDesc}>{desc}</Text>
    </Pressable>
  );
}

/** Post-Google role picker (real flow — no mock tokens). */
export default function ContinueAsScreen() {
  const router = useRouter();
  const [selected, setSelected] = useState<Role | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState<string | null>(null);
  const [loadingUser, setLoadingUser] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill name/email from the Google session created by startGoogleOAuth().
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await getWebSupabaseClient().auth.getUser();
        const user = data?.user;
        if (!alive) return;
        if (!user) {
          setError('Google session not found. Please sign in with Google again.');
          return;
        }
        const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
        const name =
          (meta.full_name as string | undefined) ??
          (meta.name as string | undefined) ??
          '';
        setFullName(name);
        setEmail(user.email ?? null);
      } catch {
        if (alive) setError('User information not found. Please try again.');
      } finally {
        if (alive) setLoadingUser(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /** Create the profile row, save the session with the IMMUTABLE role, route on. */
  const handleContinue = async () => {
    if (!selected) {
      setError('Select Farmer or Customer to continue.');
      return;
    }
    if (selected === 'customer') {
      setError('The Customer app is not part of this farmer build yet. Please select Farmer to continue.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const { created } = await linkGoogleProfile(selected, { fullName, phone });
      router.replace(created ? '/onboarding/personal' : '/(tabs)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed. Please try again.');
      setSaving(false);
    }
  };

  /** Leave without choosing: drop the Google session, back to login. */
  const handleBack = async () => {
    try {
      await getWebSupabaseClient().auth.signOut();
    } finally {
      await clearSession();
      router.replace('/(auth)/login');
    }
  };

  if (loadingUser) {
    return (
      <Screen title="Continue as?" subtitle="What is your role in ApnaDairy?">
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.forest} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen title="Continue as?" subtitle="What is your role in ApnaDairy?">
      {email ? <Text style={styles.email}>{email}</Text> : null}

      <Text style={styles.label}>Your name</Text>
      <TextInput
        style={styles.input}
        value={fullName}
        onChangeText={setFullName}
        placeholder="Full name"
        placeholderTextColor={colors.sage}
      />

      <Text style={styles.label}>Phone number (optional)</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder="03xx-xxxxxxx"
        placeholderTextColor={colors.sage}
        keyboardType="phone-pad"
      />

      <View style={styles.list}>
        <RoleCard
          role="farmer"
          title="Farmer"
          desc="Sell your milk to area managers"
          selected={selected === 'farmer'}
          onPress={(r) => { setSelected(r); setError(null); }}
        />
        <RoleCard
          role="customer"
          title="Customer"
          desc="Buy pure milk"
          selected={selected === 'customer'}
          onPress={(r) => { setSelected(r); setError(null); }}
        />
      </View>

      <Text style={styles.note}>
        This selection is permanent. If you need the other role, create a separate account.
      </Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.gap}>
        <AppButton label="Continue" onPress={handleContinue} loading={saving} />
      </View>
      <Pressable onPress={handleBack} style={styles.linkRow}>
        <Text style={styles.link}>Go back</Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  email: { fontSize: 14, color: colors.sage, textAlign: 'center', marginTop: 4 },
  label: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 16, marginBottom: 8 },
  input: {
    backgroundColor: colors.ivory, borderRadius: 14,
    paddingHorizontal: 16, height: 52, fontSize: 16, color: colors.ink,
    borderWidth: 1, borderColor: colors.line,
  },
  list: { marginTop: 8 },
  card: {
    minHeight: 110, backgroundColor: colors.ivory, borderRadius: 20, padding: 16,
    marginTop: 12, borderWidth: 2, borderColor: colors.line,
    justifyContent: 'center',
  },
  cardSelected: { borderColor: colors.amber, backgroundColor: colors.amberTint },
  cardTitle: { fontSize: 22, fontWeight: '700', color: colors.ink },
  cardDesc: { fontSize: 15, color: colors.sage, marginTop: 6 },
  note: { fontSize: 13, color: colors.sage, marginTop: 16, textAlign: 'center', lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14, marginTop: 12, fontWeight: '600', textAlign: 'center' },
  gap: { marginTop: 12 },
  linkRow: { alignItems: 'center', marginTop: 16 },
  link: { color: colors.forest, fontWeight: '700', fontSize: 15 },
});
