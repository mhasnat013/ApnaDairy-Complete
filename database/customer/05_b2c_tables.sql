-- ============================================================
-- ApnaDairy B2C — 05_b2c_tables.sql
-- Second-pass customer tables for the mobile backend.
--
-- RUN AFTER 01_tables.sql, 02_rls.sql, 03_storage.sql, 04_triggers.sql.
-- The following tables already exist in the "ApnaDairy Mobile App"
-- project and MUST NOT be recreated here:
--   customer_addresses, customer_orders, customer_deliveries,
--   customer_complaints, customer_notifications, customer_cart_items
--
-- Everything here is idempotent: safe to re-run (IF NOT EXISTS everywhere,
-- DROP POLICY IF EXISTS where needed). Nothing runs on the DB from here —
-- this file is only the migration source.
-- ============================================================

-- ------------------------------------------------------------
-- 1. customer_profiles
-- One row per customer auth user. auth_user_id = auth.users.id.
-- Verification status gate: unverified customers are explore-only.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_profiles (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id       UUID UNIQUE,
    first_name         TEXT,
    last_name          TEXT,
    email              TEXT UNIQUE,
    phone              TEXT,
    role               TEXT NOT NULL DEFAULT 'customer',
    verification_status TEXT NOT NULL DEFAULT 'pending',
    area_manager_id    UUID,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- 2. customer_wishlist_items
-- Saved marketplace items per customer (customer + product unique).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_wishlist_items (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    product_id  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (customer_id, product_id)
);

-- ------------------------------------------------------------
-- 3. customer_payments
-- Payment attempts per order (cod / bank-transfer-with-receipt / card).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_payments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id    UUID,
    customer_id UUID NOT NULL,
    amount      NUMERIC NOT NULL,
    method      TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',
    receipt_path TEXT,
    verified_by TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 4. customer_order_items
-- Line items per order (orders are per-manager, never merged).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_order_items (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id     UUID NOT NULL,
    product_id   TEXT,
    product_name TEXT,
    quantity     NUMERIC NOT NULL,
    unit_price   NUMERIC NOT NULL
);

-- ------------------------------------------------------------
-- 5. customer_ledger
-- Permanent/monthly-customer ledger entries (dues, payments, adjustments).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_ledger (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    entry_type  TEXT NOT NULL,
    amount      NUMERIC NOT NULL,
    ref         TEXT,
    created_at  TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 6. customer_verifications
-- SuperAdmin-gated KYC verification submissions per customer.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_verifications (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL,
    status           TEXT NOT NULL DEFAULT 'submitted',
    documents        JSONB NOT NULL DEFAULT '[]',
    rejection_reason TEXT,
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 7. customer_permanent_requests
-- Permanent-customer requests (15- or 30-day cycles), SuperAdmin-gated.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customer_permanent_requests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id      UUID NOT NULL,
    cycle            TEXT NOT NULL CHECK (cycle IN ('15', '30')),
    status           TEXT NOT NULL DEFAULT 'pending',
    start_date       DATE,
    end_date         DATE,
    rejection_reason TEXT,
    plan_details     JSONB NOT NULL DEFAULT '{}',
    created_at       TIMESTAMPTZ DEFAULT now(),
    updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 8. audit_logs
-- Backend-internal audit trail. Service-role only; no RLS policies
-- for anon/authenticated.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor      TEXT,
    action     TEXT NOT NULL,
    entity     TEXT,
    entity_id  TEXT,
    meta       JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ------------------------------------------------------------
-- 9. customer_orders.idempotency_key
-- Lets checkout retries reuse the same order instead of duplicating.
-- ------------------------------------------------------------
ALTER TABLE customer_orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_customer_idem
    ON customer_orders (customer_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- ------------------------------------------------------------
-- 10. Indexes (customer_id lookups; order_id joins)
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_wishlist_customer_id
    ON customer_wishlist_items (customer_id);
CREATE INDEX IF NOT EXISTS ix_payments_customer_id
    ON customer_payments (customer_id);
CREATE INDEX IF NOT EXISTS ix_ledger_customer_id
    ON customer_ledger (customer_id);
CREATE INDEX IF NOT EXISTS ix_verifications_customer_id
    ON customer_verifications (customer_id);
CREATE INDEX IF NOT EXISTS ix_permreq_customer_id
    ON customer_permanent_requests (customer_id);

CREATE INDEX IF NOT EXISTS ix_payments_order_id
    ON customer_payments (order_id);
CREATE INDEX IF NOT EXISTS ix_order_items_order_id
    ON customer_order_items (order_id);

-- ------------------------------------------------------------
-- 11. Security posture (per table)
-- Backend uses service_role (bypasses RLS). RLS is defense-in-depth:
-- enable it and revoke everything from anon/authenticated so a leaked
-- anon key can never reach these tables directly.
-- New tables do NOT inherit service_role grants, so grant explicitly.
-- ------------------------------------------------------------
DO $$
DECLARE
    t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'customer_profiles',
        'customer_wishlist_items',
        'customer_payments',
        'customer_order_items',
        'customer_ledger',
        'customer_verifications',
        'customer_permanent_requests',
        'audit_logs'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON %I FROM anon, authenticated', t);
        EXECUTE format('GRANT ALL ON %I TO service_role', t);
    END LOOP;
END $$;
