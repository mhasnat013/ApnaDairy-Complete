// OAuth callback route: handles apnadairy://auth/callback?code=...
//
// NORMAL flow: WebBrowser.openAuthSessionAsync() (see src/api/googleAuth.ts)
// intercepts the redirect and startGoogleOAuth() finishes the sign-in —
// this screen is never shown.
//
// COLD-START flow: if Android kills the app while the system browser is
// open, the redirect re-launches the app fresh and the pending
// openAuthSessionAsync() promise is gone. Expo Router then lands here with
// the PKCE `code` as a search param. We exchange it for the session
// (the PKCE verifier survives in persistent storage) and route on:
//   - existing farmer profile -> /(tabs)/home
//   - no profile yet          -> /(auth)/continue-as (role picker)
// Any failure shows a readable message and returns to login.
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Screen } from '../../src/components/common/Screen';
import { colors } from '../../src/theme/colors';
import { getWebSupabaseClient } from '../../src/services/authService';
import { getApiBaseUrl, saveSession } from '../../src/api/client';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    code?: string;
    error?: string;
    error_description?: string;
  }>();
  const [message, setMessage] = useState('Completing Google sign-in...');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const errParam = Array.isArray(params.error) ? params.error[0] : params.error;
        if (errParam) {
          const desc = Array.isArray(params.error_description)
            ? params.error_description[0]
            : params.error_description;
          throw new Error(
            typeof desc === 'string' && desc ? desc : 'Google sign-in failed. Please try again.',
          );
        }
        const code = Array.isArray(params.code) ? params.code[0] : params.code;
        if (!code) {
          throw new Error('No authorization code received. Please try again.');
        }

        const supabase = getWebSupabaseClient();
        const { data, error: exError } = await supabase.auth.exchangeCodeForSession(code);
        if (exError || !data.session) {
          throw new Error(exError?.message || 'Could not complete Google sign-in.');
        }
        const session = data.session;

        // Ask the farmer backend whether this Google user already has a profile.
        let isFarmer = false;
        try {
          const res = await fetch(`${getApiBaseUrl()}/api/v1/auth/me`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${session.access_token}` },
          });
          isFarmer = res.ok;
        } catch {
          isFarmer = false;
        }
        if (!alive) return;

        if (isFarmer) {
          await saveSession(session.access_token, 'farmer', session.refresh_token ?? undefined);
          router.replace('/(tabs)/home');
        } else {
          router.replace('/(auth)/continue-as');
        }
      } catch (e) {
        if (!alive) return;
        setMessage(e instanceof Error ? e.message : 'Google sign-in failed. Please try again.');
        setTimeout(() => {
          if (alive) router.replace('/(auth)/login');
        }, 2500);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen title="Signing in" subtitle="Please wait">
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.forest} />
        <Text style={styles.message}>{message}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  message: { fontSize: 15, color: colors.sage, marginTop: 16, textAlign: 'center' },
});
