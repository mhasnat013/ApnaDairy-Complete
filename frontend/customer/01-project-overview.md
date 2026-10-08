# 01 — Project Overview: File & Folder Structure

**ApnaDairy — Unified Mobile App** (Final Year Project, Air University Islamabad)

This document describes every folder and file group in the project: what it is,
what it does, and how the pieces connect. Read this first if you are new to the codebase.

---

## 1. The big picture

```
ApnaDairy/
├── farmer-dashboard/
│   ├── mobile/        ← THIS APP (Expo / React Native) — the deliverable
│   └── backend/       ← Farmer portal API (FastAPI, port 8000)
├── apnadairy-b2c/
│   └── backend/       ← Customer B2C API (FastAPI, port 8001)
└── apnadairy-web/     ← Web-side integration contract (documentation only)
```

**Architecture (one line):** the phone app talks to two FastAPI backends; the
backends talk to Supabase. The app never touches the database directly
(except Supabase Auth for Google OAuth).

```
Phone (Expo app)
 ├── EXPO_PUBLIC_API_URL      → Farmer backend  :8000 ─┐
 ├── EXPO_PUBLIC_B2C_API_URL  → B2C backend     :8001 ─┤→ Supabase
 └── Supabase anon key        → Auth (Google OAuth) ───┘   projects:
                                                          • "ApnaDairy Mobile App"
                                                            (bxsvnamareirdgjqngba)
                                                            — read + write
                                                          • "apnadairy-web"
                                                            (aquatwwnpvnmirkqnhlp)
                                                            — READ ONLY
```

---

## 2. `farmer-dashboard/mobile/` — the app

The unified role-based app. One codebase, two experiences selected at login/signup:

- **Farmer** → farmer portal (dashboard, milk requests, managers, payments, documents, profile)
- **Customer** → B2C app (home, marketplace, cart, orders, rider, profile)

Stack: Expo SDK 57 · TypeScript · Expo Router (file-based routing) · NativeWind v4
(Tailwind for React Native).

### 2.1 `app/` — screens (file = route)

Expo Router turns every file under `app/` into a screen. One screen per file,
grouped in feature folders (industrial structure — never merge screens).

| Folder | Contents | Purpose |
|---|---|---|
| `app/(auth)/` | `login.tsx`, `signup.tsx`, `verify-email.tsx`, `verify-otp.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `continue-as.tsx` | Authentication. `continue-as.tsx` is the **role selection** screen shown after Google sign-in ("Continue as Farmer / Customer"). Role is immutable after choice. |
| `app/farmer/` | `index.tsx` (dashboard), `milk/` (new-request, request-detail, offers, offer-detail), `managers.tsx`, `payments/` (list + payment-detail), `documents.tsx`, `verification-status.tsx`, `detail-entry/` (personal, farm), `complaints/` (list, new, detail), `notifications.tsx`, `profile/` (index, edit-personal, edit-farm, my-documents, change-password, language) | The **farmer portal**. Simple cards, no graphs (low-literacy users). Dashboard shows total milk, revenue, profit, sales, supplying manager. |
| `app/customer/` | `home/index.tsx`, `marketplace/` (list + `[id]` detail), `cart/index.tsx`, `checkout/` (index + success), `orders/` (list, track, `[id]/` detail + chat), `rider/index.tsx`, `search.tsx`, `verification/index.tsx`, `permanent/index.tsx`, `chat/index.tsx`, `profile/` (index, addresses, payments, complaints + `[id]`, notifications, verification) | The **customer B2C app**. 6-tab bottom navigation: Home, Marketplace, Cart, Orders, Rider, Profile. Marketplace lists area-manager milk batches with AI freshness score + Category A/B/C. Checkout supports COD, bank transfer with screenshot proof, and demo card (no Easypaisa). |
| `app/_layout.tsx` | Root layout | Loads fonts (Bricolage Grotesque), restores the session on launch, redirects to login on 401. |
| `app/index.tsx` | Entry | Decides where to send the user (login vs role home) based on stored session + role. |

### 2.2 `src/` — logic (no screens here)

| Folder | Contents | Purpose |
|---|---|---|
| `src/api/` | `client.ts` (farmer backend HTTP client), `b2cClient.ts` (B2C backend HTTP client), `googleAuth.ts` (shared Google OAuth PKCE flow) | All network access goes through these three modules. They attach the JWT, handle 401 → logout, and surface backend error messages. |
| `src/services/farmer/` | `authService.ts`, `dashboardService.ts`, `milkService.ts`, `engagementService.ts`, … | One module per farmer feature. Translates UI actions into API calls; owns validation messages. |
| `src/services/customer/` | `authService.ts`, `checkoutService.ts`, `complaintService.ts`, `cartService.ts`, `addressService.ts`, … | One module per customer feature. Same pattern as farmer services. |
| `src/components/common/` | `AppButton.tsx`, `TextInput.tsx`, `Card.tsx`, `SearchBar.tsx`, … | Shared UI primitives. Pill buttons (`borderRadius: 999`), 44px inputs, 20px panels — the design system. |
| `src/components/customer/`, `src/components/farmer/`, `src/components/home/` | `WishlistHeart.tsx`, `CategoryChips.tsx`, `ManagerCard.tsx`, … | Feature-specific components. `CategoryChips` maps API category values to English display labels. |
| `src/theme/` | `colors.ts`, `fonts.ts` | **The single source of truth for the theme.** Never hardcode hex in screens. Palette: milk-cream `#f7f1e3` (pages), ivory `#fffcf4` (surfaces), forest `#1f4d36` (brand), amber `#e2a93b` (accent), ink `#1e2b22` (text), sage `#5c6b5e` (secondary text). |
| `src/data/` | `farmerMockData.ts` | Local fallback data (clearly marked). Production paths use live API data. |
| `src/web-shims.ts` | Web compatibility | LocalStorage fallback + flags so the same code runs in Expo web preview. |

### 2.3 Root files

| File | Purpose |
|---|---|
| `package.json` | Dependencies and scripts (`npx expo start`, `npx tsc --noEmit`). |
| `app.json` | Expo config (app name, icons, splash — icon/splash assets still to be added, see `docs/03-remaining-work.md`). |
| `tailwind.config.js` | NativeWind theme tokens (mirrors `src/theme/colors.ts`). |
| `.env` / `.env.example` | `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_B2C_API_URL`, Supabase anon key. **Anon key only — never a service-role key.** |
| `start-dev.bat` | Double-click: opens 3 terminals (farmer backend :8000, B2C backend :8001, Expo). Edit the `SET` lines if folders live elsewhere. |
| `docs/` | This documentation set. |

---

## 3. `farmer-dashboard/backend/` — Farmer portal API (port 8000)

FastAPI (Python). Serves the farmer portal.

```
backend/
  app/
    main.py               App entry: mounts routers, CORS, exception handlers
    core/                 config.py (env), security.py (JWT validation)
    db/                   supabase_client.py — TWO clients:
                            • mobile project client (read + write: portal tables)
                            • web project client (READ ONLY: farmers,
                              milk_collections, farmer_payouts, area_managers)
    api/v1/               Routers: auth, farmer/profile, farmer/milk,
                            farmer/offers, farmer/documents, farmer/payments,
                            farmer/complaints, farmer/notifications, iot/live
    services/farmer/      Business logic per feature (milk_service,
                            offer_service, …)
    schemas/              Pydantic request/response models
    models/               DB row shapes
  db_schema/              SQL migrations (mobile project ONLY — see §5)
  tests/                  55 pytest tests — all passing
  requirements.txt        Python dependencies
  .env                    Service-role keys (git-ignored, never shipped in the app)
```

**Key rule:** the web project (`apnadairy-web`) is **read-only**. The backend
reads `farmers`, `milk_collections`, `farmer_payouts`, `area_managers` from it;
profile **edits** go to `farmer_profiles` in the **mobile** project. The web
`farmers` table is never written by this backend (verified: zero write queries).

---

## 4. `apnadairy-b2c/backend/` — Customer B2C API (port 8001)

FastAPI (Python). Serves the customer app: auth, catalog, cart, checkout,
orders, deliveries, payments, complaints, rider chat, permanent-customer cycles.

```
backend/
  app/
    main.py               App entry (62 routes)
    core/                 config, security (JWT with 30s clock-skew leeway)
    db/                   supabase_client.py — mobile project client +
                            get_mobile_anon_client() (fresh throwaway client
                            for login/OTP so user JWTs never pollute the
                            service client — this was a real production bug,
                            now fixed)
    api/v1/               14 feature routers: auth, verification, home,
                            marketplace, cart, checkout, orders, rider,
                            profile, permanent, payments, complaints,
                            chatbot, notifications
    services/             Business logic per feature (auth_service,
                            order_service, checkout idempotency, …)
    schemas/              Pydantic models
  db_schema/              05_b2c_tables.sql, 06_b2c_rls.sql, 07_b2c_storage.sql
                            (applied live), 08_rls_old_tables.sql (NOT applied —
                            needs the project owner, see
                            docs/03-remaining-work.md)
  tests/                  213 pytest tests — all passing
```

**Idempotent checkout:** the same `idempotency_key` returns the same order —
double-taps never create double orders.

---

## 5. Database layout (Supabase)

Two projects. This is the single most important thing to understand.

| Project | Ref | Role |
|---|---|---|
| **ApnaDairy Mobile App** | `bxsvnamareirdgjqngba` | The app's database. **Read + write.** Holds portal tables (`milk_requests`, `offers`, `farmer_documents`, `notifications`, `complaints`, `farmer_verifications`, `farmer_profiles`) and B2C tables (8 tables: profiles, addresses, orders, payments, deliveries, cart, ledger, etc. + 3 storage buckets). RLS enabled; anon/authenticated revoked; service-role only via backends. |
| **apnadairy-web** | `aquatwwnpvnmirkqnhlp` | The web dashboard's database. **READ-ONLY for the app.** 57 tables/views incl. `farmers`, `milk_collections`, `farmer_payouts`, `area_managers`. The mobile app links to web rows via external IDs (`web_manager_id`, `web_batch_id`). |

Migrations live in each backend's `db_schema/` and are applied in the Supabase
SQL editor (dashboard login in `docs/04-credentials.md`).

---

## 6. `apnadairy-web/` — web-side contract (documentation)

Not code — a read-only integration contract describing what the web app owns and
what this mobile app is allowed to read from it: `README.md`, `TABLES.md`
(exact tables/columns, live-audit verified), `CONTRACT.md` (rules: read-only,
external-ID linking, the web lane's queues and open decisions).

---

## 7. Language standard

The entire app — every user-visible string, every backend message, every
developer comment — is **formal English**. No Roman Urdu, no Urdu script
anywhere. This is a standing rule for all future work.
