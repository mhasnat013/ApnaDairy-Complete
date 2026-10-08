// Customer email OTP verification: 6-box code input with 60s resend timer.
// Called after customer signup; the B2C backend emails a 6-digit code.
// On success the session is saved (role='customer') and the user goes to
// the customer home. If the backend asks for a manual login instead,
// the user is sent to the login screen.
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  NativeSyntheticEvent,
  TextInputKeyPressEventData,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../../src/components/common/Screen';
import { AppButton } from '../../../src/components/common/AppButton';
import { Card } from '../../../src/components/common/Card';
import { colors } from '../../../src/theme/colors';
import {
  verifyCustomerEmail,
  resendCustomerVerification,
} from '../../../src/services/customerAuthService';

const CODE_LENGTH = 6;
const RESEND_SECONDS = 60;

/** Read a single param that expo-router may give as string | string[]. */
function asString(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
}

/** 6-box email OTP entry with auto-advance and resend timer. */
export default function VerifyCustomerEmailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const email = asString(params.email);

  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [timer, setTimer] = useState(RESEND_SECONDS);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef<Array<TextInput | null>>([]);

  /** Countdown for the resend button. */
  useEffect(() => {
    if (timer <= 0) return;
    const id = setInterval(() => setTimer((t) => t - 1), 1000);
    return () => clearInterval(id);
  }, [timer]);

  /** Keep only the last typed digit; jump to the next box. */
  const handleChange = (text: string, index: number) => {
    const d = text.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = d;
    setDigits(next);
    setError(null);
    if (d && index < CODE_LENGTH - 1) inputs.current[index + 1]?.focus();
  };

  /** Backspace on an empty box moves focus to the previous box. */
  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number
  ) => {
    if (e.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  /** Submit the 6-digit code to the real B2C backend. */
  const handleVerify = async () => {
    const code = digits.join('');
    if (code.length !== CODE_LENGTH) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    if (!email) {
      setError('Email address is missing. Please sign up again.');
      return;
    }
    setError(null);
    setVerifying(true);
    try {
      const { loginRequired } = await verifyCustomerEmail(email, code);
      if (loginRequired) {
        router.replace({ pathname: '/(auth)/login', params: { role: 'customer' } });
      } else {
        router.replace('/(customer)/home');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  /** Resend the code via the real B2C backend. */
  const handleResend = async () => {
    if (timer > 0 || !email) return;
    setError(null);
    setResending(true);
    try {
      await resendCustomerVerification(email);
      setTimer(RESEND_SECONDS);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputs.current[0]?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not resend the code.');
    } finally {
      setResending(false);
    }
  };

  return (
    <Screen title="Verify email" subtitle="Enter the code we sent you">
      <Card style={styles.info}>
        <Text style={styles.infoText}>
          We sent a 6-digit verification code to{'\n'}
          <Text style={styles.infoEmail}>{email || 'your email'}</Text>
        </Text>
      </Card>

      <View style={styles.boxes}>
        {digits.map((d, i) => (
          <TextInput
            key={i}
            ref={(r) => {
              inputs.current[i] = r;
            }}
            style={[styles.box, d ? styles.boxFilled : null]}
            value={d}
            onChangeText={(t) => handleChange(t, i)}
            onKeyPress={(e) => handleKeyPress(e, i)}
            keyboardType="number-pad"
            maxLength={1}
            selectTextOnFocus
          />
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.gap}>
        <AppButton label="Verify" onPress={handleVerify} loading={verifying} />
      </View>

      <View style={styles.resendRow}>
        <Text style={styles.resendText}>Did not get the code? </Text>
        {timer > 0 ? (
          <Text style={styles.resendText}>Resend in {timer}s</Text>
        ) : (
          <Text style={styles.resendLink} onPress={handleResend}>
            {resending ? 'Sending...' : 'Resend code'}
          </Text>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  info: { marginTop: 8 },
  infoText: { fontSize: 14, color: colors.ink, lineHeight: 21, textAlign: 'center' },
  infoEmail: { fontWeight: '700', color: colors.forest },
  boxes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 24,
    paddingHorizontal: 8,
  },
  box: {
    width: 48,
    height: 56,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.ivory,
    fontSize: 22,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
  },
  boxFilled: { borderColor: colors.forest, borderWidth: 2 },
  error: { color: colors.danger, fontSize: 14, marginTop: 16, fontWeight: '600', textAlign: 'center' },
  gap: { marginTop: 24 },
  resendRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 20 },
  resendText: { fontSize: 14, color: colors.sage },
  resendLink: { fontSize: 14, color: colors.forest, fontWeight: '700' },
});
