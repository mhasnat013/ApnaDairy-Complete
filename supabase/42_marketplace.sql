-- 42: the product catalog / marketplace (view only), and public views made read-only
-- run after 41_model1.sql (safe to run again).
--
-- anyone (the public website and logged-in businesses) can browse the milk centers' current milk listings and the
-- product sellers' dairy products. nothing can be ordered on the website; ordering happens in the mobile app.
-- milk shows only what was really tested: grade, ai model 1's class, freshness, spoilage risk, ph and temperature.

-- ---------- 1. public views are read-only ----------
-- supabase gives new views the same rights as tables. a simple view (like public_reviews) is updatable and runs as
-- its owner, past row level security, so a visitor could change or delete rows through it. views are for reading.
do $$
declare v record;
begin
  for v in select table_name from information_schema.views where table_schema = 'public' loop
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from anon, authenticated', v.table_name);
  end loop;
end $$;

-- ---------- 2. what the milk was tested at ----------
-- litre-weighted ph and temperature of the fresh milk a listing sells (the same batches as listing_model)
create or replace function public.listing_tests(p_center uuid, p_type milk_kind)
returns table (ph numeric, temperature_c numeric)
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.ph, m.temperature_c, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  s as (
    select b.*, least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l
    from b, stock
    where public.shelf_hours(b.freshness_hours) - extract(epoch from now() - b.t) / 3600 > 0
  )
  select round(sum(l * ph) filter (where ph is not null) / nullif(sum(l) filter (where ph is not null), 0), 2),
         round(sum(l * temperature_c) filter (where temperature_c is not null) / nullif(sum(l) filter (where temperature_c is not null), 0), 1)
  from s where l > 0.05;
$$;
revoke all on function public.listing_tests(uuid, milk_kind) from public;
grant execute on function public.listing_tests(uuid, milk_kind) to anon, authenticated;

-- ---------- 3. the catalog ----------
-- milk on sale now: every listing with litres available, with when it was listed and what it was tested at
create or replace view public.marketplace_milk as
 select l.id, l.shop_id, l.shop_name, l.city, l.rating, l.review_count, l.cover_path,
        l.name, l.milk_type, l.quality, l.description, l.list_price, l.discount_pct, l.price_per_l, l.available_l,
        l.freshness_score, l.model_quality, l.spoilage_pct, l.model_shelf_left_h, l.tested_at, l.expires_at,
        coalesce(p.listed_at, p.created_at) as listed_at,
        t.ph as test_ph, t.temperature_c as test_temperature_c
   from public_listings l
   join products p on p.id = l.id
   cross join lateral listing_tests(l.shop_id, l.milk_type) t
  where l.available_l > 0;

-- dairy products on sale now (desi ghee, butter, yogurt...) from product sellers
create or replace view public.marketplace_products as
 select id, shop_id, shop_name, city, rating, review_count, cover_path, name, category, milk_type, unit, description,
        list_price, discount_pct, price, available_qty, made_on, expires_on, created_at
   from public_products;

grant select on public.marketplace_milk, public.marketplace_products to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.marketplace_milk, public.marketplace_products from anon, authenticated;
