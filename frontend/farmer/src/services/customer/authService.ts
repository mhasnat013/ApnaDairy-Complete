// Customer auth service — B2C backend (/auth) + shared Supabase session.
// Passwords never touch our backend on login: supabase-js talks to Supabase
// Auth directly; the access token is saved via saveSession() and sent as
// Authorization: Bearer on every B2C call. Google sign-in reuses the
// farmer authService's Supabase helpers.
import { b2cPost } from '../../api/b2cClient';
import { saveSession, clearSession, getSession } from '../../api/client';
import type { CustomerProfile } from '../../types/customerModels';

/** Signup payload — creates the Supabase user + customer_profiles row. */
export interface CustomerSignupInput {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  phone: string;
}

interface SignupOut {
  user_id: string;
  email: string;
  verification_required?: boolean;
  role?: string;
  verification_status?: string;
}

interface LoginOut {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
}

interface VerifyEmailOut {
  access_token?: string | null;
  refresh_token?: string | null;
  user_id: string;
  email: string;
  verified: boolean;
  login_required?: boolean;
}

/** Register a new customer via the REAL email-OTP flow.
 *
 * The backend creates the Supabase user UNCONFIRMED and Supabase sends the
 * 6-digit confirmation email. No session tokens are returned here — the
 * caller must route to the verify-email screen next.
 */
export async function signupCustomer(input: CustomerSignupInput): Promise<SignupOut> {
  if (!input.email.trim() || !input.password || !input.first_name.trim() || !input.phone.trim()) {
    throw new Error('All fields are required.');
  }
  return b2cPost<SignupOut>('/api/v1/auth/signup', { ...input, role: 'customer' });
}

/** Verify the 6-digit email OTP. On success saves the session tokens and
 * returns the profile; throws a readable error for wrong/expired codes. */
export async function verifyEmail(email: string, token: string): Promise<CustomerProfile> {
  const clean = token.replace(/\D/g, '');
  if (clean.length < 4) throw new Error('Enter the complete code.');
  const res = await b2cPost<VerifyEmailOut>('/api/v1/auth/verify-email', {
    email: email.trim(),
    token: clean,
  });
  if (res.login_required || !res.access_token) {
    // Verified but no session issued — user logs in with their password.
    throw new Error('Your email has been verified. Please log in.');
  }
  await saveSession(res.access_token, 'customer', res.refresh_token ?? undefined);
  const profile = await getMyProfile();
  if (profile.role !== 'customer') {
    await clearSession();
    throw new Error('This account is not a customer account.');
  }
  return profile;
}

/** Re-send the signup confirmation email. Always succeeds (no enumeration). */
export async function resendVerification(email: string): Promise<void> {
  if (!email.trim()) throw new Error('Enter your email.');
  await b2cPost<{ sent: boolean }>('/api/v1/auth/resend-verification', {
    email: email.trim(),
  });
}

/**
 * Email+password login through the backend (returns Supabase session tokens).
 * Saves the access + refresh tokens so all later B2C calls are authenticated,
 * and verifies the linked profile is actually a customer account.
 */
export async function loginCustomer(email: string, password: string): Promise<CustomerProfile> {
  if (!email.trim()) throw new Error('Enter your email.');
  if (!password) throw new Error('Enter your password.');
  const res = await b2cPost<LoginOut>('/api/v1/auth/login', { email, password });
  await saveSession(res.access_token, 'customer', res.refresh_token);
  const profile = await getMyProfile();
  if (profile.role !== 'customer') {
    // Wrong portal: a farmer account must never enter the customer app.
    await clearSession();
    throw new Error('This account is not a customer account.');
  }
  return profile;
}

/** Current customer profile derived from the stored JWT (never a passed id). */
export async function getMyProfile(): Promise<CustomerProfile> {
  return b2cPost<CustomerProfile>('/api/v1/auth/me', {});
}

/** Send a password-reset email. Always succeeds (no account enumeration). */
export async function forgotPassword(email: string): Promise<void> {
  if (!email.trim()) throw new Error('Enter your email.');
  await b2cPost<{ sent: boolean }>('/api/v1/auth/forgot-password', { email });
}

/** Sign out — clears the stored session. */
export async function logoutCustomer(): Promise<void> {
  try {
    await b2cPost<{ logged_out: boolean }>('/api/v1/auth/logout', {});
  } finally {
    await clearSession();
  }
}

/** True when a customer session token is stored. */
export async function isLoggedIn(): Promise<boolean> {
  const sess = await getSession();
  return !!sess?.token;
}
