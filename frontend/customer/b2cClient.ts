// ApnaDairy B2C API client — the ONLY place customer screens touch the network.
// Mirrors src/api/client.ts but points at the B2C FastAPI backend and reuses
// the shared session store (the Supabase access token saved by authService).
//
// Wiring: set EXPO_PUBLIC_B2C_API_URL in mobile/.env (see .env.example).
// There is NO fallback: a wrong silent URL is worse than a clear error.
import { getSession, setOnUnauthorized, refreshCustomerSession } from './client';

/** Base URL of the B2C FastAPI backend — env ONLY. */
const ENV_URL = (globalThis as unknown as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env?.EXPO_PUBLIC_B2C_API_URL;

/** Resolve the B2C base URL, or throw a readable wiring error. */
export function getB2CBaseUrl(): string {
  if (ENV_URL) return ENV_URL;
  throw new Error(
    'Backend URL is not configured — set EXPO_PUBLIC_B2C_API_URL in mobile/.env (see .env.example).',
  );
}

/** Abort any request that takes longer than this. */
const TIMEOUT_MS = 20000;

export { setOnUnauthorized };

/** Callback fired on HTTP 401 (token expired/invalid) — app redirects to login. */
type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/** Register the 401 handler (pass null to clear). Shared with client.ts. */
export function setB2COnUnauthorized(cb: UnauthorizedHandler | null): void {
  onUnauthorized = cb;
  setOnUnauthorized(cb);
}

/** Build the Authorization header from the stored Supabase session. */
async function authHeaders(): Promise<Record<string, string>> {
  const sess = await getSession();
  return sess ? { Authorization: `Bearer ${sess.token}` } : {};
}

/** fetch() with an abort timeout. Throws Error('Request timeout') on expiry. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error('Request timeout');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Shape of a FastAPI error body: { "detail": "..." }. */
interface ErrorBody {
  detail?: string | Array<{ msg?: string }>;
}

function detailText(body: ErrorBody): string {
  if (typeof body.detail === 'string') return body.detail;
  if (Array.isArray(body.detail)) {
    const first = body.detail[0];
    if (first && typeof first.msg === 'string') return first.msg;
  }
  return '';
}

/** Endpoints where a 401 is a normal login/signup failure — never a session
 *  invalidation. Firing onUnauthorized here would clear the (nonexistent)
 *  session and bounce the user during the login attempt itself. */
function isAuthEndpoint(path: string): boolean {
  return path === '/api/v1/auth/login' || path === '/api/v1/auth/signup';
}

/** Throw on HTTP error. 204 No Content resolves to null. Fires the 401
 *  handler — except for auth endpoints (see isAuthEndpoint). */
async function handleResponse<T>(res: Response, method: string, path: string): Promise<T> {
  if (res.status === 204) return null as unknown as T;
  if (res.status === 401 && onUnauthorized && !isAuthEndpoint(path)) {
    try {
      onUnauthorized();
    } catch {
      // A failing handler must never break the API call itself.
    }
  }
  if (!res.ok) {
    let detail = '';
    try {
      detail = detailText((await res.json()) as ErrorBody);
    } catch {
      // Non-JSON error body — status code is enough.
    }
    throw new Error(`${method} ${path} failed: ${res.status}${detail ? ' — ' + detail : ''}`);
  }
  return res.json() as Promise<T>;
}

/** Core request: fetch, then on 401 (non-auth endpoints only) attempt ONE
 *  silent token refresh and retry with the fresh token before surfacing
 *  the error. The 401 handler fires only if the retry also fails. */
async function request<T>(method: string, path: string, init: RequestInit): Promise<T> {
  let res = await fetchWithTimeout(getB2CBaseUrl() + path, init);
  if (res.status === 401 && !isAuthEndpoint(path)) {
    const freshToken = await refreshCustomerSession();
    if (freshToken) {
      const headers = { ...(init.headers as Record<string, string> | undefined) };
      headers['Authorization'] = `Bearer ${freshToken}`;
      res = await fetchWithTimeout(getB2CBaseUrl() + path, { ...init, headers });
    }
  }
  return handleResponse<T>(res, method, path);
}

/** Build a query string from defined params. */
export function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const v = params[key];
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

/** Authenticated GET against the B2C backend. */
export async function b2cGet<T>(path: string): Promise<T> {
  return request<T>('GET', path, { headers: await authHeaders() });
}

/** Authenticated POST with JSON body. Extra headers (e.g. Idempotency-Key) supported. */
export async function b2cPost<T>(
  path: string,
  body: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  return request<T>('POST', path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()), ...extraHeaders },
    body: JSON.stringify(body),
  });
}

/** Authenticated PUT with JSON body. */
export async function b2cPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PUT', path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
}

/** Authenticated PATCH with JSON body. */
export async function b2cPatch<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PATCH', path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  });
}

/** Authenticated DELETE. */
export async function b2cDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path, { method: 'DELETE', headers: await authHeaders() });
}

/** A file picked for multipart upload (expo-document-picker / image-picker shape). */
export interface UploadFile {
  uri: string;
  name: string;
  mimeType: string;
}

/** Authenticated POST with multipart/form-data (receipts, complaint photos, documents). */
export async function b2cPostForm<T>(
  path: string,
  fields: Record<string, string | undefined>,
  files: Record<string, UploadFile | undefined> = {},
): Promise<T> {
  const form = new FormData();
  for (const key of Object.keys(fields)) {
    const v = fields[key];
    if (v !== undefined) form.append(key, v);
  }
  for (const key of Object.keys(files)) {
    const f = files[key];
    if (f) {
      form.append(key, {
        uri: f.uri,
        name: f.name,
        type: f.mimeType,
      } as unknown as Blob);
    }
  }
  return request<T>('POST', path, {
    method: 'POST',
    headers: await authHeaders(),
    body: form,
  });
}
