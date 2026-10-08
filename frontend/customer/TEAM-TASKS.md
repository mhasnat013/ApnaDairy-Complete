# Team Tasks — other lanes (no names)

What the rest of the team must do so this mobile app works end-to-end.
Written by lane, not by person. The mobile app + both FastAPI backends are the
app owner's lane and are done (see `PROJECT-STATUS.md`).

## Lane 1 — Web app / dashboards (React)

Owns the `web/` folder and the **"apnadairy-web"** Supabase project. The mobile
app treats that project as **read-only** and never writes to it.

1. **Keep the read contract stable.** The farmer backend reads these tables and
   columns (see `../apnadairy-web/TABLES.md`). If a column is renamed, tell the
   app owner — the backend remap is manual.
2. **SuperAdmin verification queues.** Both roles depend on SuperAdmin approvals
   in the web dashboard:
   - customer verification submissions (`verification_docs` + `customer_profiles.verification_status`)
   - farmer verification submissions (`farmer_verifications`, `farmer_documents`)
   - permanent-customer 15/30-day cycle approvals
   Without these queues working, new users can explore but cannot buy/farm.
3. **Manager ↔ B2C operational link.** The B2C marketplace lists area-manager
   milk batches (`area_managers`, `milk_batches`, IoT test results, AI freshness
   scores/categories). The web side owns producing these records; the B2C
   backend reads them via external IDs (`web_manager_id`, `web_batch_id`).
   Full field contract: `your_files/apnadairy-b2c-web-integration-guide.md`.
4. **Rider profiles (Daraz-style).** Riders are created/held by the manager in
   the web app; the B2C Rider tab (details, chat, live location) reads them.
   Assignment rule (SuperAdmin vs manager assigns) is still an open decision —
   confirm it.
5. **Do not write to the mobile project's tables** (`customer_*`,
   `farmer_*`, portal tables). Those belong to the FastAPI backends.

## Lane 2 — Integration support

Currently no open mobile-app tasks in this lane (moved out of mobile development
2026-10-02). If picked up again: help with on-device testing (Expo Go),
 English copy review on the customer screens, and the viva demo script.

## Shared rules (all lanes)

- The **web database is read-only** for the mobile app. New tables for the app
  go in the **"ApnaDairy Mobile App"** project, via the app owner's migrations.
- Service-role keys live **only** in FastAPI backend environments — never in
  the mobile app, never in the web frontend.
- Payments stay **COD / bank-transfer-with-screenshot / demo card**. No
  Easypaisa. No B2B bidding in the app.
- Theme is locked (see `mobile/README.md`). Don't restyle shared components.
