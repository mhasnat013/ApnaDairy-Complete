-- 43: dynamic pricing for milk listings
-- run after 42_marketplace.sql (safe to run again).
--
-- a milk center chooses, per listing, how its price changes:
--   manual  = free discount: the area manager sets any discount, any time (as before)
--   dynamic = the price drops by itself as the milk gets older, counted from when its oldest milk was tested:
--     0 to 4 h      tested grade       full price
--     4 to 12 h     good now           10% off
--     12 to 24 h    standard now       20% off
--     24 h to the last 6 h   for yogurt / cooking   30% off
--     last 6 h      last hours         40% off
--     48 h          expires and is discarded (36_milk_expiry.sql)
-- the tested grade never changes; the stage is a separate label. the stage is worked out live, so no job is needed,
-- and orders charge it because place_shop_order takes the price from public_listings.

-- ---------- 1. the choice ----------
alter table public.products add column if not exists pricing_mode text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'products_pricing_mode_check') then
    alter table public.products add constraint products_pricing_mode_check
      check (pricing_mode in ('manual', 'dynamic') and (pricing_mode = 'manual' or category = 'milk'));
  end if;
end $$;

-- dynamic pricing replaces the manual discount: one or the other
create or replace function public.dynamic_no_discount()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.pricing_mode = 'dynamic' then new.discount_pct := 0; end if;
  return new;
end;
$$;
drop trigger if exists products_dynamic_no_discount on public.products;
create trigger products_dynamic_no_discount before insert or update on public.products
  for each row execute function public.dynamic_no_discount();

-- ---------- 2. the stage right now ----------
-- from when the milk expires (its test time + 2 days): the stage now, its discount, and when the next drop comes
create or replace function public.price_stage(p_expires timestamptz)
returns table (stage text, pct integer, next_at timestamptz)
language sql stable set search_path = public
as $$
  with t as (select p_expires - public.shelf_hours(null::numeric) * interval '1 hour' as tested, p_expires as ends)
  select s.stage, s.pct, case when s.stage = 'last_hours' then null else s.until end
  from t, lateral (values
    ('tested',     0,  t.tested + interval '4 hours'),
    ('good',       10, t.tested + interval '12 hours'),
    ('standard',   20, t.tested + interval '24 hours'),
    ('cooking',    30, t.ends - interval '6 hours'),
    ('last_hours', 40, t.ends)
  ) s(stage, pct, until)
  where p_expires is not null and now() < s.until
  order by s.until
  limit 1;
$$;
grant execute on function public.price_stage(timestamptz) to anon, authenticated;

-- ---------- 3. listings show and charge it ----------
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
    (case when pr.pricing_mode = 'dynamic' then coalesce(dp.pct, 0) else pr.discount_pct end)::integer as discount_pct,
    round(((pr.price * ((100 - case when pr.pricing_mode = 'dynamic' then coalesce(dp.pct, 0) else pr.discount_pct end))::numeric) / 100.0)) as price_per_l,
    greatest((0)::numeric, round((floor((least(coalesce(pr.listed_l, st.sellable_l), st.sellable_l) * (2)::numeric)) / (2)::numeric), 1)) as available_l,
    ps.order_min_l as min_order_l,
    ps.order_max_l as max_order_l,
    f.freshness_score,
    f.hours_left,
    f.oldest_hours,
    pr.created_at,
    pr.milk_expires_at as expires_at,
    lm.model_quality,
    lm.spoilage_pct,
    lm.shelf_left_h as model_shelf_left_h,
    lm.tested_at,
    pr.pricing_mode,
    dp.stage as price_stage,
    dp.next_at as next_drop_at
   from (((((products pr
     join public_shops sh on ((sh.id = pr.area_manager_id)))
     cross join platform_settings ps)
     cross join lateral ( select milk_sellable(pr.area_manager_id, pr.milk_type) as sellable_l) st)
     cross join lateral listing_freshness(pr.area_manager_id, pr.milk_type) f(freshness_score, hours_left, oldest_hours))
     cross join lateral listing_model(pr.area_manager_id, pr.milk_type) lm)
     left join lateral price_stage(pr.milk_expires_at) dp on pr.pricing_mode = 'dynamic'
  where pr.category = 'milk' and pr.is_available and pr.expired_at is null
    and (pr.milk_expires_at is null or pr.milk_expires_at > now());

-- (44_model2.sql adds the water check to this view; running this file again leaves that newer view alone)
do $do$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'marketplace_milk' and column_name = 'water_check') then
    execute $v$
create or replace view public.marketplace_milk as
 select l.id, l.shop_id, l.shop_name, l.city, l.rating, l.review_count, l.cover_path,
        l.name, l.milk_type, l.quality, l.description, l.list_price, l.discount_pct, l.price_per_l, l.available_l,
        l.freshness_score, l.model_quality, l.spoilage_pct, l.model_shelf_left_h, l.tested_at, l.expires_at,
        coalesce(p.listed_at, p.created_at) as listed_at,
        t.ph as test_ph, t.temperature_c as test_temperature_c,
        l.pricing_mode, l.price_stage, l.next_drop_at
   from public_listings l
   join products p on p.id = l.id
   cross join lateral listing_tests(l.shop_id, l.milk_type) t
  where l.available_l > 0;
$v$;
  end if;
end $do$;

grant select on public.public_listings, public.marketplace_milk to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.public_listings, public.marketplace_milk from anon, authenticated;
