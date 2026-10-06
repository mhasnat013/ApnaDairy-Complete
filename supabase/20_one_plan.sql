-- 20: one subscription plan; the super admin gives a discount to sellers who sell a lot
-- run after 19_byproducts.sql (safe to run again).
-- no automatic tiers: every seller pays the monthly fee, minus the discount the admin set for them.

alter table public.area_managers add column if not exists fee_discount_pct integer not null default 0;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fee_discount_range') then
    alter table public.area_managers add constraint fee_discount_range check (fee_discount_pct between 0 and 90);
  end if;
end $$;

-- the monthly bill: fee minus the seller's discount
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
  select coalesce(fee_discount_pct, 0) into v_disc from area_managers where id = p_center;
  select * into v_prev from public.center_month_sales(p_center, (v_month - interval '1 month')::date);
  insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                               sales_basis, online_sales, commission_pct, commission, amount, due_date, is_sample)
  values (p_center, 'monthly', v_month, to_char(v_month, 'FMMonth YYYY') || ' platform fee',
          s.monthly_fee, case when v_disc > 0 then 'Discount' else 'Standard' end, v_disc, v_prev.online_sales, v_prev.online_sales, 0, 0,
          round(s.monthly_fee * (100 - v_disc) / 100.0), greatest(v_month, (now() at time zone 'Asia/Karachi')::date) + s.payment_days, p_sample)
  returning id into v_id;
  return v_id;
end;
$$;

-- admin: every seller with its sales, to decide discounts
create or replace function public.admin_center_fees()
returns table (id uuid, center_name text, city text, type area_manager_type, last_month_sales numeric, this_month_sales numeric, fee_discount_pct integer)
language sql stable security definer set search_path = public
as $$
  select a.id, a.center_name, a.city, a.type,
         (select online_sales from public.center_month_sales(a.id, (date_trunc('month', now() at time zone 'Asia/Karachi') - interval '1 month')::date)),
         (select online_sales from public.center_month_sales(a.id, (now() at time zone 'Asia/Karachi')::date)),
         a.fee_discount_pct
  from area_managers a
  where public.is_admin() and a.verification_status = 'active'
  order by 5 desc nulls last;
$$;

create or replace function public.set_fee_discount(p_center uuid, p_pct integer)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 90 then raise exception 'discount can be 0 to 90%%'; end if;
  update area_managers set fee_discount_pct = p_pct where id = p_center;
  if not found then raise exception 'seller not found'; end if;
end;
$$;

-- the seller's billing summary shows their discount
do $$
declare d text;
begin
  select pg_get_functiondef('public.billing_overview()'::regprocedure) into d;
  if position('fee_discount_pct' in d) = 0 then
    d := replace(d, '''monthly_fee'', s.monthly_fee,',
      '''monthly_fee'', s.monthly_fee, ''fee_discount_pct'', (select fee_discount_pct from area_managers where id = v_center),');
    execute d;
  end if;
end $$;

revoke execute on function public.admin_center_fees(), public.set_fee_discount(uuid, integer) from public, anon;
grant execute on function public.admin_center_fees(), public.set_fee_discount(uuid, integer) to authenticated;
