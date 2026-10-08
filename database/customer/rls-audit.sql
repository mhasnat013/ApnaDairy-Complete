-- ============================================================
-- ApnaDairy B2C — Supabase migration audit (run in SQL Editor)
-- Paste this AFTER ChatGPT hands you its migration batch,
-- BEFORE you apply it to the 'ApnaDairy Mobile App' project.
-- Anything flagged below = send it back to ChatGPT to fix.
-- ============================================================

-- 1. EVERY B2C table must have Row Level Security ENABLED.
--    rls_enabled = false on any table = STOP, do not apply.
SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 2. Dangerous grants: anon / authenticated must NEVER hold
--    INSERT, UPDATE, DELETE (or worse) on data tables.
--    Red flag rows: any privilege other than SELECT here.
SELECT t.table_name,
       string_agg(g.grantee || ': ' || g.privilege_type, ', '
                  ORDER BY g.grantee, g.privilege_type) AS grants
FROM information_schema.role_table_grants g
JOIN information_schema.tables t
  USING (table_schema, table_name)
WHERE t.table_schema = 'public'
  AND t.table_type = 'BASE TABLE'
  AND g.grantee IN ('anon', 'authenticated')
GROUP BY t.table_name
ORDER BY t.table_name;

-- 3. verification_docs bucket (CNIC front/back + profile photos)
--    must be PRIVATE. If public = true, fix with:
--    update storage.buckets set public = false where id = 'verification_docs';
SELECT id, name, public
FROM storage.buckets
WHERE id = 'verification_docs';

-- 4. Spot-check policies on a sensitive table (repeat per table).
--    Look for auth.uid() scoping on customer tables.
SELECT policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'profiles'
ORDER BY policyname;

-- Quick verdict cheat-sheet:
--   PASS = all tables rls_enabled=true, query 2 shows only SELECT
--          (or nothing), bucket public=false, policies use auth.uid().
--   FAIL = fix with ChatGPT BEFORE running migrations on production data.
