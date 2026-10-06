-- 23_validation.sql: the database refuses bad input, not only the screens
-- run after 22. constraints are "not valid": they check every new or edited row,
-- old rows are left as they are.

-- ---------- 1. a pakistani mobile number: 03xxxxxxxxx (spaces, dashes and +92 are fine) ----------
create or replace function public.is_pk_mobile(p text)
returns boolean language sql immutable as $$
  select coalesce(trim(p), '') = '' or public.norm_phone(p) ~ '^03[0-9]{9}$';
$$;

-- ---------- 2. constraints ----------
do $$
declare c record;
begin
  for c in select * from (values
    ('profiles',          'profiles_phone_ok',        'public.is_pk_mobile(phone)'),
    ('profiles',          'profiles_name_ok',         'char_length(trim(full_name)) between 2 and 80'),
    ('farmers',           'farmers_phone_ok',         'public.is_pk_mobile(phone)'),
    ('farmers',           'farmers_name_len',         'char_length(full_name) <= 80'),
    ('farmers',           'farmers_village_len',      'village is null or char_length(village) <= 60'),
    ('shop_profiles',     'shop_phone_ok',            'public.is_pk_mobile(phone) and public.is_pk_mobile(whatsapp)'),
    ('shop_profiles',     'shop_hours_len',           'opening_hours is null or char_length(opening_hours) <= 80'),
    ('area_managers',     'am_name_ok',               'char_length(trim(center_name)) between 2 and 80'),
    ('area_managers',     'am_city_ok',               'char_length(trim(city)) between 2 and 40'),
    ('area_managers',     'am_address_len',           'address is null or char_length(address) <= 200'),
    ('business_profiles', 'bp_name_ok',               'char_length(trim(business_name)) between 2 and 80'),
    ('business_profiles', 'bp_city_ok',               'char_length(trim(city)) between 2 and 40'),
    ('business_profiles', 'bp_address_len',           'address is null or char_length(address) <= 200'),
    ('bulk_requirements', 'req_qty_max',              'quantity_l <= 100000'),
    ('bulk_requirements', 'req_price_max',            'target_price is null or target_price <= 100000'),
    ('bulk_requirements', 'req_city_ok',              'char_length(trim(delivery_city)) between 2 and 40'),
    ('bulk_requirements', 'req_address_len',          'delivery_address is null or char_length(delivery_address) <= 200'),
    ('bulk_requirements', 'req_notes_len',            'notes is null or char_length(notes) <= 500'),
    ('bids',              'bid_max',                  'price_per_l <= 100000 and quantity_l <= 100000 and make_qty <= 100000'),
    ('bids',              'bid_notes_len',            'notes is null or char_length(notes) <= 300'),
    ('products',          'products_text_len',        'char_length(name) <= 60 and (description is null or char_length(description) <= 140)'),
    ('products',          'products_max',             'price <= 1000000 and (stock_qty is null or stock_qty <= 100000)'),
    ('milk_usage',        'usage_note_len',           'note is null or char_length(note) <= 200'),
    ('farmer_payouts',    'payout_ref_len',           'reference is null or char_length(reference) <= 40'),
    ('center_invoices',   'invoice_ref_len',          'payment_ref is null or char_length(payment_ref) <= 40'),
    ('shop_reviews',      'shop_review_len',          '(comment is null or char_length(comment) <= 500) and (reply is null or char_length(reply) <= 500)')
  ) as t(tbl, name, expr) loop
    execute format('alter table public.%I drop constraint if exists %I', c.tbl, c.name);
    execute format('alter table public.%I add constraint %I check (%s) not valid', c.tbl, c.name, c.expr);
  end loop;
end $$;

-- ---------- 3. clear messages instead of "violates check constraint" ----------
-- the screens check first; these catch anything sent around them
create or replace function public.check_farmer_row()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  new.full_name := trim(new.full_name);
  new.village := nullif(trim(new.village), '');
  new.phone := nullif(trim(new.phone), '');
  if char_length(new.full_name) < 2 then raise exception 'enter the farmer''s full name'; end if;
  if not public.is_pk_mobile(new.phone) then raise exception 'phone must be a mobile number like 0300 1234567'; end if;
  if new.phone is not null and not coalesce(new.is_sample, false) and exists (
    select 1 from farmers f where f.area_manager_id = new.area_manager_id and f.id <> new.id
       and public.norm_phone(f.phone) = public.norm_phone(new.phone)) then
    raise exception 'another farmer at your center already has this phone number';
  end if;
  return new;
end $$;
drop trigger if exists farmers_0_check on public.farmers;
create trigger farmers_0_check before insert or update on public.farmers
  for each row execute function public.check_farmer_row();

-- signup: the profile trigger reads these from the sign-up form, so check them before the account is made
create or replace function public.check_signup_meta()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare m jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  if m ? 'phone' and not public.is_pk_mobile(m->>'phone') then
    raise exception 'phone must be a mobile number like 0300 1234567';
  end if;
  if m ? 'full_name' and char_length(trim(m->>'full_name')) not between 2 and 80 then
    raise exception 'enter your full name';
  end if;
  return new;
end $$;
drop trigger if exists a_check_signup_meta on auth.users;
create trigger a_check_signup_meta before insert on auth.users
  for each row execute function public.check_signup_meta();

revoke all on function public.check_farmer_row() from public, anon, authenticated;
revoke all on function public.check_signup_meta() from public, anon, authenticated;
grant execute on function public.is_pk_mobile(text) to anon, authenticated;

-- ---------- 4. this month's bill and the billing page agree ----------
-- a bill made before the discount rule existed is priced again, if it is still unpaid
update public.center_invoices i
   set discount_pct = x.d,
       tier = case when x.d > 0 then 'Discount' else 'Standard' end,
       sales_basis = x.sales, online_sales = x.sales,
       amount = round(i.subscription_fee * (100 - x.d) / 100.0)
  from (select c.id, s.online_sales as sales, public.seller_discount(s.online_sales) as d
          from public.center_invoices c
          cross join lateral public.center_month_sales(c.area_manager_id, (c.period_month - interval '1 month')::date) s
         where c.kind = 'monthly' and c.status = 'due' and c.submitted_at is null
           and c.period_month = date_trunc('month', now() at time zone 'Asia/Karachi')::date) x
 where i.id = x.id and i.discount_pct is distinct from x.d;

-- the discount shown is the one on this month's bill once the bill exists
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.billing_overview()'::regprocedure);
  v_def := replace(v_def,
    $r$'discount_now', public.seller_discount(last_m.online_sales),$r$,
    $r$'discount_now', coalesce((select discount_pct from center_invoices where area_manager_id = v_center and kind = 'monthly' and status <> 'void' and period_month = date_trunc('month', v_today)::date), public.seller_discount(last_m.online_sales)),$r$);
  execute v_def;
end $$;
