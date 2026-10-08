// Customer (B2C) auth service — real API calls to the customer backend.
// The customer backend base URL comes from EXPO_PUBLIC_B2C_API_URL.
// Sessions are saved with role='customer' via the shared session store,
// so the rest of the app (401 handling, role gating) works unchanged.
import { saveSession } from '../api/client';

/** Read the customer backend URL from env. Throws a clear error when unset. */
export function getB2CBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_B2C_API_URL;
  if (!url || !url.trim()) {
    throw new Error(
      'Customer service is not configured. Set EXPO_PUBLIC_B2C_API_URL in your .env file.'
    );
  }
  return url.trim().replace(/\/$/, '');
}

async function b2cPost<T>(path: string, body: unknown, token?: string): Promise<T> {
  const res = await fetch(`${getB2CBaseUrl()}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data as { detail?: unknown }).detail;
    throw new Error(
      typeof detail === 'string' ? detail : `Request failed (${res.status}). Please try again.`
    );
  }
  return data as T;
}

export interface CustomerLoginOut {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
}

/**
 * Real customer login via the customer backend.
 * Saves the session with role='customer' and returns.
 */
export async function loginCustomer(email: string, password: string): Promise<void> {
  const out = await b2cPost<CustomerLoginOut>('/api/v1/auth/login', {
    email: email.trim(),
    password,
  });
  if (!out.access_token) {
    throw new Error('Login failed. Please try again.');
  }
  await saveSession(out.access_token, 'customer', out.refresh_token ?? null);
}

export interface CustomerSignupInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
}

/**
 * Real customer signup via the customer backend.
 * The backend sends a 6-digit email OTP; the app must then call
 * verifyCustomerEmail before the account is usable.
 */
export async function signupCustomer(input: CustomerSignupInput): Promise<void> {
  await b2cPost('/api/v1/auth/signup', {
    email: input.email.trim(),
    password: input.password,
    first_name: input.firstName.trim(),
    last_name: input.lastName.trim(),
    phone: input.phone.trim(),
    role: 'customer',
  });
}

export interface CustomerVerifyOut {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  verified: boolean;
  login_required: boolean;
}

/**
 * Verify the 6-digit email OTP from customer signup.
 * When the backend returns session tokens, they are saved with
 * role='customer'. When login_required is true, the user must log in.
 */
export async function verifyCustomerEmail(
  email: string,
  code: string
): Promise<{ loginRequired: boolean }> {
  const out = await b2cPost<CustomerVerifyOut>('/api/v1/auth/verify-email', {
    email: email.trim(),
    token: code.trim(),
  });
  if (out.access_token) {
    await saveSession(out.access_token, 'customer', out.refresh_token ?? null);
  }
  return { loginRequired: out.login_required === true };
}

/** Resend the signup email OTP. */
export async function resendCustomerVerification(email: string): Promise<void> {
  await b2cPost('/api/v1/auth/resend-verification', { email: email.trim() });
}

export interface CustomerLinkOut {
  user_id: string;
  role: string;
  verification_status: string;
  created: boolean;
}

/**
 * Link a Google-OAuth user as a customer (Continue-as flow).
 * Call with the Supabase access token from the Google session; the backend
 * validates the JWT server-side and reads the email from the token.
 */
export async function linkCustomerGoogleProfile(
  firstName: string,
  lastName: string,
  phone: string,
  supabaseAccessToken: string
): Promise<CustomerLinkOut> {
  return b2cPost<CustomerLinkOut>(
    '/api/v1/auth/link-profile',
    {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      phone: phone.trim(),
    },
    supabaseAccessToken
  );
}
