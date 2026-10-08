# 03 — Remaining Work: What Is Missing

Honest, complete list of what is **done** vs what **remains**. Lanes are used
instead of names. The team picks items up from their side; nothing here blocks
running the app today.

---

## 1. Done (verified)

- Unified role-based app: Farmer portal + Customer B2C app, role chosen at
  login/signup, immutable afterwards.
- 25 customer screens + full farmer portal; 6-tab customer nav; desi-dairy theme
  locked; **entire app in formal English** (UI, backend messages, comments).
- Real auth: email+OTP, Google OAuth (verified live), forgot/change/reset
  password, JWT validation on every request.
- Live E2E proof on the real Supabase project: signup → checkout → delivered,
  52/52 checks passed; 213/213 B2C + 55/55 farmer pytest; `tsc` 0 errors.
- B2C database migration applied live (8 tables, RLS, 3 storage buckets).
- Login production bug fixed (anon-client isolation) and verified live.

## 2. Remaining — mobile-app lane

| # | Item | Detail |
|---|---|---|
| 1 | `customer_ledger` has no runtime write path | Read API exists; nothing writes ledger entries when payments/dues change. Needs a write path in the B2C backend before permanent-customer billing is real. |
| 2 | OTP email untested live | Supabase rate-limited the sandbox; the flow is implemented but a live OTP round-trip on a real device is still unverified. |
| 3 | Farmer 5-tab navigation incomplete | Tabs 2–4 of the farmer portal are a proposed structure, not final. Confirm the tab list before the viva. |
| 4 | App icon + splash assets | `assets/` needs the final icon and splash image; `app.json` still says "ApnaDairy Farmer" — rename to "ApnaDairy" before the store build. |
| 5 | `eas.json` for builds | Needed for `eas build` (APK/AAB). Not created yet. |
| 6 | Physical-device testing | Everything was verified on Expo web + backend tests. A real phone run (Expo Go) over LAN is still the team's step. |

## 3. Remaining — backend lane

| # | Item | Detail |
|---|---|---|
| 1 | Apply `08_rls_old_tables.sql` | RLS policies for the old tables (orders, addresses, complaints, notifications, deliveries, cart_items). **Must be applied by the project owner in the Supabase SQL editor** (credentials in `docs/04-credentials.md`). |
| 2 | Anon-key RLS probes | After (1), probe the old tables with the anon key to confirm RLS denies correctly. |
| 3 | Production `.env` | Set `SUPABASE_MOBILE_ANON_KEY`, `AUTH_DEMO_ENABLED=false`, `PAYMENTS_TEST_MODE=false` on the production host. |
| 4 | Bank-transfer screenshot review queue | Upload works; the staff approve/reject flow for payment screenshots is still manual. |

## 4. Remaining — web-app lane (integration)

| # | Item | Detail |
|---|---|---|
| 1 | Web ↔ B2C marketplace linking | The contract is defined (`apnadairy-web/CONTRACT.md`): the app reads `area_managers` / `milk_collections` / AI scores via `web_manager_id` / `web_batch_id`. The web lane owns exposing these consistently and documenting any new queues. |
| 2 | Open decisions | Listed in `apnadairy-web/CONTRACT.md` (rider assignment, new web-side queues). The web lane decides; the mobile side adapts. |
| 3 | Category value renames (if any) | If the web lane ever renames category values (`Doodh`, `Dahi`, …), it must migrate data or notify — the app exact-matches these values for filtering. |

## 5. Remaining — account/security hygiene (owner)

| # | Item | Detail |
|---|---|---|
| 1 | Rotate pasted secrets | The Gmail password for `apnadairyservices@gmail.com` was pasted in chat — change it. The Supabase dashboard password and service-role keys were shared in handoff docs — the owner rotates them when ready (his standing decision). See `docs/04-credentials.md`. |
| 2 | Google consent screen | Still in Testing mode with allow-listed test users. For public release, complete Google verification and publish the consent screen. |

## 6. What is NOT missing (do not rebuild)

- Do not change the existing database schema or the web app — both are locked.
- Do not change existing business logic (checkout idempotency, role immutability,
  web read-only rule, per-manager separate orders).
- Do not reintroduce Roman Urdu — the English-only standard is locked.
