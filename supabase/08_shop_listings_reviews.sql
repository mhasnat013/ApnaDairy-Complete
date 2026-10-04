-- =========================================================
-- apnadairy · milk shop on the app: listings, shop profile, reviews
--
-- milk centers buy and sell milk only. each center has one listing per
-- milk type (cow, buffalo, mixed) that customers see in the mobile app
-- with the litres available, the price, the center's city and a live
-- freshness score worked out from the milk on its shelf.
-- customers review the shop (not a single listing, which sells out fast),
-- so the shop page shows a rating built up over time. centers build their
-- shop profile on the web: photos, a short description, hours and contact.
--
-- for the mobile app: read public_listings, public_shops, public_reviews;
-- call place_shop_order and add_review.
-- run in supabase sql editor (after 07_pricing_billing_models.sql)
-- =========================================================

-- ---------- listings: milk products of a milk center ----------
alter table public.products
  add column listed_l     numeric(8,2) check (listed_l is null or listed_l >= 0),   -- litres offered on the app, null = all stock
  add column min_order_l  numeric(6,2) not null default 1 check (min_order_l > 0),
  add column delivers     boolean not null default true,
  add column description  text;

create unique index products_one_listing_per_milk on public.products (area_manager_id, milk_type) where category = 'milk';

-- milk centers sell fresh milk only (byproduct sellers keep the other categories)
create or replace function public.check_center_product()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.category <> 'milk' and exists (select 1 from area_managers where id = new.area_manager_id and type = 'milk_center') then
    raise exception 'milk centers list fresh milk only';
  end if;
  return new;
end;
$$;
create trigger products_milk_centers_sell_milk
  before insert or update of category on public.products
  for each row execute function public.check_center_product();

-- ---------- live freshness of what is on the shelf ----------
-- first in, first out: what is left in stock is the newest milk. score = hours of shelf life left,
-- weighted by litres, out of 36 h (a typical shelf life for chilled raw milk). used by the app listings and the shop page on the web.
create or replace function public.listing_freshness(p_center uuid, p_type milk_kind)
returns table (freshness_score integer, hours_left numeric, oldest_hours numeric)
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '5 days'
  ),
  shelf as (
    select least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l,
           greatest(coalesce(b.freshness_hours, 24) - extract(epoch from now() - b.t) / 3600, 0) as h,
           extract(epoch from now() - b.t) / 3600 as age
    from b, stock
  )
  select coalesce(round(least(100, sum(l * h) / nullif(sum(l), 0) / 36 * 100))::int, 0),
         round(sum(l * h) / nullif(sum(l), 0), 1),
         round(max(age) filter (where l > 0), 1)
  from shelf where l > 0;
$$;

-- ---------- shop profile and photos ----------
create table public.shop_profiles (
  area_manager_id    uuid primary key default public.my_milk_center_id() references public.area_managers(id) on delete cascade,
  tagline            text check (length(tagline) <= 90),
  description        text check (length(description) <= 600),
  phone              text,
  whatsapp           text,
  opening_hours      text,
  delivery_radius_km numeric(4,1) check (delivery_radius_km is null or delivery_radius_km between 0 and 50),
  updated_at         timestamptz not null default now()
);

create table public.shop_photos (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null default public.my_milk_center_id() references public.area_managers(id) on delete cascade,
  path            text not null unique,      -- inside the shop-photos bucket: <area_manager_id>/<file>
  caption         text,
  sort            integer not null default 0,
  created_at      timestamptz not null default now()
);

alter table public.shop_profiles enable row level security;
alter table public.shop_photos   enable row level security;
create policy "shop profile: anyone reads" on public.shop_profiles for select using (true);
create policy "shop profile: center writes own" on public.shop_profiles for all
  using (area_manager_id = public.my_milk_center_id()) with check (area_manager_id = public.my_milk_center_id());
create policy "shop photos: anyone reads" on public.shop_photos for select using (true);
create policy "shop photos: center writes own" on public.shop_photos for all
  using (area_manager_id = public.my_milk_center_id()) with check (area_manager_id = public.my_milk_center_id());

-- public bucket: anyone can view shop photos, a center uploads into its own folder
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('shop-photos', 'shop-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "shop photos storage: anyone reads" on storage.objects
  for select using (bucket_id = 'shop-photos');
create policy "shop photos storage: center uploads own" on storage.objects
  for insert to authenticated with check (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = public.my_milk_center_id()::text);
create policy "shop photos storage: center deletes own" on storage.objects
  for delete to authenticated using (bucket_id = 'shop-photos' and (storage.foldername(name))[1] = public.my_milk_center_id()::text);

-- ---------- reviews of the shop ----------
create table public.shop_reviews (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  customer_id     uuid references public.profiles(id) on delete set null,
  order_id        uuid unique references public.shop_orders(id) on delete set null,   -- one review per delivered order
  reviewer_name   text not null,
  rating          integer not null check (rating between 1 and 5),
  comment         text check (length(comment) <= 500),
  reply           text check (length(reply) <= 500),
  replied_at      timestamptz,
  created_at      timestamptz not null default now(),
  is_sample       boolean not null default false
);
create index on public.shop_reviews (area_manager_id, created_at desc);

alter table public.shop_reviews enable row level security;
create policy "reviews: anyone reads" on public.shop_reviews for select using (true);
-- writes go through add_review / reply_review

-- a customer reviews the shop after an order from it was delivered
create or replace function public.add_review(p_order uuid, p_rating integer, p_comment text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  o    public.shop_orders;
  v_id uuid;
  v_name text;
begin
  select * into o from shop_orders where id = p_order;
  if o.id is null or o.customer_id is distinct from auth.uid() then raise exception 'you can only review your own orders'; end if;
  if o.status <> 'delivered' then raise exception 'you can review the shop once your order is delivered'; end if;
  if exists (select 1 from shop_reviews where order_id = p_order) then raise exception 'you already reviewed this order'; end if;
  if p_rating not between 1 and 5 then raise exception 'rating must be 1 to 5 stars'; end if;
  -- show first name and initial only, e.g. "Ayesha K."
  select split_part(full_name, ' ', 1) || coalesce(' ' || left(nullif(split_part(full_name, ' ', 2), ''), 1) || '.', '') into v_name
    from profiles where id = auth.uid();
  insert into shop_reviews (area_manager_id, customer_id, order_id, reviewer_name, rating, comment)
  values (o.area_manager_id, auth.uid(), p_order, coalesce(v_name, 'Customer'), p_rating, nullif(trim(p_comment), ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- the shop answers a review (once, editable)
create or replace function public.reply_review(p_review uuid, p_reply text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update shop_reviews set reply = nullif(trim(p_reply), ''), replied_at = now()
   where id = p_review and area_manager_id = public.my_milk_center_id();
  if not found then raise exception 'review not found'; end if;
end;
$$;

-- ---------- what the mobile app reads ----------
-- verified, active milk shops with their profile and rating
create or replace view public.public_shops as
select a.id, a.center_name, a.city, a.address, a.latitude, a.longitude,
       s.tagline, s.description, s.opening_hours, s.whatsapp, s.phone, s.delivery_radius_km,
       (select path from shop_photos ph where ph.area_manager_id = a.id order by sort, created_at limit 1) as cover_path,
       coalesce((select json_agg(path order by sort, created_at) from shop_photos ph where ph.area_manager_id = a.id), '[]'::json) as photos,
       (select round(avg(rating), 1) from shop_reviews r where r.area_manager_id = a.id) as rating,
       (select count(*) from shop_reviews r where r.area_manager_id = a.id)::int as review_count,
       a.verified_at as member_since
from public.area_managers a
join public.profiles p on p.id = a.user_id
left join public.shop_profiles s on s.area_manager_id = a.id
where a.type = 'milk_center' and a.verification_status = 'active' and p.status = 'active';

-- milk on sale: one row per shop and milk type, with live stock and freshness
create or replace view public.public_listings as
select pr.id, pr.area_manager_id as shop_id, sh.center_name as shop_name, sh.city, sh.rating, sh.review_count, sh.cover_path,
       pr.name, pr.milk_type, pr.description,
       pr.price as list_price, pr.discount_pct, round(pr.price * (100 - pr.discount_pct) / 100.0) as price_per_l,
       greatest(0, least(coalesce(pr.listed_l, st.left_l), st.left_l)) as available_l,
       pr.min_order_l, pr.delivers,
       f.freshness_score, f.hours_left, f.oldest_hours,
       pr.created_at
from public.products pr
join public.public_shops sh on sh.id = pr.area_manager_id
cross join lateral (select greatest(public.milk_in_stock(pr.area_manager_id, pr.milk_type), 0) as left_l) st
cross join lateral public.listing_freshness(pr.area_manager_id, pr.milk_type) f
where pr.category = 'milk' and pr.is_available;

-- reviews with the reviewer's short name only
create or replace view public.public_reviews as
select r.id, r.area_manager_id as shop_id, r.reviewer_name, r.rating, r.comment, r.reply, r.replied_at, r.created_at
from public.shop_reviews r;

grant select on public.public_shops, public.public_listings, public.public_reviews to anon, authenticated;

-- ---------- customer places an order in the app ----------
-- p_items: [{ "listing_id": uuid, "quantity": litres }, ...] all from one shop
create or replace function public.place_shop_order(p_items jsonb, p_address text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_item  jsonb;
  v_l     record;
  v_shop  uuid;
  v_order uuid;
  v_qty   numeric;
  v_total numeric := 0;
  v_name  text;
begin
  if auth.uid() is null then raise exception 'sign in to order'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'add at least one item'; end if;
  if coalesce(trim(p_address), '') = '' then raise exception 'enter a delivery address'; end if;
  select full_name into v_name from profiles where id = auth.uid();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    select * into v_l from public_listings where id = (v_item->>'listing_id')::uuid;
    if v_l.id is null then raise exception 'this milk is no longer on sale'; end if;
    if v_shop is null then
      v_shop := v_l.shop_id;
      insert into shop_orders (area_manager_id, customer_id, customer_name, customer_phone, channel, delivery_address, status)
      values (v_shop, auth.uid(), coalesce(v_name, 'Customer'), p_phone, 'app', trim(p_address), 'pending')
      returning id into v_order;
    elsif v_l.shop_id <> v_shop then
      raise exception 'order from one shop at a time';
    end if;
    if v_qty is null or v_qty < v_l.min_order_l then raise exception 'the minimum order is % L', rtrim(rtrim(v_l.min_order_l::text, '0'), '.'); end if;
    if v_qty > v_l.available_l then raise exception 'only % L of % milk is available', rtrim(rtrim(v_l.available_l::text, '0'), '.'), v_l.milk_type; end if;
    insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
    values (v_order, v_l.id, v_l.name, 'milk', v_l.milk_type, 'litre', v_qty, v_l.price_per_l);
    v_total := v_total + v_qty * v_l.price_per_l;
  end loop;

  update shop_orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

revoke execute on function public.place_shop_order(jsonb, text, text), public.add_review(uuid, integer, text), public.reply_review(uuid, text) from anon;

-- ---------- sample data: a milk-only shop with listings, a profile and reviews ----------
create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null then raise exception 'only a verified milk center can do this'; end if;
  delete from shop_reviews     where area_manager_id = v_center and is_sample;
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
  p_cow     uuid; p_buf uuid; p_mix uuid;
  comments5 text[] := array['Doodh bilkul khalis tha, malai bohat achi aayi.','Always fresh and on time. Best milk shop in our area.','Rider was polite, milk was still cold. Highly recommended.','Buffalo milk is thick and pure, my family loves it.','Test report on the app gives real peace of mind.','Ordered at 7 am, delivered by 7:40. Great service.'];
  comments4 text[] := array['Good quality milk, delivery was a little late.','Fresh milk, price is fair for the quality.','Achi quality hai, bas packing behtar ho sakti hai.','Good taste, will keep ordering.'];
  comments3 text[] := array['Milk was fine but came an hour late.','Okay quality, a bit thin today.'];
  comments2 text[] := array['Milk tasted slightly sour this time.'];
  v_rating  integer;
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

  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, is_sample)
    values (v_center, 'Fresh cow milk', 'milk', 'cow', 'litre', 205, null, 'Collected twice a day from farms near the city, tested on arrival.', true) returning id into p_cow;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, min_order_l, is_sample)
    values (v_center, 'Fresh buffalo milk', 'milk', 'buffalo', 'litre', 240, null, 'Thick, creamy buffalo milk. Great for chai and dahi.', 1, true) returning id into p_buf;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, min_order_l, is_sample)
    values (v_center, 'Fresh mixed milk', 'milk', 'mixed', 'litre', 210, null, 'Cow and buffalo milk, a lighter everyday choice.', 2, true) returning id into p_mix;

  -- a shop profile to start from (only if the center has not written its own)
  insert into shop_profiles (area_manager_id, tagline, description, phone, whatsapp, opening_hours, delivery_radius_km)
  values (v_center, 'Khalis doodh, tested every morning',
          'A family milk shop buying straight from farmers in nearby villages. Every can is tested with the ApnaDairy IoT tester before it reaches you.',
          '0321 4567890', '0321 4567890', 'Every day, 6:00 am to 10:00 pm', 5)
  on conflict (area_manager_id) do nothing;

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

    -- ---- sales: a milk shop sells nearly all of the day's milk, the rest is sold first tomorrow ----
    for v_idx in 1..3 loop
      v_type := case v_idx when 1 then 'cow' when 2 then 'buffalo' else 'mixed' end::milk_kind;
      target := (carry[v_idx] + bought[v_idx]) * (0.86 + random() * 0.1);
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
        values (v_order, case v_idx when 1 then p_cow when 2 then p_buf else p_mix end,
                case v_idx when 1 then 'Fresh cow milk' when 2 then 'Fresh buffalo milk' else 'Fresh mixed milk' end,
                'milk', v_type, 'litre', v_qty, case v_idx when 1 then 205 when 2 then 240 else 210 end);
        v_total := v_qty * case v_idx when 1 then 205 when 2 then 240 else 210 end;

        update shop_orders set total_amount = v_total where id = v_order;
        if v_ostatus <> 'cancelled' then sold := sold + v_qty; end if;
      end loop;

      carry[v_idx] := carry[v_idx] + bought[v_idx] - sold;
    end loop;

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

  -- customers review the shop after delivered app orders
  for v_order in select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app' and status = 'delivered'
                 order by random() limit 46 loop
    r := random();
    v_rating := case when r < 0.58 then 5 when r < 0.86 then 4 when r < 0.96 then 3 else 2 end;
    insert into shop_reviews (area_manager_id, order_id, reviewer_name, rating, comment, reply, replied_at, created_at, is_sample)
    select v_center, o.id,
           split_part(o.customer_name, ' ', 1) || ' ' || left(split_part(o.customer_name, ' ', 2), 1) || '.',
           v_rating,
           case v_rating when 5 then comments5[1 + floor(random() * 6)::int] when 4 then comments4[1 + floor(random() * 4)::int]
                         when 3 then comments3[1 + floor(random() * 2)::int] else comments2[1] end,
           case when v_rating <= 3 then 'Sorry about that. We have spoken to our rider and will do better.' end,
           case when v_rating <= 3 then o.delivered_at + interval '5 hours' end,
           o.delivered_at + interval '2 hours', true
    from shop_orders o where o.id = v_order;
  end loop;

  -- the newest app order of the day has just come in
  update shop_orders set status = 'pending', delivered_at = null
   where id = (select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app'
                 and status <> 'cancelled' and created_at > now() - interval '3 hours' order by created_at desc limit 1);
end;
$$;

revoke execute on function public.seed_sample_data(), public.clear_sample_data() from anon;
