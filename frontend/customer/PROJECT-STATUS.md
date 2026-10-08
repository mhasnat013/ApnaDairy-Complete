# ApnaDairy — Project Status (in depth)

Date: 2026-10-07. This file is the honest record: what is **done and verified**
vs what is **remaining / unverified**. Nothing marked complete unless it was
tested against the real backends and the real Supabase projects.

## 1. What this project is

A single Expo (React Native + TypeScript) app, role-based at login/signup:

- **Farmer portal** — dashboard, Add New Milk, manager offers, payments,
  documents/verification, profile. Low-literacy-friendly, simple cards.
- **Customer B2C app** — 6-tab app (Home, Bazaar, Cart, Orders, Rider, Profile),
  marketplace of manager milk batches with AI freshness score + Category A/B/C,
  per-manager separate orders, COD / bank-transfer-with-screenshot / demo card
  (no Easypaisa), scheduled delivery, rider map + chat, SuperAdmin verification
  before buying, permanent-customer 15/30-day cycles, complaints, AI chatbot.

Architecture: **App → FastAPI → Supabase**. Two FastAPI backends
(`farmer-dashboard/backend` :8000, `apnadairy-b2c/backend` :8001), two Supabase
projects: **"ApnaDairy Mobile App"** (`bxsvnamareirdgjqngba`, read/write) and
**"apnadairy-web"** (`aquatwwnpvnmirkqnhlp`, **read-only** for the app).

## 2. DONE — mobile app (`farmer-dashboard/mobile`)

- Unified role-based auth: login/signup with Farmer/Customer selector, role
  immutable after selection (`app/(auth)/continue-as.tsx`).
- Real Supabase email+password auth (no demo fallback): signup creates an
  **unconfirmed** user, Supabase sends a real 6-digit OTP email;
  `verify-email.tsx` (6-box OTP, 60s resend cooldown); unverified login → 403 →
  routed to verification. Legacy pre-confirm path exists behind
  `EMAIL_VERIFICATION_REQUIRED=false` (backend).
- Real forgot/reset password (Supabase reset email + recovery deep-link handler
  in `_layout.tsx`); real change-password (`POST /api/v1/auth/change-password`,
  re-authenticates current password).
- Real Google OAuth (PKCE, `expo-web-browser` + `expo-auth-session`,
  `src/api/googleAuth.ts`); backends link the Google user to a profile via
  `POST /api/v1/auth/google-link` (farmer) and `POST /api/v1/auth/link-profile`
  (B2C), idempotent. OAuth client verified live: redirect URI
  `https://bxsvnamareirdgjqngba.supabase.co/auth/v1/callback`, provider enabled
  in the mobile Supabase project.
- 25 customer screens + 6-tab layout; 16 typed API services; farmer portal
  screens (dashboard, milk requests, offers, managers, payments, documents,
  verification, profile + edit-personal/edit-farm/change-password).
- Session in SecureStore (localStorage fallback on web); silent token refresh;
  global 401 handler → logout → login. No token → 401, no silent demo.
- Theme locked and applied: milk-cream/ivory/forest/amber, Bricolage Grotesque loaded
  via `expo-font` + `@expo-google-fonts`, pill buttons everywhere.
- Verified: `tsc` 0 errors, `expo-doctor` 21/21, renders live with zero errors
  (login + signup screens screenshotted running against the real backends).

## 3. DONE — backends

**B2C backend** (`apnadairy-b2c/backend`, :8001) — 62 routes, **213/213 pytest**.
Signup → verify-email → address → cart → checkout (COD) → idempotency (same key
= same order) → staff status walk (pending→accepted→preparing→dispatched→
delivered) all passed live end-to-end twice, plus a final **52/52** proof run.
Real bugs found and fixed live: JWT-first auth (demo fallback removed), cart-id
resolution, `customer_profiles.id = auth.users.id`, order-status vocabulary
aligned to the DB CHECK, ES256 JWT support, 30s clock-skew leeway, complaint
category enum aligned to DB (`quality | rider | order | payment`), anon-client
login (fixed a worker-bricking 500).

**Farmer backend** (`farmer-dashboard/backend`, :8000) — **55/55 pytest**,
26 routes 200 on real data. Two Supabase clients: web project **read-only**
(farmers, milk_collections, farmer_payouts, area_managers) + mobile project
(portal tables). Real bugs fixed live: schema remap to real web columns
(`full_name`, `quantity_l`, `temperature_c`, `ph`, `ec_ms`, `receipt_no`),
document upload wired to real multipart endpoint, change-password /
forgot-password / google-link endpoints added.

## 4. DONE — database (mobile project `bxsvnamareirdgjqngba`)

- Migrations `05_b2c_tables.sql` → `06_b2c_rls.sql` → `07_b2c_storage.sql`
  applied live: 8 B2C tables + 7 portal tables, RLS enabled, anon/authenticated
  revoked, owner-only policies, explicit `GRANT ALL TO service_role` (new tables
  don't inherit it), 3 storage buckets.
- `08_rls_old_tables.sql` written (262 lines, rerun-safe, 12 owner-only policies
  for the 7 legacy tables) — **NOT applied yet** (needs the project owner in the
  SQL editor; steps documented in `audit/rls-report.md`).

## 5. Profiles — read/write matrix (verified in code)

| Profile | Store | Read | Write | Notes |
|---|---|---|---|---|
| Customer | `customer_profiles` (mobile project) | `GET /api/v1/profile`, `POST /api/v1/auth/me` | `PATCH /api/v1/profile` (self); created idempotently by `POST /auth/verify-email` (OTP) and `POST /auth/link-profile` (Google); `verification_status` set by staff via staff endpoints | `id` = `auth.users.id`. Mobile: `profileService.ts`, `accountService.ts`, `customer/profile/*` screens |
| Farmer | `farmer_profiles` (mobile project) | `GET /api/v1/farmer/profile/` | `PUT /api/v1/farmer/profile/personal`, `PUT /api/v1/farmer/profile/farm` (override upsert — web row never touched) | Mobile: `farmer/profile/*` (edit-personal, edit-farm, my-documents, change-password) |
| Web `farmers` | web project | read via farmer backend (dashboard, managers) | **NEVER written by the app** — read-only by design | Real columns: `full_name`, `village`, `cattle_count` etc. |
| Web `milk_collections` / `farmer_payouts` / `area_managers` | web project | read via farmer backend | **never written by the app** | 647 collections / 61 payouts / 9 managers live |

## 6. REMAINING — must be done by the app owner

1. **Phone testing (Expo Go)** — the app has only been run in a browser so far;
   test on a real phone: login, signup+OTP email, Google OAuth, camera/document
   upload, maps.
2. **`SUPABASE_MOBILE_ANON_KEY`** — set in `apnadairy-b2c/backend/.env` in
   production. Without it login/signup/OTP endpoints fail (currently missing in
   this environment — login returns "Invalid email or password" which masks the
   missing key; see §8).
3. **RLS migration `08_rls_old_tables.sql`** — apply in the Supabase SQL editor
   as project owner, then run the anon-key RLS probe curls
   (in `audit/rls-report.md` §3).
4. **`mobile/.env`** — set the laptop LAN IP (`EXPO_PUBLIC_API_URL`,
   `EXPO_PUBLIC_B2C_API_URL`), Supabase URL + anon key. `.env.example` documents
   all of it.
5. **`assets/`** — app icon + splash (required before any store/EAS build);
   `app.json` name is "ApnaDairy Farmer" → rename to "ApnaDairy" if wanted;
   add `eas.json` for builds.
6. **Web↔B2C integration** — the web-app lane's part (see `TEAM-TASKS.md`).
7. **Google OAuth on device** — dashboard config verified; physical-device
   Google sign-in still to be tested.

## 7. Known gaps (honest, not hidden)

- `customer_ledger` has a read API but **no runtime write path** yet.
- OTP email path not tested live end-to-end (Supabase rate-limited the sandbox).
- Farmer 5-tab bottom nav incomplete (Stack navigation only; tab roots exist).
- Web-admin ↔ B2C operational integration is the web lane's work (guide delivered).
- Old scaffold `apnadairy-b2c/app/` is dead code — safe to archive (zero imports).

## 8. Bug found during the live demo (2026-10-07, open)

`POST /api/v1/auth/login` returns 401 "Invalid email or password" even with
correct credentials when `SUPABASE_MOBILE_ANON_KEY` is missing from the backend
environment — the 503 misconfiguration is swallowed and re-reported as a
credential error. Fix options: (a) set the key (proper fix, required for prod
anyway); (b) optionally make the backend distinguish 503-misconfigured from
401-bad-credentials in `auth_service.login`. The demo login was blocked by this;
the app itself behaved correctly (fired one request, showed the error honestly —
the extra "200" in the trace was the CORS preflight).

## 9. Deliverables on disk

- `your_files/apnadairy-unified-app.zip` (273K) — this mobile app, no `.env`.
- `your_files/apnadairy-b2c-backend.zip` (125K) — B2C backend, no `.env`.
- `audit/final-proof-report.md` — per-feature proof table (52/52 live checks).
- `audit/rls-report.md` — RLS posture + `08` migration apply steps.
- `apnadairy-web/` (repo root) — web-side integration contract.

## 10. Language and theme-token standard (2026-10-07)

As of 2026-10-07 the entire mobile app is **English-only** per the owner's
formal-market rule: all UI strings, error messages and developer comments are
in professional English; no Roman Urdu or Urdu-script text remains in the app.

Theme token rename applied the same day: `malai` → `ivory`, `haldi` → `amber`
(`haldiTint` → `amberTint`, `haldiDark` → `amberDark`), and the comment
"doodh-cream" → "milk-cream".
