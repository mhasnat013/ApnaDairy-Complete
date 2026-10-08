// Signup screen for the ApnaDairy unified app (v2).
// Same role-first pattern as login. Role hint card changes with selection.
// Farmer success -> onboarding (detail entry). Google -> Continue-as.
// Customer success -> email OTP verification, then customer home.
import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { AppButton } from '../../../src/components/common/AppButton';
import { Card } from '../../../src/components/common/Card';
import { Logo } from '../../../src/components/common/Logo';
import { colors } from '../../../src/theme/colors';
import { signupWithSupabase, Role } from '../../../src/services/authService';
import { signupCustomer } from '../../../src/services/customerAuthService';
import { startGoogleOAuth } from '../../../src/api/googleAuth';

/** Two-option segmented control: Farmer | Customer. Nothing pre-selected.
 *  The selected option uses the landing-page yellow (amber token). */
function RoleSelector({ role, onSelect }: { role: Role | null; onSelect: (r: Role) => void }) {
  const options: Role[] = ['farmer', 'customer'];
  return (
    <View style={styles.segment}>
      {options.map((o) => (
        <Pressable
          key={o}
          onPress={() => onSelect(o)}
          style={[styles.segmentBtn, role === o && styles.segmentActive]}
        >
          <Text style={[styles.segmentText, role === o && styles.segmentTextActive]}>
            {o === 'farmer' ? 'Farmer' : 'Customer'}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Keep only digits for Pakistani mobile validation. */
function digitsOnly(v: string): string {
  return v.replace(/\D/g, '');
}

/** Signup: role -> details -> onboarding. Google -> Continue-as. */
export default function SignupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ role?: string }>();
  const initialRole: Role | null =
    params.role === 'farmer' || params.role === 'customer' ? params.role : null;

  const [role, setRole] = useState<Role | null>(initialRole);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [terms, setTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Validate all fields, create the account for the chosen role. */
  const handleSignup = async () => {
    if (!role) {
      setError('Please select Farmer or Customer first.');
      return;
    }
    if (!name.trim()) {
      setError('Please enter your name.');
      return;
    }
    if (!email.includes('@')) {
      setError('Please enter a valid email address.');
      return;
    }
    const digits = digitsOnly(phone);
    if (!/^03\d{9}$/.test(digits)) {
      setError('Please enter a valid Pakistani mobile number (03xx-xxxxxxx).');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirm) {
      setError('Both passwords must match.');
      return;
    }
    if (!terms) {
      setError('Please accept the terms and conditions to continue.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (role === 'customer') {
        // Real customer signup via the B2C backend. The backend sends a
        // 6-digit email OTP; verify it on the next screen.
        const nameParts = name.trim().split(/\s+/);
        await signupCustomer({
          firstName: nameParts[0] || '',
          lastName: nameParts.slice(1).join(' ') || '',
          email: email.trim(),
          phone: digits,
          password,
        });
        router.push({
          pathname: '/(auth)/verify-customer-email',
          params: { email: email.trim() },
        });
        return;
      }
      // Real farmer signup: the backend creates the Supabase Auth user AND
      // the farmer profile row, then signs in directly. Next: onboarding.
      await signupWithSupabase(name.trim(), email.trim(), digits, password, role);
      router.push('/onboarding/personal');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signup failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  /** Real Google sign-in (Supabase PKCE). Existing farmer -> home directly;
   *  existing customer -> customer home directly;
   *  new Google user -> Continue-as screen to pick the role (immutable). */
  const handleGoogle = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      const outcome = await startGoogleOAuth();
      if (outcome.kind === 'customer') {
        router.replace('/(customer)/home');
      } else if (outcome.kind === 'farmer') {
        router.replace('/(tabs)/home');
      } else {
        router.push('/(auth)/continue-as');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google signup failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Screen title="Signup" subtitle="Create a new account">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo size={96} />
            <Text style={styles.brandName}>ApnaDairy</Text>
            <Text style={styles.brandTag}>Pure milk, sold fairly</Text>
          </View>

          <Text style={styles.label}>Who are you?</Text>
          <RoleSelector role={role} onSelect={(r) => { setRole(r); setError(null); }} />

          {role ? (
            <Card style={styles.hint}>
              <Text style={styles.hintText}>
                {role === 'farmer'
                  ? 'Farmer: sell your milk to area managers at fair prices.'
                  : 'Customer: buy pure milk from verified area managers.'}
              </Text>
            </Card>
          ) : null}

          <Text style={styles.label}>Full name</Text>
          <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Muhammad Ramzan" placeholderTextColor={colors.sage} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input} value={email} onChangeText={setEmail} placeholder="you@email.com"
            placeholderTextColor={colors.sage} keyboardType="email-address" autoCapitalize="none"
          />

          <Text style={styles.label}>Mobile number</Text>
          <TextInput
            style={styles.input} value={phone} onChangeText={setPhone} placeholder="03xx-xxxxxxx"
            placeholderTextColor={colors.sage} keyboardType="phone-pad" maxLength={12}
          />

          <Text style={styles.label}>Password (min 8 characters)</Text>
          <TextInput
            style={styles.input} value={password} onChangeText={setPassword} placeholder="Password"
            placeholderTextColor={colors.sage} secureTextEntry
          />

          <Text style={styles.label}>Confirm password</Text>
          <TextInput
            style={styles.input} value={confirm} onChangeText={setConfirm} placeholder="Confirm password"
            placeholderTextColor={colors.sage} secureTextEntry
          />

          <Pressable onPress={() => setTerms((t) => !t)} style={styles.termsRow}>
            <View style={[styles.checkbox, terms && styles.checkboxOn]}>
              {terms ? <Text style={styles.check}>✓</Text> : null}
            </View>
            <Text style={styles.termsText}>I agree to the terms and conditions.</Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.gap}>
            <AppButton label="Create account" onPress={handleSignup} loading={loading} />
          </View>
          <View style={styles.gap}>
            <AppButton label="Sign up with Google" variant="outline" onPress={handleGoogle} loading={googleLoading} />
          </View>

          <Pressable onPress={() => router.push('/(auth)/login')} style={styles.linkRow}>
            <Text style={styles.link}>Already have an account? Log in</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  label: { fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 16, marginBottom: 8 },
  segment: { flexDirection: 'row', backgroundColor: colors.ivory, borderRadius: 999, padding: 4, borderWidth: 1, borderColor: colors.line },
  segmentBtn: { flex: 1, height: 48, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.amber },
  segmentText: { fontSize: 16, fontWeight: '700', color: colors.sage },
  segmentTextActive: { color: colors.ink },
  hint: { marginTop: 12, borderLeftWidth: 4, borderLeftColor: colors.amber },
  hintText: { fontSize: 14, color: colors.ink, lineHeight: 20 },
  input: {
    height: 52, backgroundColor: colors.ivory, borderRadius: 14, paddingHorizontal: 16,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  termsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },
  checkbox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2, borderColor: colors.forest,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  checkboxOn: { backgroundColor: colors.forest },
  check: { color: colors.ivory, fontWeight: '700' },
  termsText: { fontSize: 14, color: colors.ink, flex: 1 },
  error: { color: colors.danger, fontSize: 14, marginTop: 12, fontWeight: '600' },
  gap: { marginTop: 12 },
  brand: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  brandName: { fontSize: 30, fontFamily: 'BricolageGrotesque_700Bold', color: colors.forest, marginTop: 10 },
  brandTag: { fontSize: 14, color: colors.sage, marginTop: 4 },
  linkRow: { alignItems: 'center', marginTop: 16, marginBottom: 24 },
  link: { color: colors.forest, fontWeight: '700', fontSize: 15 },
});
