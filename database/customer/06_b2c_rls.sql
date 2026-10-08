-- ============================================================
-- ApnaDairy B2C — 06_b2c_rls.sql
-- RLS policies for the 05_b2c_tables.sql tables (defense-in-depth).
--
-- The FastAPI backend connects with the service_role key, which bypasses
-- RLS entirely. These policies exist so that if RLS is ever relied on
-- (e.g. a future direct Supabase client), access stays locked to the
-- owning customer. audit_logs has NO authenticated policies by design.
--
-- Idempotent: DROP POLICY IF EXISTS before each CREATE POLICY, so the
-- file can be re-run safely.
-- ============================================================

-- ------------------------------------------------------------
-- customer_profiles: a customer can only read/write their own row
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_profiles_self ON customer_profiles;
CREATE POLICY p_profiles_self
    ON customer_profiles
    FOR ALL
    TO authenticated
    USING (auth.uid() = auth_user_id)
    WITH CHECK (auth.uid() = auth_user_id);

-- ------------------------------------------------------------
-- customer_wishlist_items: rows belonging to the customer's profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_wishlist_owner ON customer_wishlist_items;
CREATE POLICY p_wishlist_owner
    ON customer_wishlist_items
    FOR ALL
    TO authenticated
    USING (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- customer_payments: rows belonging to the customer's profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_payments_owner ON customer_payments;
CREATE POLICY p_payments_owner
    ON customer_payments
    FOR ALL
    TO authenticated
    USING (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- customer_ledger: rows belonging to the customer's profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_ledger_owner ON customer_ledger;
CREATE POLICY p_ledger_owner
    ON customer_ledger
    FOR ALL
    TO authenticated
    USING (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- customer_verifications: rows belonging to the customer's profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_verifications_owner ON customer_verifications;
CREATE POLICY p_verifications_owner
    ON customer_verifications
    FOR ALL
    TO authenticated
    USING (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- customer_permanent_requests: rows belonging to the customer's profile
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_permreq_owner ON customer_permanent_requests;
CREATE POLICY p_permreq_owner
    ON customer_permanent_requests
    FOR ALL
    TO authenticated
    USING (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    )
    WITH CHECK (
        customer_id IN (
            SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
        )
    );

-- ------------------------------------------------------------
-- customer_order_items: items of orders owned by the customer
-- ------------------------------------------------------------
DROP POLICY IF EXISTS p_order_items_owner ON customer_order_items;
CREATE POLICY p_order_items_owner
    ON customer_order_items
    FOR ALL
    TO authenticated
    USING (
        order_id IN (
            SELECT id FROM customer_orders
            WHERE customer_id IN (
                SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
            )
        )
    )
    WITH CHECK (
        order_id IN (
            SELECT id FROM customer_orders
            WHERE customer_id IN (
                SELECT id FROM customer_profiles WHERE auth_user_id = auth.uid()
            )
        )
    );

-- ------------------------------------------------------------
-- audit_logs: intentionally NO policies for authenticated.
-- Service-role only (RLS enabled in 05; backend key bypasses it).
-- ------------------------------------------------------------
-- (no DROP/CREATE POLICY statements for audit_logs)

-- ------------------------------------------------------------
-- customer_profiles is also referenced by the 02_rls.sql-era customer_*
-- tables (customer_orders etc.). This file does not touch those tables'
-- existing policies.
-- ------------------------------------------------------------
