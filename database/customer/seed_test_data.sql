-- ============================================================
-- TEST SEED — not business data.
-- ApnaDairy B2C — linkage-chain demonstration seed.
--
-- Purpose: after an accidental cleanup deleted ~40 seed
-- customer_payments rows (2026-10-07), this script recreates a SMALL,
-- clearly-marked TEST linkage chain so the full path
--   profile -> address -> order -> order_items -> payment -> ledger
-- is demonstrably intact on the "ApnaDairy Mobile App" project.
--
-- Every row is prefixed test- /. The customer id is the REAL auth uid of
-- the test account test-restore@apnadairy.test (created via Admin API,
-- email pre-confirmed, clearly marked TEST in user_metadata) because
-- customer_orders.customer_id has a FK to auth.users. All other UUIDs are
-- obviously-fake and the
-- email test-restore@apnadairy.test. NOTHING here is business data.
--
-- Safety:
--   * IDEMPOTENT — every INSERT is guarded by NOT EXISTS on the
--     fixed UUID / unique email. Re-running changes nothing.
--   * NEVER touches existing rows: no UPDATE, no DELETE anywhere.
--   * Does NOT repair the deleted original payment amounts — those are
--     unrecoverable except via Supabase dashboard Point-in-Time
--     Recovery (project Settings -> Database -> Backups).
-- ============================================================

-- Fixed, obviously-fake UUIDs for the test chain
--   profile : da912a1a-1714-41ee-af66-5b59ec58e1b1
--   address : 22222222-2222-4222-8222-222222222222
--   order 1 : 33333333-3333-4333-8333-333333333333  (delivered, COD paid)
--   order 2 : 44444444-4444-4433-8433-444444444444  (pending, payment pending)

-- 1. Test customer profile ------------------------------------
INSERT INTO customer_profiles
    (id, auth_user_id, first_name, last_name, email, phone, role,
     verification_status)
SELECT 'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'test-Restore', 'test-Customer', 'test-restore@apnadairy.test',
       '+920000000001', 'customer', 'approved'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_profiles
    WHERE id = 'da912a1a-1714-41ee-af66-5b59ec58e1b1'
);

-- 2. Test address ----------------------------------------------
INSERT INTO customer_addresses
    (id, customer_id, label, recipient_name, phone, address_line, city,
     latitude, longitude, is_default)
SELECT '22222222-2222-4222-8222-222222222222',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'test-Home', 'test-Restore', '+920000000001',
       'test-House 1, test-Street', 'test-City',
       33.6844, 73.0479, TRUE
WHERE NOT EXISTS (
    SELECT 1 FROM customer_addresses
    WHERE id = '22222222-2222-4222-8222-222222222222'
);

-- 3a. Test order 1 (delivered) ----------------------------------
INSERT INTO customer_orders
    (id, customer_id, area_manager_id, address_id, status, customer_checkout,
     total_amount, currency, idempotency_key)
SELECT '33333333-3333-4333-8333-333333333333',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       '9eab584c-59e8-4570-82df-7c88a0fd8b84',
       '22222222-2222-4222-8222-222222222222',
       'delivered',
       '{"source":"test_seed_restore","items":[{"name":"test-Desi ghee","quantity":2,"unit_price":878.0}],"payment_method":"cod"}'::jsonb,
       1856.0, 'PKR', 'test-seed-key-001'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_orders
    WHERE id = '33333333-3333-4333-8333-333333333333'
);

-- 3b. Test order 2 (pending) ------------------------------------
INSERT INTO customer_orders
    (id, customer_id, area_manager_id, address_id, status, customer_checkout,
     total_amount, currency, idempotency_key)
SELECT '44444444-4444-4433-8433-444444444444',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       '9eab584c-59e8-4570-82df-7c88a0fd8b84',
       '22222222-2222-4222-8222-222222222222',
       'pending',
       '{"source":"test_seed_restore","items":[{"name":"test-Desi ghee","quantity":1,"unit_price":878.0}],"payment_method":"cod"}'::jsonb,
       978.0, 'PKR', 'test-seed-key-002'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_orders
    WHERE id = '44444444-4444-4433-8433-444444444444'
);

-- 4. Order items -------------------------------------------------
INSERT INTO customer_order_items
    (order_id, product_id, product_name, quantity, unit_price)
SELECT '33333333-3333-4333-8333-333333333333',
       'test-product-ghee', 'test-Desi ghee', 2, 878.0
WHERE NOT EXISTS (
    SELECT 1 FROM customer_order_items
    WHERE order_id = '33333333-3333-4333-8333-333333333333'
);

INSERT INTO customer_order_items
    (order_id, product_id, product_name, quantity, unit_price)
SELECT '44444444-4444-4433-8433-444444444444',
       'test-product-ghee', 'test-Desi ghee', 1, 878.0
WHERE NOT EXISTS (
    SELECT 1 FROM customer_order_items
    WHERE order_id = '44444444-4444-4433-8433-444444444444'
);

-- 5. Payments ----------------------------------------------------
INSERT INTO customer_payments
    (order_id, customer_id, amount, method, status)
SELECT '33333333-3333-4333-8333-333333333333',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       1856.0, 'cod', 'cash_on_delivery'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_payments
    WHERE order_id = '33333333-3333-4333-8333-333333333333'
);

INSERT INTO customer_payments
    (order_id, customer_id, amount, method, status)
SELECT '44444444-4444-4433-8433-444444444444',
       'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       978.0, 'cod', 'pending'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_payments
    WHERE order_id = '44444444-4444-4433-8433-444444444444'
);

-- 6. Ledger entries ----------------------------------------------
INSERT INTO customer_ledger (customer_id, entry_type, amount, ref)
SELECT 'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'order_charge', 1856.0, 'test-order:33333333-3333-4333-8333-333333333333'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_ledger
    WHERE ref = 'test-order:33333333-3333-4333-8333-333333333333'
);

INSERT INTO customer_ledger (customer_id, entry_type, amount, ref)
SELECT 'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'payment_received', -1856.0, 'test-payment:order:33333333-3333-4333-8333-333333333333'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_ledger
    WHERE ref = 'test-payment:order:33333333-3333-4333-8333-333333333333'
);

INSERT INTO customer_ledger (customer_id, entry_type, amount, ref)
SELECT 'da912a1a-1714-41ee-af66-5b59ec58e1b1',
       'order_charge', 978.0, 'test-order:44444444-4444-4433-8433-444444444444'
WHERE NOT EXISTS (
    SELECT 1 FROM customer_ledger
    WHERE ref = 'test-order:44444444-4444-4433-8433-444444444444'
);

-- 7. Verification (run after applying; expect exactly these) -----
-- SELECT 'profiles', count(*) FROM customer_profiles WHERE email='test-restore@apnadairy.test';
-- SELECT 'addresses', count(*) FROM customer_addresses WHERE id='22222222-2222-4222-8222-222222222222';
-- SELECT 'orders', count(*) FROM customer_orders WHERE id IN ('33333333-3333-4333-8333-333333333333','44444444-4444-4433-8433-444444444444');
-- SELECT 'items', count(*) FROM customer_order_items WHERE order_id IN ('33333333-3333-4333-8333-333333333333','44444444-4444-4433-8433-444444444444');
-- SELECT 'payments', count(*) FROM customer_payments WHERE customer_id='da912a1a-1714-41ee-af66-5b59ec58e1b1';
-- SELECT 'ledger', count(*) FROM customer_ledger WHERE customer_id='da912a1a-1714-41ee-af66-5b59ec58e1b1';
