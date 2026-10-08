# 02 — Integration Guide: How Everything Connects

Formal, step-by-step reference for wiring the app, the two backends, Supabase,
and Google OAuth together — and for how the web-app lane integrates with the
mobile side. Follow it top to bottom on a fresh machine.

---

## 1. Architecture recap

```
┌──────────────┐      ┌──────────────────┐      ┌──────────────────────────┐
│  Phone        │      │  FastAPI          │      │  Supabase                │
│  (Expo app)   │─────▶│  backends         │─────▶│  (Postgres + Auth +       │
│               │ HTTP │  :8000 farmer     │      │   Storage)               │
│               │ JSON │  :8001 B2C        │      │                          │
└──────────────┘      └──────────────────┘      └──────────────────────────┘
        │                       │                           │
        │  Supabase Auth        │  service-role keys         │  RLS: backends
        │  (Google OAuth PKCE)  │  (server side ONLY)        │  only; app uses
        └───────────────────────┘                           │  anon key for Auth
```

**Three golden rules:**

1. The app **never** holds a service-role key. It uses the **anon key** only for
   Supabase Auth (Google OAuth). All data goes through the FastAPI backends.
2. Every backend request carries the user's **JWT** (`Authorization: Bearer …`).
   The backend validates it server-side on every request (PyJWT, accepts the
   ES256 algorithm this project uses, 30-second clock-skew leeway).
3. The **web project is read-only**. The mobile app writes only to the mobile
   project.

---

## 2. Environment setup (per part)

### 2.1 Mobile app — `farmer-dashboard/mobile/.env`

Copy `.env.example` → `.env`:

| Variable | Value | Notes |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `http://<laptop-LAN-IP>:8000` | Farmer backend. Find the IP with `ipconfig` (Windows) → IPv4 Address. Never `localhost` — the phone cannot reach it. |
| `EXPO_PUBLIC_B2C_API_URL` | `http://<laptop-LAN-IP>:8001` | B2C backend. Same IP, port 8001. |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://bxsvnamareirdgjqngba.supabase.co` | Mobile project. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | anon key | Dashboard → Project Settings → API. Anon key only. |

### 2.2 Farmer backend — `farmer-dashboard/backend/.env`

| Variable | Value |
|---|---|
| `SUPABASE_MOBILE_URL` | `https://bxsvnamareirdgjqngba.supabase.co` |
| `SUPABASE_MOBILE_SERVICE_KEY` | service-role key (mobile project) |
| `SUPABASE_WEB_URL` | `https://aquatwwnpvnmirkqnhlp.supabase.co` |
| `SUPABASE_WEB_SERVICE_KEY` | service-role key (web project, read-only use) |
| `DEMO_FARMER_ID` | `08634626-86bd-41b2-a9ca-839b24e497ae` (dev/demo only) |
| `AUTH_DEMO_ENABLED` | `false` in production |

### 2.3 B2C backend — `apnadairy-b2c/backend/.env`

| Variable | Value |
|---|---|
| `SUPABASE_MOBILE_URL` | `https://bxsvnamareirdgjqngba.supabase.co` |
| `SUPABASE_MOBILE_ANON_KEY` | anon key (mobile project) — **required**: login/OTP use a fresh throwaway anon client per call |
| `SUPABASE_MOBILE_SERVICE_KEY` | service-role key (mobile project) |
| `SUPABASE_WEB_URL` / `SUPABASE_WEB_SERVICE_KEY` | web project (operational reads: managers, batches) |
| `AUTH_DEMO_ENABLED` | `false` in production |
| `STAFF_API_KEY` | staff endpoints key |
| `PAYMENTS_TEST_MODE` | `true` for demo card payments |

All secret values are listed in `docs/04-credentials.md` (with a rotation warning).
`.env` files are git-ignored and are **not** inside the shipped zip.

### 2.4 Install & run (3 terminals)

```bat
:: one-time
cd farmer-dashboard\backend && pip install -r requirements.txt
cd ..\..\apnadairy-b2c\backend && pip install -r requirements.txt
cd ..\..\farmer-dashboard\mobile && npm install

:: Terminal 1 — farmer backend
cd farmer-dashboard\backend
uvicorn app.main:app --host 0.0.0.0 --port 8000

:: Terminal 2 — B2C backend
cd apnadairy-b2c\backend
uvicorn app.main:app --host 0.0.0.0 --port 8001

:: Terminal 3 — app
cd farmer-dashboard\mobile
npx expo start
```

Or double-click `mobile/start-dev.bat`. Scan the QR with Expo Go
(phone + laptop on the same Wi-Fi), or press `w` for browser preview.

---

## 3. Authentication flow (both roles)

1. **Email signup** → backend creates the Supabase Auth user → sends a 6-digit
   OTP to the email → user enters the code → account created **UNVERIFIED**.
2. **Email login** → `POST /api/v1/auth/login` with a **fresh anon client**
   (never the shared service client — a fixed production bug) → returns a JWT.
3. **Google** → app runs the PKCE OAuth flow (`src/api/googleAuth.ts`) against
   the mobile Supabase project → `continue-as.tsx` asks **Farmer or Customer**
   (immutable) → backend `link-profile` creates the matching profile row.
4. Every later request sends `Authorization: Bearer <JWT>`; the backend
   validates it and resolves the user id. `401` in the app → back to login.

Google Cloud console setup (one-time, already done): OAuth client
"ApnaDairy B2C Customer Google Login", redirect URI
`https://bxsvnamareirdgjqngba.supabase.co/auth/v1/callback`, provider enabled in
the Supabase dashboard. Test users are allow-listed while the consent screen is
in Testing mode.

---

## 4. Web ↔ mobile integration (for the web-app lane)

The web app owns the **operational** records; the mobile app consumes them
read-only and links by external ID. This is the contract:

| Web table (read-only) | Mobile use | Link field |
|---|---|---|
| `area_managers` | Marketplace lists each manager's batches; farmer "supplying manager" card | `web_manager_id` |
| `milk_collections` (+ test results, AI freshness score, Category A/B/C) | Marketplace batch cards, freshness ring, category badge | `web_batch_id` |
| `farmer_payouts` | Farmer payments tab (receipt_no, amounts) | farmer id |
| `farmers` | Farmer identity display | farmer id |

**Rules:**

- The mobile backends **read** these tables through the web service-role client.
  They **never write** to the web project. Profile edits go to `farmer_profiles`
  (mobile project).
- Marketplace **category values** (`Doodh`, `Dahi`, …) are exact-match filter
  strings against the web DB column — the app shows English labels
  (Milk, Yogurt, …) but sends the original values. Do not rename the values
  without migrating the web data.
- New web-side queues the mobile app will consume later: the web lane documents
  them in `apnadairy-web/CONTRACT.md` (open decisions section).
- Full table/column reference: `apnadairy-web/TABLES.md` (live-audit verified).

---

## 5. Database migrations

Migrations are plain SQL in each backend's `db_schema/`, applied in the
Supabase **SQL editor** (dashboard login in `docs/04-credentials.md`), in order:

- Farmer backend: `01_auth_link.sql` … (portal tables; mobile project only)
- B2C backend: `05_b2c_tables.sql` → `06_b2c_rls.sql` → `07_b2c_storage.sql`
  (already applied live), `08_rls_old_tables.sql` (**not applied** — needs the
  project owner; see `docs/03-remaining-work.md`)

Security order for any new table: `REVOKE ALL` from anon/authenticated first,
then `ENABLE ROW LEVEL SECURITY` + policies, then minimal grants. Never "fix" a
permission error by granting to anon/authenticated.

---

## 6. Verifying the integration

```bash
# backends healthy?
curl http://localhost:8000/health        # 200
curl http://localhost:8001/health        # 200

# login returns a real JWT?
curl -X POST http://localhost:8001/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<user>","password":"<pw>","role":"customer"}'

# suites green?
cd apnadairy-b2c/backend && env -u no_proxy -u NO_PROXY python -m pytest   # 213
cd farmer-dashboard/backend && env -u no_proxy -u NO_PROXY python -m pytest # 55
cd farmer-dashboard/mobile && npx tsc --noEmit                              # 0 errors
```

End-to-end proof (signup → OTP → address → cart → checkout → order → delivered)
was run live against the real project and passed 52/52 checks; the report is in
the repo's audit notes.
