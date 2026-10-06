-- 21: one discount rule for every seller, instead of a discount per seller
-- run after 20_one_plan.sql (safe to run again).
-- rule: a seller whose delivered app and bulk sales last month reached the limit gets the discount on this month's fee.
-- the super admin changes only the two numbers (billing page, platform rules).

alter table public.platform_settings add column if not exists discount_min_sales numeric(12,2) not null default 500000;
alter table public.platform_settings add column if not exists discount_pct integer not null default 10;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'discount_rule_range') then
    alter table public.platform_settings add constraint discount_rule_range check (discount_min_sales >= 0 and discount_pct between 0 and 90);
  end if;
end $$;

-- the per-seller discount from 20 is not used any more
drop function if exists public.admin_center_fees();
drop function if exists public.set_fee_discount(uuid, integer);
alter table public.area_managers drop column if exists fee_discount_pct;

create or replace function public.seller_discount(p_sales numeric)
returns integer
language sql stable security definer set search_path = public
as $$
  select case when coalesce(p_sales, 0) >= s.discount_min_sales and s.discount_min_sales > 0 then s.discount_pct else 0 end
  from platform_settings s;
$$;

create or replace function public.bill_center_month(p_center uuid, p_month date, p_sample boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  v_month  date := date_trunc('month', p_month)::date;
  v_prev   record;
  v_disc   integer;
  v_id     uuid;
begin
  select id into v_id from center_invoices where area_manager_id = p_center and kind = 'monthly' and period_month = v_month and status <> 'void';
  if v_id is not null then return v_id; end if;
  select * into s from platform_settings;
  select * into v_prev from public.center_month_sales(p_center, (v_month - interval '1 month')::date);
  v_disc := public.seller_discount(v_prev.online_sales);
  insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                               sales_basis, online_sales, commission_pct, commission, amount, due_date, is_sample)
  values (p_center, 'monthly', v_month, to_char(v_month, 'FMMonth YYYY') || ' platform fee',
          s.monthly_fee, case when v_disc > 0 then 'Discount' else 'Standard' end, v_disc, v_prev.online_sales, v_prev.online_sales, 0, 0,
          round(s.monthly_fee * (100 - v_disc) / 100.0), greatest(v_month, (now() at time zone 'Asia/Karachi')::date) + s.payment_days, p_sample)
  returning id into v_id;
  return v_id;
end;
$$;

-- the seller's billing summary: the rule, last month's sales and this month's discount
create or replace function public.billing_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_center uuid := public.my_seller_id();
  s        public.platform_settings;
  this_m   record;
  last_m   record;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
begin
  if v_center is null then raise exception 'only an approved seller has billing'; end if;
  select * into s from platform_settings;
  select * into this_m from public.center_month_sales(v_center, v_today);
  select * into last_m from public.center_month_sales(v_center, (date_trunc('month', v_today) - interval '1 month')::date);
  return jsonb_build_object(
    'device_active', public.center_device_active(v_center),
    'billing_ok', public.center_billing_ok(v_center),
    'monthly_fee', s.monthly_fee, 'device_price', s.device_price,
    'discount_min_sales', s.discount_min_sales, 'discount_pct', s.discount_pct,
    'this_month_sales', this_m.total_sales, 'this_month_online', this_m.online_sales,
    'last_month_online', last_m.online_sales,
    'discount_now', public.seller_discount(last_m.online_sales),
    'discount_next', public.seller_discount(this_m.online_sales)
  );
end;
$$;

revoke execute on function public.seller_discount(numeric) from public, anon;
grant execute on function public.seller_discount(numeric), public.billing_overview() to authenticated;
