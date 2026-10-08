// Login screen for the ApnaDairy unified app (v2).
// Role MUST be picked first via the segmented control — it is saved with the
// session (saveSession) and can never be changed afterwards.
// Farmer lane is wired to the real web-Supabase auth service.
// Customer lane is wired to the real customer (B2C) backend API.
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
import { useRouter } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { AppButton } from '../../../src/components/common/AppButton';
import { Logo } from '../../../src/components/common/Logo';
import { colors } from '../../../src/theme/colors';
import { loginWithSupabase, Role } from '../../../src/services/authService';
import { loginCustomer } from '../../../src/services/customerAuthService';
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

/** Login: role select -> email + password -> farmer home. */
export default function LoginScreen() {
  const router = useRouter();
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Validate, call the real auth service for the chosen role, route home. */
  const handleLogin = async () => {
    if (!role) {
      setError('Select Farmer or Customer first.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      if (role === 'customer') {
        // Real customer login via the B2C backend API.
        await loginCustomer(email.trim(), password);
        router.replace('/(customer)/home');
        return;
      }
      // Real Supabase Auth on the web project: the backend validates the JWT
      // and confirms a linked farmer profile (failure -> session cleared).
      await loginWithSupabase(email.trim(), password, role);
      router.replace('/(tabs)/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed. Please try again.');
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
      setError(e instanceof Error ? e.message : 'Google sign-in failed.');
    } finally {
      setGoogleLoading(false);
    }
  };

  return (
    <Screen title="Login" subtitle="Welcome to ApnaDairy">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <Logo size={96} />
            <Text style={styles.brandName}>ApnaDairy</Text>
            <Text style={styles.brandTag}>Pure milk, sold fairly</Text>
          </View>

          <Text style={styles.label}>Select your role</Text>
          <RoleSelector role={role} onSelect={(r) => { setRole(r); setError(null); }} />

          <Text style={styles.label}>Email</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={setEmail}
            placeholder="you@email.com"
            placeholderTextColor={colors.sage}
            keyboardType="email-address"
            autoCapitalize="none"
          />

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordRow}>
            <TextInput
              style={styles.passwordInput}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter your password"
              placeholderTextColor={colors.sage}
              secureTextEntry={!showPassword}
            />
            <Pressable onPress={() => setShowPassword((s) => !s)} style={styles.eye}>
              <Text style={styles.eyeText}>{showPassword ? 'Hide' : 'Show'}</Text>
            </Pressable>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.gap}>
            <AppButton label="Login" onPress={handleLogin} loading={loading} />
          </View>
          <View style={styles.gap}>
            <AppButton label="Continue with Google" variant="outline" onPress={handleGoogle} loading={googleLoading} />
          </View>

          <Pressable
            onPress={() => router.push({ pathname: '/(auth)/forgot-password', params: role ? { role } : {} })}
            style={styles.linkRow}
          >
            <Text style={styles.link}>Forgot password?</Text>
          </Pressable>
          <Pressable
            onPress={() => router.push({ pathname: '/(auth)/signup', params: role ? { role } : {} })}
            style={styles.linkRow}
          >
            <Text style={styles.link}>New account? Sign up</Text>
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
  input: {
    height: 52, backgroundColor: colors.ivory, borderRadius: 14, paddingHorizontal: 16,
    fontSize: 16, color: colors.ink, borderWidth: 1, borderColor: colors.line,
  },
  passwordRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ivory,
    borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingRight: 8,
  },
  passwordInput: { flex: 1, height: 52, paddingHorizontal: 16, fontSize: 16, color: colors.ink },
  eye: { paddingHorizontal: 8, paddingVertical: 12 },
  eyeText: { color: colors.forest, fontWeight: '700', fontSize: 14 },
  error: { color: colors.danger, fontSize: 14, marginTop: 12, fontWeight: '600' },
  gap: { marginTop: 12 },
  brand: { alignItems: 'center', marginTop: 8, marginBottom: 8 },
  brandName: { fontSize: 30, fontFamily: 'BricolageGrotesque_700Bold', color: colors.forest, marginTop: 10 },
  brandTag: { fontSize: 14, color: colors.sage, marginTop: 4 },
  linkRow: { alignItems: 'center', marginTop: 16, marginBottom: 24 },
  link: { color: colors.forest, fontWeight: '700', fontSize: 15 },
});
