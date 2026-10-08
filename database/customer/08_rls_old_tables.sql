-- ============================================================
-- ApnaDairy B2C — 08_rls_old_tables.sql
-- RLS hardening for the OLD (pre-05) customer_* tables on the
-- "ApnaDairy Mobile App" project (bxsvnamareirdgjqngba).
--
-- The 8 new tables from 05_b2c_tables.sql are already locked by
-- 05 (ENABLE + REVOKE + GRANT) and 06 (owner policies) — this file
-- does NOT touch them.
--
-- Tables covered here:
--   customer_orders, customer_addresses, customer_carts,
--   customer_cart_items, customer_deliveries, customer_complaints,
--   customer_notifications
--
-- Principles (defense-in-depth; the FastAPI backend uses service_role
-- and bypasses RLS entirely):
--  * ENABLE ROW LEVEL SECURITY on every table.
--  * REVOKE ALL FROM anon, authenticated (a leaked anon key gets nothing).
--  * GRANT ALL TO service_role (new objects don't inherit it).
--  * Owner-only policies: a customer reaches ONLY rows whose
--    customer_id is their auth uid OR their customer_profiles.id
--    (signup sets profiles.id = auth.users.id, so both match in
--    practice; the dual predicate covers legacy rows either way).
--  * customer_orders: SELECT + INSERT only — order STATUS changes go
--    through the backend staff flow (service_role), never direct.
--  * customer_deliveries: SELECT only — rider/GPS writes go through
--    the backend.
--  * customer_complaints: SELECT + INSERT + UPDATE (no DELETE).
--  * customer_notifications: SELECT + UPDATE (mark-read; no INSERT/DELETE).
--  * audit_logs: intentionally NO customer policies (service_role only).
--
-- Storage buckets (customer-documents, payment-receipts,
-- complaint-attachments) stay service_role-only per 07_b2c_storage.sql —
-- deliberately stricter than per-user folder policies, so unchanged here.
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY;
-- ENABLE RLS / REVOKE / GRANT are all re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Mechanical hardening: ENABLE RLS + REVOKE + GRANT (re-runnable)
-- ------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customer_orders',
        'customer_addresses',
        'customer_carts',
        'customer_cart_items',
        'customer_deliveries',
        'customer_complaints',
        'customer_notifications'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON %I TO service_role', t);
    END LOOP;
END $$;

-- ------------------------------------------------------------
-- 2. customer_orders — SELECT + INSERT, owner only.
--    No UPDATE/DELETE: status transitions are staff-only via backend.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_orders_select ON customer_orders;
CREATE POLICY p_old_orders_select
    ON customer_orders
    FOR SELECT
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_old_orders_insert ON customer_orders;
CREATE POLICY p_old_orders_insert
    ON customer_orders
    FOR INSERT
    TO authenticated
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 3. customer_addresses — full owner access (CRUD own addresses)
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_addresses_owner ON customer_addresses;
CREATE POLICY p_old_addresses_owner
    ON customer_addresses
    FOR ALL
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 4. customer_carts — full owner access
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_carts_owner ON customer_carts;
CREATE POLICY p_old_carts_owner
    ON customer_carts
    FOR ALL
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 5. customer_cart_items — owner access via the parent cart
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_cart_items_owner ON customer_cart_items;
CREATE POLICY p_old_cart_items_owner
    ON customer_cart_items
    FOR ALL
    TO authenticated
    USING (
        cart_id IN (
            SELECT id FROM customer_carts
            WHERE customer_id = auth.uid()
               OR customer_id IN (
                      SELECT id FROM customer_profiles
                      WHERE auth_user_id = auth.uid()
                  )
        )
    )
    WITH CHECK (
        cart_id IN (
            SELECT id FROM customer_carts
            WHERE customer_id = auth.uid()
               OR customer_id IN (
                      SELECT id FROM customer_profiles
                      WHERE auth_user_id = auth.uid()
                  )
        )
    );

-- ------------------------------------------------------------
-- 6. customer_deliveries — SELECT only, owner.
--    Rider assignment / GPS / status writes go through the backend.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_deliveries_select ON customer_deliveries;
CREATE POLICY p_old_deliveries_select
    ON customer_deliveries
    FOR SELECT
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 7. customer_complaints — SELECT + INSERT + UPDATE, owner.
--    No DELETE: complaints are permanent records.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_complaints_select ON customer_complaints;
CREATE POLICY p_old_complaints_select
    ON customer_complaints
    FOR SELECT
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_old_complaints_insert ON customer_complaints;
CREATE POLICY p_old_complaints_insert
    ON customer_complaints
    FOR INSERT
    TO authenticated
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_old_complaints_update ON customer_complaints;
CREATE POLICY p_old_complaints_update
    ON customer_complaints
    FOR UPDATE
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 8. customer_notifications — SELECT + UPDATE (mark read), owner.
--    Notifications are created by the backend (service_role).
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_old_notifications_select ON customer_notifications;
CREATE POLICY p_old_notifications_select
    ON customer_notifications
    FOR SELECT
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS p_old_notifications_update ON customer_notifications;
CREATE POLICY p_old_notifications_update
    ON customer_notifications
    FOR UPDATE
    TO authenticated
    USING (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id = auth.uid()
        OR customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- 9. audit_logs — intentionally NO policies for anon/authenticated.
--    Backend-only (service_role). Unchanged.
-- ------------------------------------------------------------
-- (no statements)
