-- 36: milk lasts at most 2 days
-- run after 35_farmer_onboarding.sql (safe to run again).
--
-- milk can be sold for at most 2 days after it was collected and tested (sooner if the ai test says it spoils sooner).
-- day 1 is the normal price; before it expires the area manager can give any discount (no retest needed any more).
-- once it expires, the system discards it from stock and ends the listing, so the same milk can never be sold again.
-- the check runs every hour (pg_cron) and whenever the center opens its shop or inventory.

-- ---------- the 2-day rule ----------
create or replace function public.shelf_hours(p_ai_hours numeric)
returns numeric language sql immutable as $$ select least(coalesce(p_ai_hours, 24), 48) $$;

-- every place that works out fresh milk now uses it
do $$
declare f text; d text;
begin
  foreach f in array array['public.milk_shelf(uuid,milk_kind)', 'public.listing_grade(uuid,milk_kind)',
                           'public.milk_fresh_at(uuid,milk_kind,timestamptz,quality_grade)'] loop
    select pg_get_functiondef(f::regprocedure) into d;
    if position('freshness_hours, 24)' in d) > 0 then
      d := regexp_replace(d, 'coalesce\(([a-z])\.freshness_hours, 24\)', 'public.shelf_hours(\1.freshness_hours)', 'g');
      execute d;
    end if;
  end loop;
end $$;

-- ---------- listings carry the expiry of the milk they sell ----------
alter table public.products
  add column if not exists listed_at       timestamptz,
  add column if not exists milk_from       timestamptz,   -- when the oldest milk of this listing was collected (day 1 starts)
  add column if not exists milk_expires_at timestamptz,   -- when the oldest milk of this listing expires
  add column if not exists expired_at      timestamptz;   -- set when the listing ended because its milk expired

-- when the oldest fresh milk in stock expires (stock goes out first in, first out)
create or replace function public.oldest_fresh_expiry(p_center uuid, p_type milk_kind)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, coalesce(m.reading_at, m.collected_at) + public.shelf_hours(m.freshness_hours) * interval '1 hour' as good_until,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  )
  select min(b.good_until) from b, stock
  where least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) > 0 and b.good_until > now();
$$;
revoke all on function public.oldest_fresh_expiry(uuid, milk_kind) from public, anon;
grant execute on function public.oldest_fresh_expiry(uuid, milk_kind) to authenticated;

-- when that oldest fresh milk was collected
create or replace function public.oldest_fresh_from(p_center uuid, p_type milk_kind)
returns timestamptz
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.collected_at, coalesce(m.reading_at, m.collected_at) + public.shelf_hours(m.freshness_hours) * interval '1 hour' as good_until,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  )
  select min(b.collected_at) from b, stock
  where least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) > 0 and b.good_until > now();
$$;
revoke all on function public.oldest_fresh_from(uuid, milk_kind) from public, anon;
grant execute on function public.oldest_fresh_from(uuid, milk_kind) to authenticated;

-- listing (or adding litres, or listing again after it expired) takes the expiry of the milk in stock now
create or replace function public.stamp_milk_listing()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.category <> 'milk' then return new; end if;
  if tg_op = 'INSERT' or coalesce(new.listed_l, 0) > coalesce(old.listed_l, 0)
     or (old.expired_at is not null and coalesce(new.listed_l, 0) > 0) then
    new.listed_at := now();
    new.milk_expires_at := public.oldest_fresh_expiry(new.area_manager_id, new.milk_type);
    new.milk_from := public.oldest_fresh_from(new.area_manager_id, new.milk_type);
    new.expired_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists products_listing_stamp on public.products;
create trigger products_listing_stamp before insert or update of listed_l on public.products
  for each row execute function public.stamp_milk_listing();

-- a discount is free now (no retest), but only while the milk has not expired
create or replace function public.guard_milk_discount()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.category = 'milk' and coalesce(new.discount_pct, 0) > 0
     and (tg_op = 'INSERT' or new.discount_pct is distinct from old.discount_pct)
     and not (tg_op = 'INSERT' and coalesce(new.is_sample, false)) then
    if new.expired_at is not null or (new.milk_expires_at is not null and new.milk_expires_at <= now()) then
      raise exception 'this milk has expired, so it cannot be sold. list fresh milk instead';
    end if;
  end if;
  return new;
end;
$$;

-- listings already on the app get their expiry now
update public.products p set listed_at = coalesce(p.listed_at, now()),
       milk_expires_at = public.oldest_fresh_expiry(p.area_manager_id, p.milk_type),
       milk_from = public.oldest_fresh_from(p.area_manager_id, p.milk_type)
 where p.category = 'milk' and (p.milk_expires_at is null or p.milk_from is null) and p.expired_at is null;

-- customers only see milk that has not expired
create or replace view public.public_listings as
 select pr.id,
    pr.area_manager_id as shop_id,
    sh.center_name as shop_name,
    sh.city,
    sh.rating,
    sh.review_count,
    sh.cover_path,
    pr.name,
    pr.milk_type,
    listing_grade(pr.area_manager_id, pr.milk_type) as quality,
    pr.description,
    pr.price as list_price,
    pr.discount_pct,
    round(((pr.price * ((100 - pr.discount_pct))::numeric) / 100.0)) as price_per_l,
    greatest((0)::numeric, round((floor((least(coalesce(pr.listed_l, st.sellable_l), st.sellable_l) * (2)::numeric)) / (2)::numeric), 1)) as available_l,
    ps.order_min_l as min_order_l,
    ps.order_max_l as max_order_l,
    f.freshness_score,
    f.hours_left,
    f.oldest_hours,
    pr.created_at,
    pr.milk_expires_at as expires_at
   from ((((products pr
     join public_shops sh on ((sh.id = pr.area_manager_id)))
     cross join platform_settings ps)
     cross join lateral ( select milk_sellable(pr.area_manager_id, pr.milk_type) as sellable_l) st)
     cross join lateral listing_freshness(pr.area_manager_id, pr.milk_type) f(freshness_score, hours_left, oldest_hours))
  where pr.category = 'milk' and pr.is_available and pr.expired_at is null
    and (pr.milk_expires_at is null or pr.milk_expires_at > now());

-- ---------- expire and discard ----------
create or replace function public.expire_milk_for(p_center uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  t milk_kind;
  v_exp numeric;
  v_total numeric := 0;
  v_ended text[] := '{}';
  v_name text;
  v_owner uuid;
  v_sample boolean;
begin
  select user_id, is_demo into v_owner, v_sample from area_managers where id = p_center and type = 'milk_center';
  if v_owner is null then return jsonb_build_object('discarded_l', 0, 'listings', 0); end if;
  -- milk past its 2 days (or its ai shelf life) leaves the stock as discarded
  foreach t in array enum_range(null::milk_kind) loop
    select round(expired_l, 1) into v_exp from public.milk_shelf(p_center, t);
    if coalesce(v_exp, 0) >= 0.1 then
      insert into milk_usage (area_manager_id, milk_type, litres, reason, note, is_sample)
      values (p_center, t, v_exp, 'spoiled', 'Expired: more than 2 days old, or past its tested shelf life (removed automatically)', coalesce(v_sample, false));
      v_total := v_total + v_exp;
    end if;
  end loop;
  -- listings whose milk expired end; the center lists fresh milk again
  for v_name in
    update products set expired_at = now(), listed_l = 0, discount_pct = 0
     where area_manager_id = p_center and category = 'milk' and expired_at is null
       and milk_expires_at is not null and milk_expires_at <= now()
    returning name
  loop
    v_ended := v_ended || v_name;
  end loop;

  if v_total > 0 or cardinality(v_ended) > 0 then
    perform public.notify(v_owner, 'milk_expired',
      case when cardinality(v_ended) > 0 then array_to_string(v_ended, ', ') || ' expired' else public.fmt_qty(v_total) || ' L of milk expired' end,
      concat_ws(' ', case when v_total > 0 then public.fmt_qty(v_total) || ' L reached its 2-day limit (or its tested shelf life) and was discarded from your stock.' end,
                     case when cardinality(v_ended) > 0 then 'List fresh milk again to keep selling.' end),
      '/manager/shop');
  end if;
  return jsonb_build_object('discarded_l', v_total, 'listings', cardinality(v_ended));
end;
$$;
revoke all on function public.expire_milk_for(uuid) from public, anon, authenticated;

-- the center's own pages call this when they open
create or replace function public.run_milk_expiry()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null then return jsonb_build_object('discarded_l', 0, 'listings', 0); end if;
  return public.expire_milk_for(v_center);
end;
$$;
revoke all on function public.run_milk_expiry() from public, anon;
grant execute on function public.run_milk_expiry() to authenticated;

-- every center (the hourly job)
create or replace function public.run_milk_expiry_all()
returns integer
language plpgsql security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in select a.id from area_managers a where a.type = 'milk_center' and a.verification_status = 'active' loop
    perform public.expire_milk_for(r.id);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.run_milk_expiry_all() from public, anon, authenticated;

-- every hour, if pg_cron is available (supabase: database → extensions → pg_cron)
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('apnadairy-milk-expiry', '7 * * * *', 'select public.run_milk_expiry_all()');
exception when others then
  raise notice 'pg_cron is not available, so expiry runs when centers open their pages: %', sqlerrm;
end $$;
