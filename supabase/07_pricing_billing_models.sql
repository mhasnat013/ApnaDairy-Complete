-- =========================================================
-- apnadairy · pricing rules, subscriptions and the two ai models
--
-- 1. iot inputs now match the device: temperature (ds18b20), ph probe,
--    ec sensor, tds sensor, plus the reading timestamp from the firmware.
-- 2. two ai models, one function each, so the trained models can replace
--    them one by one without touching the portal:
--      model 1 · freshness, shelf life, spoilage / anomaly risk
--               inputs: temperature, timestamp, ph, ec
--      model 2 · adulteration detection
--               inputs: temperature, ph, ec, tds
-- 3. fair pricing: the ai gives the market rate. farmers are paid at least
--    90% of it (default offer 95%). fresh milk may be listed at most 30% above
--    the center's buying price (20% suggested). apnadairy keeps 5% commission
--    on orders that come through the platform (app and bulk orders).
-- 4. subscriptions: when a center is approved it is billed once for the iot
--    device and then monthly for the platform. high-selling centers get a
--    discount on the monthly fee. an overdue bill pauses bidding and testing.
--
-- every number above lives in platform_settings / billing_tiers, so the
-- super admin can change it without code.
-- run in supabase sql editor (after 06_area_manager.sql)
-- =========================================================

-- ---------- platform settings (one row) ----------
create table public.platform_settings (
  id                   boolean primary key default true check (id),
  device_price         numeric(10,2) not null default 25000 check (device_price >= 0),
  monthly_fee          numeric(10,2) not null default 3000  check (monthly_fee >= 0),
  commission_pct       numeric(5,2)  not null default 5     check (commission_pct between 0 and 50),
  farmer_min_pct       numeric(5,2)  not null default 90    check (farmer_min_pct between 50 and 100),
  farmer_default_pct   numeric(5,2)  not null default 95    check (farmer_default_pct between 50 and 100),
  markup_suggest_pct   numeric(5,2)  not null default 20    check (markup_suggest_pct between 0 and 100),
  markup_max_pct       numeric(5,2)  not null default 30    check (markup_max_pct between 0 and 100),
  payment_days         integer       not null default 7     check (payment_days between 1 and 60),
  updated_at           timestamptz   not null default now(),
  constraint default_above_min check (farmer_default_pct >= farmer_min_pct),
  constraint suggest_below_max check (markup_suggest_pct <= markup_max_pct)
);
insert into public.platform_settings default values;

-- discount on the monthly fee by last month's total sales
create table public.billing_tiers (
  name              text primary key,
  min_monthly_sales numeric(14,2) not null check (min_monthly_sales >= 0),
  discount_pct      integer not null check (discount_pct between 0 and 100)
);
insert into public.billing_tiers values
  ('Standard', 0, 0), ('Silver', 1000000, 10), ('Gold', 2000000, 20), ('Platinum', 4000000, 35);

alter table public.platform_settings enable row level security;
alter table public.billing_tiers     enable row level security;
create policy "settings: everyone signed in reads" on public.platform_settings for select to authenticated using (true);
create policy "settings: admin edits" on public.platform_settings for update using (public.is_admin()) with check (public.is_admin());
create policy "tiers: everyone signed in reads" on public.billing_tiers for select to authenticated using (true);
create policy "tiers: admin manages" on public.billing_tiers for all using (public.is_admin()) with check (public.is_admin());

-- ---------- invoices ----------
create type invoice_kind   as enum ('device', 'monthly');
create type invoice_status as enum ('due', 'paid', 'void');

create table public.center_invoices (
  id               uuid primary key default gen_random_uuid(),
  area_manager_id  uuid not null references public.area_managers(id) on delete cascade,
  kind             invoice_kind not null,
  period_month     date,                                   -- first day of the billed month (monthly only)
  description      text not null,
  device_fee       numeric(12,2) not null default 0,
  subscription_fee numeric(12,2) not null default 0,      -- before discount
  tier             text,
  discount_pct     integer not null default 0,
  sales_basis      numeric(14,2) not null default 0,      -- last month's total sales (decides the tier)
  online_sales     numeric(14,2) not null default 0,      -- last month's app + bulk orders
  commission_pct   numeric(5,2)  not null default 0,
  commission       numeric(12,2) not null default 0,
  amount           numeric(12,2) not null check (amount >= 0),
  status           invoice_status not null default 'due',
  issued_at        timestamptz not null default now(),
  due_date         date not null,
  paid_at          timestamptz,
  payment_method   text check (payment_method is null or payment_method in ('jazzcash', 'easypaisa', 'bank', 'cash')),
  payment_ref      text,
  is_sample        boolean not null default false,
  constraint monthly_has_period check (kind = 'device' or period_month is not null)
);
create unique index center_invoices_one_device on public.center_invoices (area_manager_id) where kind = 'device' and status <> 'void';
create unique index center_invoices_one_month  on public.center_invoices (area_manager_id, period_month) where kind = 'monthly' and status <> 'void';

alter table public.center_invoices enable row level security;
create policy "invoices: own center or admin" on public.center_invoices
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
-- writes go through the functions below

-- ---------- billing helpers ----------
create or replace function public.tier_for(p_sales numeric)
returns public.billing_tiers
language sql stable security definer set search_path = public
as $$
  select * from billing_tiers where min_monthly_sales <= coalesce(p_sales, 0) order by min_monthly_sales desc limit 1;
$$;

-- total sales and online (platform) sales of a center in one calendar month, pakistan time
create or replace function public.center_month_sales(p_center uuid, p_month date)
returns table (total_sales numeric, online_sales numeric)
language sql stable security definer set search_path = public
as $$
  with b as (
    select (date_trunc('month', p_month) at time zone 'Asia/Karachi') as s,
           ((date_trunc('month', p_month) + interval '1 month') at time zone 'Asia/Karachi') as e
  ),
  shop as (
    select coalesce(sum(o.total_amount), 0) as total,
           coalesce(sum(o.total_amount) filter (where o.channel = 'app'), 0) as online
    from shop_orders o, b where o.area_manager_id = p_center and o.status <> 'cancelled' and o.created_at >= b.s and o.created_at < b.e
  ),
  bulk as (
    select coalesce(sum(x.total_amount), 0) as total
    from bulk_orders x, b where x.area_manager_id = p_center and x.status = 'delivered' and x.delivered_at >= b.s and x.delivered_at < b.e
  )
  select shop.total + bulk.total, shop.online + bulk.total from shop, bulk;
$$;

-- a center may bid and use the device only while no bill is overdue
create or replace function public.center_billing_ok(p_center uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from center_invoices where area_manager_id = p_center and status = 'due'
      and due_date < (now() at time zone 'Asia/Karachi')::date
  );
$$;

create or replace function public.center_device_active(p_center uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from center_invoices where area_manager_id = p_center and kind = 'device' and status = 'paid');
$$;

-- build (or return) the monthly invoice of one center
create or replace function public.bill_center_month(p_center uuid, p_month date, p_sample boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  t        public.billing_tiers;
  v_month  date := date_trunc('month', p_month)::date;
  v_prev   record;
  v_fee    numeric;
  v_comm   numeric;
  v_id     uuid;
begin
  select id into v_id from center_invoices where area_manager_id = p_center and kind = 'monthly' and period_month = v_month and status <> 'void';
  if v_id is not null then return v_id; end if;

  select * into s from platform_settings;
  select * into v_prev from public.center_month_sales(p_center, (v_month - interval '1 month')::date);
  t := public.tier_for(v_prev.total_sales);
  v_fee  := round(s.monthly_fee * (100 - t.discount_pct) / 100.0);      -- whole rupees
  v_comm := round(v_prev.online_sales * s.commission_pct / 100.0);

  insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                               sales_basis, online_sales, commission_pct, commission, amount, due_date, is_sample)
  values (p_center, 'monthly', v_month,
          to_char(v_month, 'FMMonth YYYY') || ' platform fee' || case when v_prev.online_sales > 0 then ' and commission' else '' end,
          s.monthly_fee, t.name, t.discount_pct, v_prev.total_sales, v_prev.online_sales, s.commission_pct, v_comm,
          v_fee + v_comm, greatest(v_month, (now() at time zone 'Asia/Karachi')::date) + s.payment_days, p_sample)
  returning id into v_id;
  return v_id;
end;
$$;

-- when the admin approves a milk center: bill the iot device and the first month
create or replace function public.on_center_approved()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare s public.platform_settings;
begin
  if new.verification_status = 'active' and old.verification_status is distinct from 'active' and new.type = 'milk_center' then
    select * into s from platform_settings;
    if not exists (select 1 from center_invoices where area_manager_id = new.id and kind = 'device' and status <> 'void') then
      insert into center_invoices (area_manager_id, kind, description, device_fee, amount, due_date)
      values (new.id, 'device', 'ApnaDairy IoT milk tester (one-time)', s.device_price, s.device_price,
              (now() at time zone 'Asia/Karachi')::date + s.payment_days);
    end if;
    perform public.bill_center_month(new.id, (now() at time zone 'Asia/Karachi')::date);
  end if;
  return new;
end;
$$;

create trigger center_approved_billing
  after update of verification_status on public.area_managers
  for each row execute function public.on_center_approved();

-- admin: create this month's invoices for every active milk center
create or replace function public.generate_monthly_invoices(p_month date default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Karachi')::date))::date;
  v_count integer := 0;
  c record;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  for c in select a.id from area_managers a join profiles p on p.id = a.user_id
           where a.type = 'milk_center' and a.verification_status = 'active' and p.status = 'active' loop
    if not exists (select 1 from center_invoices where area_manager_id = c.id and kind = 'monthly' and period_month = v_month and status <> 'void') then
      perform public.bill_center_month(c.id, v_month);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- pay an invoice: the center pays its own (jazzcash / easypaisa / bank, simulated until a gateway is added),
-- or the admin records a cash or bank payment
create or replace function public.pay_invoice(p_invoice uuid, p_method text, p_ref text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.center_invoices;
begin
  select * into v from center_invoices where id = p_invoice for update;
  if v.id is null then raise exception 'invoice not found'; end if;
  if not (v.area_manager_id = public.my_milk_center_id() or public.is_admin()) then raise exception 'not allowed'; end if;
  if v.status <> 'due' then raise exception 'this invoice is not due'; end if;
  if p_method not in ('jazzcash', 'easypaisa', 'bank', 'cash') then raise exception 'choose a payment method'; end if;
  if p_method <> 'cash' and coalesce(trim(p_ref), '') = '' then raise exception 'enter the transaction id'; end if;
  update center_invoices set status = 'paid', paid_at = now(), payment_method = p_method, payment_ref = nullif(trim(p_ref), '')
   where id = p_invoice;
end;
$$;

create or replace function public.void_invoice(p_invoice uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  update center_invoices set status = 'void' where id = p_invoice and status = 'due';
  if not found then raise exception 'only a due invoice can be cancelled'; end if;
end;
$$;

-- what the billing page of a center shows
create or replace function public.billing_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  s        public.platform_settings;
  this_m   record;
  last_m   record;
  cur_t    public.billing_tiers;
  next_t   public.billing_tiers;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
begin
  if v_center is null then raise exception 'only a verified milk center has billing'; end if;
  select * into s from platform_settings;
  select * into this_m from public.center_month_sales(v_center, v_today);
  select * into last_m from public.center_month_sales(v_center, (date_trunc('month', v_today) - interval '1 month')::date);
  cur_t := public.tier_for(this_m.total_sales);
  select * into next_t from billing_tiers where min_monthly_sales > this_m.total_sales order by min_monthly_sales limit 1;
  return jsonb_build_object(
    'device_active', public.center_device_active(v_center),
    'billing_ok', public.center_billing_ok(v_center),
    'monthly_fee', s.monthly_fee, 'device_price', s.device_price, 'commission_pct', s.commission_pct,
    'this_month_sales', this_m.total_sales, 'this_month_online', this_m.online_sales,
    'commission_so_far', round(this_m.online_sales * s.commission_pct / 100.0),
    'last_month_sales', last_m.total_sales,
    'tier_now', cur_t.name, 'tier_now_discount', cur_t.discount_pct,
    'next_tier', next_t.name, 'next_tier_at', next_t.min_monthly_sales, 'next_tier_discount', next_t.discount_pct
  );
end;
$$;

-- admin view of every center's billing
create or replace view public.admin_billing with (security_invoker = true) as
select i.*, a.center_name, a.city
from public.center_invoices i
join public.area_managers a on a.id = i.area_manager_id;

-- ---------- iot readings: the device's real sensors ----------
alter table public.milk_collections
  add column tds_ppm            numeric(6,1) check (tds_ppm is null or tds_ppm between 0 and 9999),
  add column reading_at         timestamptz,
  add column freshness_score    integer check (freshness_score between 0 and 100),
  add column spoilage_risk      risk_level,
  add column adulteration_score integer check (adulteration_score between 0 and 100),
  add column suspected          text;
alter table public.milk_collections alter column density drop not null;
update public.milk_collections set reading_at = collected_at where reading_at is null;

-- ---------- model 1: freshness, shelf life, spoilage / anomaly risk ----------
-- inputs: temperature (ds18b20), timestamp (firmware clock), ph, ec
-- sample rules until the trained model is connected. normal ranges:
--   ph 6.6 to 6.8 · ec 3.8 to 5.5 mS/cm · fresh milk arrives at 33 to 37 °C
create or replace function public.ai_freshness(p_temperature numeric, p_ph numeric, p_ec numeric, p_reading_at timestamptz default now())
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_hours  numeric;
  v_score  integer;
  v_risk   risk_level := 'low';
  v_notes  text[] := '{}';
  v_hour   integer := extract(hour from p_reading_at at time zone 'Asia/Karachi');
begin
  -- acidity is the main sign of bacterial growth; warmth speeds it up
  v_hours := 48
    * least(1, greatest(0.1, (p_ph - 6.35) / 0.3))
    * case when p_temperature <= 10 then 1 when p_temperature <= 30 then 0.9 when p_temperature <= 37 then 0.8 else 0.6 end;
  -- conductivity rises as lactose turns to lactic acid
  if p_ec > 6.0 then v_hours := v_hours * 0.8; end if;
  -- milk tested far from milking time (late night) has been held longer
  if v_hour between 0 and 4 or v_hour >= 22 then v_hours := v_hours * 0.85; end if;
  v_hours := greatest(round(v_hours), 2);
  v_score := least(100, greatest(0, round(v_hours / 48 * 100)));

  if p_ph < 6.4 then
    v_risk := 'high'; v_notes := array_append(v_notes, 'pH is low, the milk is turning sour'::text);
  elsif p_ph < 6.55 then
    v_risk := 'medium'; v_notes := array_append(v_notes, 'pH is slightly low, sell this milk first'::text);
  end if;
  if p_temperature > 38 then
    if v_risk = 'low' then v_risk := 'medium'; end if;
    v_notes := array_append(v_notes, 'Milk is warm, chill it soon'::text);
  elsif p_temperature < 2 then
    v_notes := array_append(v_notes, 'Temperature reading is unusually low, check the sensor'::text);
  end if;

  return jsonb_build_object('model', 'freshness-sample-v1', 'freshness_hours', v_hours, 'freshness_score', v_score,
    'spoilage_risk', v_risk, 'anomaly', v_risk = 'high', 'notes', to_jsonb(v_notes));
end;
$$;

-- ---------- model 2: adulteration detection ----------
-- inputs: temperature, ph, ec, tds. tds ≈ 0.5 × ec (µS/cm), so normal milk reads about
-- 1900 to 2750 ppm. water lowers both; salt raises both; soda raises ph.
create or replace function public.ai_adulteration(p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_score   integer := 0;
  v_notes   text[] := '{}';
  v_sus     text := null;
  v_risk    risk_level;
  v_ratio   numeric := case when p_ec > 0 then p_tds / (p_ec * 1000) else null end;   -- normal ≈ 0.5
begin
  if p_tds < 1700 and p_ec < 3.6 then
    v_score := v_score + 70; v_sus := 'water'; v_notes := array_append(v_notes, 'TDS and conductivity are low, water may have been added'::text);
  elsif p_tds < 1900 or p_ec < 3.8 then
    v_score := v_score + 30; v_sus := coalesce(v_sus, 'water'); v_notes := array_append(v_notes, 'Dissolved solids are a little low'::text);
  end if;
  if p_tds > 3100 and p_ec > 6.2 then
    v_score := v_score + 70; v_sus := 'salt'; v_notes := array_append(v_notes, 'TDS and conductivity are high, salt may have been added'::text);
  elsif p_ec > 5.5 then
    v_score := v_score + 25; v_sus := coalesce(v_sus, 'salt or udder infection'); v_notes := array_append(v_notes, 'Conductivity is above normal'::text);
  end if;
  if p_ph > 6.9 then
    v_score := v_score + 40; v_sus := coalesce(v_sus, 'soda'); v_notes := array_append(v_notes, 'pH is high, soda may have been added'::text);
  end if;
  if v_ratio is not null and (v_ratio < 0.4 or v_ratio > 0.62) then
    v_score := v_score + 15; v_notes := array_append(v_notes, 'TDS does not match conductivity, possible additive or sensor fault'::text);
  end if;

  v_score := least(v_score, 99);
  v_risk := case when v_score >= 60 then 'high' when v_score >= 25 then 'medium' else 'low' end;
  return jsonb_build_object('model', 'adulteration-sample-v1', 'adulteration_risk', v_risk, 'adulteration_score', v_score,
    'suspected', v_sus, 'notes', to_jsonb(v_notes));
end;
$$;

-- ---------- combined assessment: both models → grade → market rate → farmer offer ----------
drop function if exists public.assess_milk(milk_kind, numeric, numeric, numeric, numeric);
create or replace function public.assess_milk(
  p_milk_type milk_kind, p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric, p_reading_at timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  m1       jsonb := public.ai_freshness(p_temperature, p_ph, p_ec, p_reading_at);
  m2       jsonb := public.ai_adulteration(p_temperature, p_ph, p_ec, p_tds);
  v_rate   numeric;
  v_score  integer;
  v_accept boolean;
  v_grade  quality_grade;
  v_market numeric;
  v_notes  text[];
begin
  select * into s from platform_settings;
  select case p_milk_type when 'cow' then cow_rate when 'buffalo' then buffalo_rate else mixed_rate end
    into v_rate from center_settings where area_manager_id = public.my_milk_center_id();
  v_rate := coalesce(v_rate, case p_milk_type when 'cow' then 170 when 'buffalo' then 200 else 185 end);

  -- quality score: freshness, purity and small drifts from the ideal
  v_score := round(
      0.45 * (m1->>'freshness_score')::int
    + 0.55 * (100 - (m2->>'adulteration_score')::int)
    - abs(p_ph - 6.70) * 60
    - greatest(0, p_ec - 4.9) * 6);
  v_score := least(100, greatest(0, v_score));
  v_accept := (m1->>'spoilage_risk') <> 'high' and (m2->>'adulteration_risk') <> 'high';
  v_grade := case when v_score >= 88 then 'premium' when v_score >= 82 then 'fresh' else 'standard' end;

  if v_accept then
    v_market := round(v_rate
      * case v_grade when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end
      * case (m2->>'adulteration_risk') when 'medium' then 0.95 else 1 end);
  end if;

  v_notes := array(select jsonb_array_elements_text(m1->'notes')) || array(select jsonb_array_elements_text(m2->'notes'));
  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_grade, 'score', v_score, 'base_rate', v_rate,
    'freshness', m1, 'adulteration', m2,
    'freshness_hours', m1->'freshness_hours', 'spoilage_risk', m1->'spoilage_risk',
    'adulteration_risk', m2->'adulteration_risk', 'adulteration_score', m2->'adulteration_score', 'suspected', m2->'suspected',
    'market_price', v_market,
    'offer_price', case when v_accept then round(v_market * s.farmer_default_pct / 100.0) end,
    'min_price', case when v_accept then ceil(v_market * s.farmer_min_pct / 100.0) end,
    'farmer_default_pct', s.farmer_default_pct, 'farmer_min_pct', s.farmer_min_pct,
    'notes', to_jsonb(v_notes)
  );
end;
$$;

-- ---------- record a collection with the new inputs ----------
drop function if exists public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric);
create or replace function public.record_collection(
  p_farmer uuid, p_quantity numeric, p_shift milk_shift,
  p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
  p_reading_at timestamptz default now(), p_source text default 'simulated', p_price numeric default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_farmer public.farmers;
  v_ai     jsonb;
  v_ok     boolean;
  v_price  numeric;
  v_id     uuid;
begin
  if v_center is null then raise exception 'only a verified milk center can record milk'; end if;
  if not public.center_billing_ok(v_center) then raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to continue'; end if;
  if p_source in ('device', 'simulated') and not public.center_device_active(v_center) then
    raise exception 'your IoT device activates once its invoice is paid. you can enter readings by hand meanwhile';
  end if;
  select * into v_farmer from farmers where id = p_farmer and area_manager_id = v_center;
  if v_farmer.id is null then raise exception 'this farmer is not registered with your center'; end if;
  if not v_farmer.is_active then raise exception 'this farmer is marked inactive'; end if;

  v_ai := public.assess_milk(v_farmer.milk_type, p_temperature, p_ph, p_ec, p_tds, coalesce(p_reading_at, now()));
  v_ok := (v_ai->>'accept')::boolean;
  if v_ok then
    v_price := coalesce(p_price, (v_ai->>'offer_price')::numeric);
    if v_price < (v_ai->>'min_price')::numeric then
      raise exception 'farmers must get at least % of the market rate: Rs % per litre or more', rtrim(rtrim(v_ai->>'farmer_min_pct', '0'), '.') || '%', v_ai->>'min_price';
    end if;
  end if;

  insert into milk_collections (
    area_manager_id, farmer_id, milk_type, shift, quantity_l,
    temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, device_serial,
    quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
    ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason
  ) values (
    v_center, p_farmer, v_farmer.milk_type, p_shift, p_quantity,
    p_temperature, p_ph, p_ec, p_tds, coalesce(p_reading_at, now()), p_source,
    (select device_serial from center_settings where area_manager_id = v_center),
    case when v_ok then (v_ai->>'quality')::quality_grade end,
    (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
    (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
    (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
    v_price,
    case when v_ok then 'offered'::collection_status else 'rejected'::collection_status end,
    case when v_ok then null else now() end,
    case when v_ok then null else 'Failed the quality test' end
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------- bidding pauses while a bill is overdue ----------
create or replace function public.place_bid(
  p_requirement   uuid,
  p_price         numeric,
  p_quantity      numeric,
  p_delivery_date date,
  p_max_age_hours integer default null,
  p_notes         text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_req    public.bulk_requirements;
  v_id     uuid;
begin
  if v_center is null then
    raise exception 'only verified milk collection centers can bid';
  end if;
  if not public.center_billing_ok(v_center) then
    raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to bid again';
  end if;

  select * into v_req from public.bulk_requirements where id = p_requirement;
  if v_req.id is null then raise exception 'requirement not found'; end if;
  if v_req.status <> 'open' or v_req.bid_deadline <= now() then
    raise exception 'bidding is closed for this requirement';
  end if;
  if p_quantity > v_req.quantity_l then
    raise exception 'you cannot offer more than the % L requested', v_req.quantity_l;
  end if;
  if p_delivery_date < current_date then
    raise exception 'delivery date cannot be in the past';
  end if;

  insert into public.bids (requirement_id, area_manager_id, price_per_l, quantity_l, delivery_date,
                           max_age_hours, notes)
  values (p_requirement, v_center, p_price, p_quantity, p_delivery_date, p_max_age_hours, p_notes)
  on conflict (requirement_id, area_manager_id) do update
     set price_per_l = excluded.price_per_l, quantity_l = excluded.quantity_l,
         delivery_date = excluded.delivery_date,
         max_age_hours = excluded.max_age_hours, notes = excluded.notes,
         status = 'submitted', updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

-- ---------- fair selling price for fresh milk ----------
-- what the center paid farmers per litre over the last 14 days, per milk type
create or replace view public.milk_cost_14d with (security_invoker = true) as
select milk_type,
       round(sum(total_amount) / nullif(sum(quantity_l), 0), 2) as avg_cost,
       sum(quantity_l) as litres
from public.milk_collections
where area_manager_id = public.my_milk_center_id() and status = 'accepted' and collected_at >= now() - interval '14 days'
group by milk_type;

create or replace function public.check_milk_markup()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_cost numeric;
  v_max  numeric;
  v_cap  numeric;
begin
  if new.category <> 'milk' then return new; end if;
  select round(sum(total_amount) / nullif(sum(quantity_l), 0), 2) into v_cost from milk_collections
   where area_manager_id = new.area_manager_id and milk_type = new.milk_type and status = 'accepted'
     and collected_at >= now() - interval '14 days';
  if v_cost is null then return new; end if;   -- nothing bought yet, nothing to compare with
  select markup_max_pct into v_max from platform_settings;
  v_cap := floor(v_cost * (100 + v_max) / 100.0);
  if new.price > v_cap then
    raise exception 'fresh % milk can be listed at most % above your buying price (Rs % per litre): Rs % or less', new.milk_type, rtrim(rtrim(v_max::text, '0'), '.') || '%', round(v_cost), v_cap;
  end if;
  return new;
end;
$$;

create trigger products_fair_milk_price
  before insert or update of price, milk_type, category on public.products
  for each row execute function public.check_milk_markup();

-- managers see the lowest offer on their request board too
create or replace view public.request_board as
select r.id, r.milk_type, r.quantity_l, r.required_date, r.delivery_city, r.delivery_address,
       r.quality, r.target_price, r.bid_deadline, r.notes, r.status, r.created_at,
       b.business_name, b.business_type,
       (select count(*) from public.bids x where x.requirement_id = r.id and x.status = 'submitted')::int as bid_count,
       (select min(x.price_per_l) from public.bids x where x.requirement_id = r.id and x.status = 'submitted') as lowest_offer
from public.bulk_requirements r
join public.business_profiles b on b.id = r.business_id
where r.status = 'open' and r.bid_deadline > now()
  and (public.my_milk_center_id() is not null or public.is_admin());

-- ---------- sample data, updated for the new sensors, models, prices and billing ----------
create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null then raise exception 'only a verified milk center can do this'; end if;
  delete from center_invoices  where area_manager_id = v_center and is_sample;
  delete from shop_orders      where area_manager_id = v_center and is_sample;
  delete from milk_usage       where area_manager_id = v_center and is_sample;
  delete from milk_collections where area_manager_id = v_center and is_sample;
  delete from products         where area_manager_id = v_center and is_sample;
  delete from farmers          where area_manager_id = v_center and is_sample;
end;
$$;

create or replace function public.seed_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_center  uuid := public.my_milk_center_id();
  names     text[] := array['Muhammad Aslam','Ghulam Rasool','Allah Ditta','Bashir Ahmed','Nazir Hussain','Rafiq Ahmed',
                            'Abdul Sattar','Manzoor Ali','Shaukat Ali','Zahid Iqbal','Rubina Bibi','Naseem Akhtar'];
  villages  text[] := array['Chak 41','Mauza Sarai','Dhok Kala','Basti Noor','Pind Ranjha','Kot Fateh'];
  types     milk_kind[] := array['buffalo','cow','buffalo','cow','mixed','buffalo','cow','buffalo','cow','mixed','cow','buffalo']::milk_kind[];
  base_l    numeric[] := array[18,12,22,9,14,16,11,20,8,13,7,15];
  buyers    text[] := array['Ayesha Khan','Bilal Ahmed','Sana Tariq','Usman Ali','Hira Malik','Fatima Noor','Hamza Sheikh',
                            'Zainab Raza','Ali Raza','Mariam Iqbal','Saad Qureshi','Noor Fatima','Imran Butt','Kiran Javed'];
  streets   text[] := array['House 12, Street 4, Gulshan Colony','Flat 3, Al-Noor Plaza','House 88, Block C, Model Town',
                            'House 5, Iqbal Road','House 21, Street 9, Satellite Town','House 140, Canal View'];
  v_farmers uuid[] := '{}';
  v_f       uuid;
  v_prod    record;
  p_cow     uuid; p_buf uuid; p_dahi uuid; p_lassi uuid; p_ghee uuid; p_makhan uuid; p_cream uuid;
  d         integer;
  i         integer;
  s         milk_shift;
  v_day     date;
  v_ts      timestamptz;
  v_qty     numeric; v_temp numeric; v_ph numeric; v_tds numeric; v_ec numeric; r numeric;
  v_ai      jsonb;
  v_ok      boolean;
  v_status  collection_status;
  v_reason  text;
  bought    numeric[]; carry numeric[] := array[0,0,0];  -- cow, buffalo, mixed
  target    numeric; sold numeric; k integer; v_type milk_kind; v_idx integer;
  v_order   uuid; v_total numeric; v_channel sale_channel; v_ostatus shop_order_status; v_amt numeric;
  v_keep    numeric;
  v_today   date := (now() at time zone 'Asia/Karachi')::date;   -- shop hours follow pakistan time
  v_hour    numeric := extract(hour from now() at time zone 'Asia/Karachi');
begin
  if v_center is null then raise exception 'only a verified milk center can load sample data'; end if;
  perform public.clear_sample_data();
  perform setseed(0.42);

  insert into center_settings (area_manager_id) values (v_center) on conflict (area_manager_id) do nothing;

  for i in 1..12 loop
    insert into farmers (area_manager_id, full_name, phone, village, milk_type, cattle_count, is_sample, created_at)
    values (v_center, names[i], '03' || (10 + floor(random() * 40))::int || lpad(floor(random() * 10000000)::text, 7, '0'),
            villages[1 + (i % 6)], types[i], 2 + floor(base_l[i] / 3)::int, true, now() - interval '60 days')
    returning id into v_f;
    v_farmers := v_farmers || v_f;
  end loop;

  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Fresh cow milk', 'milk', 'cow', 'litre', 205, null, null, null, true) returning id into p_cow;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Fresh buffalo milk', 'milk', 'buffalo', 'litre', 240, null, null, null, true) returning id into p_buf;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Dahi (yogurt)', 'yogurt', 'kg', 260, 34, v_today, v_today + 3, true) returning id into p_dahi;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Meethi lassi', 'lassi', 'bottle', 120, 26, v_today - 1, v_today + 1, true) returning id into p_lassi;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Desi ghee', 'ghee', 'kg', 2800, 9, v_today - 12, v_today + 170, true) returning id into p_ghee;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Makhan (white butter)', 'butter', 'kg', 1600, 4.5, v_today - 2, v_today + 5, true) returning id into p_makhan;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Fresh cream (malai)', 'cream', 'kg', 950, 3, v_today - 1, v_today + 2, true) returning id into p_cream;

  for d in reverse 29..0 loop
    v_day := v_today - d;
    bought := array[0,0,0];

    -- ---- collections: two shifts, every farmer, a few absences and problem samples ----
    foreach s in array array['morning','evening']::milk_shift[] loop
      for i in 1..12 loop
        v_ts := ((v_day + (case s when 'morning' then time '06:15' else time '17:30' end)) at time zone 'Asia/Karachi') + (i * 7 + floor(random() * 6)) * interval '1 minute';
        continue when v_ts > now();
        continue when random() < 0.07;   -- farmer did not come

        v_qty  := round((base_l[i] * (0.85 + random() * 0.3) * case s when 'morning' then 1.05 else 0.95 end)::numeric, 1);
        v_temp := round((33 + random() * 4)::numeric, 1);
        v_ph   := round((6.62 + random() * 0.16)::numeric, 2);
        v_ec   := round((case types[i] when 'buffalo' then 4.3 else 4.7 end + (random() - 0.5) * 0.8)::numeric, 2);
        r := random();
        if r < 0.035 then v_ec := round((3.0 + random() * 0.4)::numeric, 2);              -- water added
        elsif r < 0.055 then v_ph := round((6.30 + random() * 0.08)::numeric, 2);        -- souring
        elsif r < 0.07 then v_ec := round((6.7 + random() * 0.6)::numeric, 2);           -- salt
        elsif r < 0.075 then v_ph := round((6.95 + random() * 0.08)::numeric, 2);        -- soda
        elsif r < 0.12 then v_ph := round((6.47 + random() * 0.07)::numeric, 2);         -- slightly acidic
        end if;
        v_tds  := round((v_ec * 1000 * (0.49 + random() * 0.03))::numeric, 0);           -- tds sensor ≈ 0.5 × ec

        v_ai := public.assess_milk(types[i], v_temp, v_ph, v_ec, v_tds, v_ts);
        v_ok := (v_ai->>'accept')::boolean;
        v_reason := null;
        if not v_ok then v_status := 'rejected'; v_reason := 'Failed the quality test';
        elsif v_ts > now() - interval '50 minutes' then v_status := 'offered';
        elsif random() < 0.03 then v_status := 'rejected'; v_reason := 'Farmer refused the price';
        else v_status := 'accepted';
        end if;

        insert into milk_collections (
          area_manager_id, farmer_id, milk_type, shift, quantity_l, collected_at,
          temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, device_serial,
          quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
          ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason, payment, paid_at, is_sample
        ) values (
          v_center, v_farmers[i], types[i], s, v_qty, v_ts,
          v_temp, v_ph, v_ec, v_tds, v_ts, 'simulated', 'AD-IOT-0001',
          case when v_ok then (v_ai->>'quality')::quality_grade end,
          (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
          (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
          (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
          -- farmers get 95% of the market rate; now and then the manager pays a little more
          case when v_ok then (v_ai->>'offer_price')::numeric + case when random() < 0.12 then 1 + round(random() * 5) else 0 end end,
          v_status, case when v_status <> 'offered' then v_ts + interval '4 minutes' end, v_reason,
          case when v_status = 'accepted' and v_day < v_today - 6 then 'paid'::payment_status else 'unpaid'::payment_status end,
          case when v_status = 'accepted' and v_day < v_today - 6 then ((v_day + 7 + time '10:00') at time zone 'Asia/Karachi') end,
          true
        );
        if v_status = 'accepted' then
          v_idx := case types[i] when 'cow' then 1 when 'buffalo' then 2 else 3 end;
          bought[v_idx] := bought[v_idx] + v_qty;
        end if;
      end loop;
    end loop;

    -- ---- sales: sell most of the available milk, mixed milk goes into dahi and lassi ----
    for v_idx in 1..2 loop
      v_type := case v_idx when 1 then 'cow' else 'buffalo' end::milk_kind;
      target := (carry[v_idx] + bought[v_idx]) * (0.62 + random() * 0.12);
      if d = 0 then target := target * least(1, v_hour / 21); end if;
      sold := 0;
      while sold < target loop
        v_qty := (1 + floor(random() * 4))::numeric;
        exit when sold + v_qty > target;
        v_channel := case when random() < 0.45 then 'app' else 'walk_in' end;
        v_ts := ((v_day + time '07:00') at time zone 'Asia/Karachi') + floor(random() * 14 * 60) * interval '1 minute';
        if v_ts > now() then v_ts := now() - floor(random() * 90) * interval '1 minute'; end if;
        v_ostatus := 'delivered';
        if v_channel = 'app' and d = 0 and v_ts > now() - interval '3 hours' then
          v_ostatus := (array['pending','preparing','out_for_delivery'])[1 + floor(random() * 3)::int]::shop_order_status;
        elsif v_channel = 'app' and random() < 0.03 then v_ostatus := 'cancelled';
        end if;

        insert into shop_orders (area_manager_id, customer_name, customer_phone, channel, delivery_address, status, created_at, delivered_at, is_sample)
        values (v_center,
                case when v_channel = 'app' then buyers[1 + floor(random() * 14)::int] else 'Walk-in customer' end,
                case when v_channel = 'app' then '03' || (10 + floor(random() * 40))::int || lpad(floor(random() * 10000000)::text, 7, '0') end,
                v_channel,
                case when v_channel = 'app' then streets[1 + floor(random() * 6)::int] end,
                v_ostatus, v_ts,
                case when v_ostatus = 'delivered' then v_ts + (case when v_channel = 'app' then interval '35 minutes' else interval '0' end) end,
                true)
        returning id into v_order;

        insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
        values (v_order, case v_idx when 1 then p_cow else p_buf end,
                case v_idx when 1 then 'Fresh cow milk' else 'Fresh buffalo milk' end,
                'milk', v_type, 'litre', v_qty, case v_idx when 1 then 205 else 240 end);
        v_total := v_qty * case v_idx when 1 then 205 else 240 end;

        -- some customers add a dairy product
        if random() < 0.5 then
          k := floor(random() * 10)::int;
          select * into v_prod from products where id = case
            when k < 4 then p_dahi when k < 7 then p_lassi when k < 8 then p_cream when k < 9 then p_makhan else p_ghee end;
          v_amt := case v_prod.unit when 'bottle' then 1 + floor(random() * 3) else (array[0.5, 1, 1])[1 + floor(random() * 3)::int] end;
          insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
          values (v_order, v_prod.id, v_prod.name, v_prod.category, null, v_prod.unit, v_amt, v_prod.price);
          v_total := v_total + v_amt * v_prod.price;
        end if;

        update shop_orders set total_amount = v_total where id = v_order;
        if v_ostatus <> 'cancelled' then sold := sold + v_qty; end if;
      end loop;

      -- keep a small carry-over for tomorrow morning, the rest becomes dahi / lassi / ghee
      v_keep := round((25 + random() * 25)::numeric, 1);
      if d > 0 and carry[v_idx] + bought[v_idx] - sold > v_keep then
        insert into milk_usage (area_manager_id, milk_type, litres, reason, note, created_at, is_sample)
        values (v_center, v_type, round(carry[v_idx] + bought[v_idx] - sold - v_keep, 1), 'products',
                'Made dahi, lassi and ghee', ((v_day + time '21:00') at time zone 'Asia/Karachi'), true);
        carry[v_idx] := v_keep;
      else
        carry[v_idx] := carry[v_idx] + bought[v_idx] - sold;
      end if;
    end loop;

    -- mixed milk all goes into products the same evening
    if bought[3] > 0 and (d > 0 or v_hour >= 21) then
      insert into milk_usage (area_manager_id, milk_type, litres, reason, note, created_at, is_sample)
      values (v_center, 'mixed', bought[3], 'products', 'Made dahi and lassi', ((v_day + time '20:30') at time zone 'Asia/Karachi'), true);
    end if;

    -- a little spoilage now and then
    if d > 0 and random() < 0.15 and carry[1] > 8 then
      insert into milk_usage (area_manager_id, milk_type, litres, reason, note, created_at, is_sample)
      values (v_center, 'cow', 5, 'spoiled', 'Turned sour overnight', ((v_day + time '22:00') at time zone 'Asia/Karachi'), true);
      carry[1] := carry[1] - 5;
    end if;
  end loop;

  -- billing: device paid when the center joined, last two months paid, this month due
  if not exists (select 1 from center_invoices where area_manager_id = v_center and kind = 'device' and status <> 'void') then
    insert into center_invoices (area_manager_id, kind, description, device_fee, amount, issued_at, due_date, status, paid_at, payment_method, payment_ref, is_sample)
    select v_center, 'device', 'ApnaDairy IoT milk tester (one-time)', device_price, device_price,
           now() - interval '75 days', v_today - 68, 'paid', now() - interval '72 days', 'jazzcash', 'JC' || floor(random() * 1e9)::text, true
    from platform_settings;
  end if;
  for k in reverse 2..1 loop
    if not exists (select 1 from center_invoices where area_manager_id = v_center and kind = 'monthly'
                   and period_month = (date_trunc('month', v_today) - k * interval '1 month')::date and status <> 'void') then
      insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                                   sales_basis, online_sales, commission_pct, commission, amount, issued_at, due_date, status, paid_at,
                                   payment_method, payment_ref, is_sample)
      select v_center, 'monthly', (date_trunc('month', v_today) - k * interval '1 month')::date,
             to_char(date_trunc('month', v_today) - k * interval '1 month', 'FMMonth YYYY') || ' platform fee and commission',
             monthly_fee, 'Silver', 10, 1450000, 690000, commission_pct, round(690000 * commission_pct / 100.0),
             round(monthly_fee * 0.9 + 690000 * commission_pct / 100.0),
             date_trunc('month', v_today) - k * interval '1 month', (date_trunc('month', v_today) - k * interval '1 month')::date + 7,
             'paid', date_trunc('month', v_today) - k * interval '1 month' + interval '3 days',
             case k when 2 then 'easypaisa' else 'bank' end, 'TX' || floor(random() * 1e9)::text, true
      from platform_settings;
    end if;
  end loop;
  perform public.bill_center_month(v_center, v_today, true);

  -- the newest app order of the day has just come in
  update shop_orders set status = 'pending', delivered_at = null
   where id = (select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app'
                 and status <> 'cancelled' and created_at > now() - interval '3 hours' order by created_at desc limit 1);
end;
$$;

revoke execute on function public.seed_sample_data(), public.clear_sample_data() from anon;
revoke execute on function public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, timestamptz, text, numeric) from anon;
revoke execute on function public.generate_monthly_invoices(date), public.pay_invoice(uuid, text, text), public.void_invoice(uuid) from anon;
revoke execute on function public.bill_center_month(uuid, date, boolean) from anon, authenticated;
