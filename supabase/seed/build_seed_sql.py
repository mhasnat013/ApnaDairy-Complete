"""
writes supabase/seed/farmers_from_app.sql from supabase/seed/farmers.json.
    python3 supabase/seed/build_seed_sql.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def email_for(f):
    base = re.sub(r'[^a-z]', '', f['full_name'].lower().replace('muhammad', 'm').replace('haji ', '').replace('hafiz ', ''))
    return f"{base[:18]}{int(f['seed']) % 900 + 100}@gmail.com"


def main():
    farmers = json.loads((ROOT / 'supabase' / 'seed' / 'farmers.json').read_text())
    rows = []
    for f in farmers:
        rows.append({
            'email': email_for(f), 'full_name': f['full_name'], 'phone': f['phone'], 'cnic': f['cnic'],
            'photo': f"/farmers/{f['slug']}.jpg", 'city': f['city'], 'village': f['village'], 'address': f['address'],
            'lat': f['lat'], 'lng': f['lng'], 'farm_name': f['farm_name'], 'milk_type': f['milk_type'],
            'cattle': f['cattle'], 'litres': f['litres'], 'notes': f['notes'], 'status': f['status'],
            'reason': f['reject_reason'], 'joined_h': round(f['joined_h'], 2), 'sent_h': round(f['sent_h'], 2),
            'approved_h': round(f['approved_h'], 2) if f['approved_h'] is not None else None,
        })
    data = json.dumps(rows, ensure_ascii=False, indent=0).replace("'", "''")
    sql = f"""-- farmers who signed up in the ApnaDairy app: {len(rows)} farmers in 7 cities (Lahore, Faisalabad, Sialkot, Islamabad,
-- Rawalpindi, Multan, Gujranwala). made with supabase/seed/make_farmers.py; names, phones and cnic numbers are made up and
-- the pictures (public/farmers/) are drawn.
-- run after 45_farmer_app.sql, once the super admin exists. safe to run again (farmers already there are skipped).
--   approved: {sum(r['status'] == 'active' for r in rows)}, each asks a milk center in their own city as soon as one is approved
--   waiting for the admin: {sum(r['status'] == 'pending' for r in rows)}
--   rejected (can send their details again): {sum(r['status'] == 'rejected' for r in rows)}
-- remove them all with supabase/seed/remove_farmers_from_app.sql.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'farmer_profiles' and column_name = 'app_managed') then
    raise exception 'run 45_farmer_app.sql first';
  end if;
  if not exists (select 1 from public.profiles where role = 'super_admin' and status = 'active') then
    raise exception 'the super admin must exist first';
  end if;
end $$;

create or replace function pg_temp.app_farmer(f jsonb)
returns text
language plpgsql
as $$
declare
  v_id    uuid := gen_random_uuid();
  v_admin uuid := (select id from public.profiles where role = 'super_admin' and status = 'active' order by created_at limit 1);
  v_join  timestamptz := now() - ((f->>'joined_h')::numeric * interval '1 hour');
  v_sent  timestamptz := now() - ((f->>'sent_h')::numeric * interval '1 hour');
  v_seen  timestamptz := now() - (coalesce((f->>'approved_h')::numeric, 0) * interval '1 hour');
begin
  if exists (select 1 from auth.users where lower(email) = lower(f->>'email')) then return 'skipped'; end if;

  -- the account, as the app's sign-up makes it
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', f->>'email',
          extensions.crypt(gen_random_uuid()::text || clock_timestamp()::text, extensions.gen_salt('bf')), v_join,
          '{{"provider": "email", "providers": ["email"]}}',
          jsonb_build_object('role', 'farmer', 'full_name', f->>'full_name', 'phone', f->>'phone'), v_join, v_sent, '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', f->>'email', 'email_verified', true), 'email', v_sent, v_join, v_sent);
  update public.profiles set created_at = v_join, updated_at = v_sent where id = v_id;

  -- the details and picture sent from the app
  insert into public.farmer_profiles (user_id, photo_path, city, village, address, latitude, longitude, farm_name, milk_type,
                                      cattle_count, daily_litres, notes, submitted_at, cnic, app_managed, created_at, updated_at)
  values (v_id, f->>'photo', f->>'city', f->>'village', f->>'address', (f->>'lat')::float8, (f->>'lng')::float8, f->>'farm_name',
          (f->>'milk_type')::milk_kind, (f->>'cattle')::int, (f->>'litres')::numeric, f->>'notes', v_sent, f->>'cnic', true, v_sent, v_sent);
  insert into public.notifications (user_id, kind, title, body, link, created_at, read_at)
  select a.id, 'farmer_signup', (f->>'full_name') || ' wants to join as a farmer',
         (f->>'city') || ', ' || (f->>'village') || ' · ' || (f->>'cattle') || ' cattle', '/admin/approvals?tab=farmer', v_sent,
         case when f->>'status' = 'pending' then null else v_seen end
    from public.profiles a where a.role = 'super_admin' and a.status = 'active';

  -- what the admin already decided
  if f->>'status' = 'active' then
    update public.farmer_profiles set verified_by = v_admin, verified_at = v_seen where user_id = v_id;
    update public.profiles set status = 'active', updated_at = v_seen where id = v_id;   -- the farmer then asks a center (45_farmer_app.sql)
  elsif f->>'status' = 'rejected' then
    update public.farmer_profiles set verified_by = v_admin, verified_at = v_seen, rejection_reason = f->>'reason' where user_id = v_id;
    update public.profiles set status = 'rejected', updated_at = v_seen where id = v_id;
  end if;
  return f->>'status';
end;
$$;

select x->>'status' as status, count(*) as farmers, count(*) filter (where r = 'skipped') as already_there
  from (select x, pg_temp.app_farmer(x) as r from jsonb_array_elements('{data}'::jsonb) x) s
 group by 1 order by 1;

-- centers that already have farmers asking them
select a.center_name, a.city, count(*) as farmers_asking
  from public.farmer_requests r join public.area_managers a on a.id = r.area_manager_id
  join public.farmer_profiles fp on fp.user_id = r.farmer_id and fp.app_managed
 where r.status = 'pending' group by 1, 2 order by 2, 1;
"""
    (ROOT / 'supabase' / 'seed' / 'farmers_from_app.sql').write_text(sql)
    (ROOT / 'supabase' / 'seed' / 'remove_farmers_from_app.sql').write_text(
        """-- removes the farmers loaded by farmers_from_app.sql (their accounts, requests and reviews).
-- milk a center already bought from them stays in that center's records.
delete from auth.users where id in (select user_id from public.farmer_profiles where app_managed);
select count(*) as app_farmers_left from public.farmer_profiles where app_managed;
""")
    print('wrote farmers_from_app.sql with', len(rows), 'farmers')


if __name__ == '__main__':
    main()
