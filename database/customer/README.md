# DB schema — run in Supabase SQL Editor, IN ORDER
1. 01_tables.sql — 14 B2C tables (design doc; tables actually created in dashboard)
2. 02_rls.sql — row-level security principles (skeleton; real policies in 06/08)
3. 03_storage.sql — buckets + policies (design doc)
4. 04_triggers.sql — auto-profile on signup, updated_at (design doc)
5. 05_b2c_tables.sql — 8 new tables + ENABLE RLS + REVOKE + GRANT service_role ✅ applied
6. 06_b2c_rls.sql — owner policies for the 8 new tables ✅ applied
7. 07_b2c_storage.sql — 3 private buckets, service_role-only ✅ applied
8. 08_rls_old_tables.sql — RLS hardening for the 7 OLD tables
   (customer_orders, customer_addresses, customer_carts, customer_cart_items,
   customer_deliveries, customer_complaints, customer_notifications).
   ⏳ PENDING — Hasnat: paste into SQL Editor on the MOBILE project and Run.
   Rerun-safe. Verify with the check queries in ~/workspace/audit/rls-report.md §3.

Dashboard (MOBILE project): https://supabase.com/dashboard/project/bxsvnamareirdgjqngba → SQL Editor.
