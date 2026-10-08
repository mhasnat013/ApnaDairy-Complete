-- ============================================================
-- ApnaDairy B2C — 07_b2c_storage.sql
-- Private storage buckets for customer uploads.
--
-- Buckets are private. The FastAPI backend (service_role) is the ONLY
-- writer/reader. NO permissive policies are created for anon or
-- authenticated — a leaked anon key cannot list or download these files.
--
-- Idempotent: ON CONFLICT DO NOTHING on bucket insert; DROP POLICY IF
-- EXISTS before each CREATE POLICY.
-- ============================================================

-- ------------------------------------------------------------
-- Buckets
-- ------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES
    ('customer-documents',    'customer-documents',    false),
    ('payment-receipts',      'payment-receipts',      false),
    ('complaint-attachments', 'complaint-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- customer-documents (CNIC front/back, profile photo, farm docs)
-- service_role only
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "customer-documents service_role all" ON storage.objects;
CREATE POLICY "customer-documents service_role all"
    ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'customer-documents')
    WITH CHECK (bucket_id = 'customer-documents');

-- ------------------------------------------------------------
-- payment-receipts (bank-transfer screenshot proof)
-- service_role only
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "payment-receipts service_role all" ON storage.objects;
CREATE POLICY "payment-receipts service_role all"
    ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'payment-receipts')
    WITH CHECK (bucket_id = 'payment-receipts');

-- ------------------------------------------------------------
-- complaint-attachments (photo attachments on complaints)
-- service_role only
-- ------------------------------------------------------------
DROP POLICY IF EXISTS "complaint-attachments service_role all" ON storage.objects;
CREATE POLICY "complaint-attachments service_role all"
    ON storage.objects
    FOR ALL
    TO service_role
    USING (bucket_id = 'complaint-attachments')
    WITH CHECK (bucket_id = 'complaint-attachments');

-- NOTE: no policies are granted to anon or authenticated for any of
-- these buckets. All uploads/downloads go through the backend using
-- the service_role key.
