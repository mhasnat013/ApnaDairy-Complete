-- =========================================================
-- apnadairy · area manager (milk center) portal
-- modules: area management (farmers), milk procurement, iot data
-- acquisition, ai engine (sample model), product catalog / inventory,
-- shop orders (b2c + walk-in sales)
--
-- iot and ai are not connected yet. readings come from a simulated
-- device and assess_milk() is a rule-based sample model with the same
-- inputs and outputs the real model will have. swap it later without
-- touching the tables or the portal.
--
-- run in supabase sql editor (after 05_open_bids.sql)
-- =========================================================

create type collection_status as enum ('offered', 'accepted', 'rejected');
create type milk_shift        as enum ('morning', 'evening');
create type payment_status    as enum ('unpaid', 'paid');
create type risk_level        as enum ('low', 'medium', 'high');
create type product_category  as enum ('milk', 'yogurt', 'butter', 'ghee', 'cream', 'lassi', 'other');
create type sale_channel      as enum ('app', 'walk_in');
create type shop_order_status as enum ('pending', 'preparing', 'out_for_delivery', 'delivered', 'cancelled');
create type usage_reason      as enum ('products', 'spoiled', 'own_use');

-- ---------- price settings: what the center pays farmers per litre ----------
create table public.center_settings (
  area_manager_id uuid primary key references public.area_managers(id) on delete cascade,
  cow_rate        numeric(8,2) not null default 170 check (cow_rate > 0),
  buffalo_rate    numeric(8,2) not null default 200 check (buffalo_rate > 0),
  mixed_rate      numeric(8,2) not null default 185 check (mixed_rate > 0),
  device_serial   text not null default 'AD-IOT-0001',
  updated_at      timestamptz not null default now()
);

-- ---------- farmers registered with a center ----------
create table public.farmers (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null default public.my_milk_center_id() references public.area_managers(id) on delete cascade,
  profile_id      uuid references public.profiles(id) on delete set null,   -- linked when the farmer joins the mobile app
  full_name       text not null check (length(trim(full_name)) > 1),
  phone           text,
  village         text,
  milk_type       milk_kind not null default 'mixed',
  cattle_count    integer not null default 1 check (cattle_count between 0 and 500),
  is_active       boolean not null default true,
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index on public.farmers (area_manager_id);

-- ---------- milk collections: one per farmer per drop-off ----------
-- each holds the iot test, the ai assessment, the offered price and the farmer's answer
create table public.milk_collections (
  id                uuid primary key default gen_random_uuid(),
  area_manager_id   uuid not null references public.area_managers(id) on delete cascade,
  farmer_id         uuid not null references public.farmers(id) on delete cascade,
  milk_type         milk_kind not null,
  shift             milk_shift not null,
  quantity_l        numeric(8,2) not null check (quantity_l > 0 and quantity_l <= 2000),
  collected_at      timestamptz not null default now(),
  -- iot reading
  temperature_c     numeric(4,1) not null check (temperature_c between -5 and 60),
  ph                numeric(4,2) not null check (ph between 4 and 9),
  density           numeric(6,4) not null check (density between 1.000 and 1.060),
  ec_ms             numeric(4,2) not null check (ec_ms between 0 and 15),       -- electrical conductivity, mS/cm
  test_source       text not null default 'simulated' check (test_source in ('device', 'simulated', 'manual')),
  device_serial     text,
  -- ai assessment (sample model for now)
  quality           quality_grade,
  freshness_hours   integer check (freshness_hours between 0 and 96),          -- shelf life once chilled
  adulteration_risk risk_level not null default 'low',
  ai_price_per_l    numeric(8,2),
  ai_notes          text[] not null default '{}',
  -- deal
  price_per_l       numeric(8,2) check (price_per_l is null or price_per_l > 0),
  total_amount      numeric(12,2) generated always as (quantity_l * coalesce(price_per_l, 0)) stored,
  status            collection_status not null default 'offered',
  decided_at        timestamptz,
  reject_reason     text,
  payment           payment_status not null default 'unpaid',
  paid_at           timestamptz,
  is_sample         boolean not null default false,
  constraint offered_needs_price check (status = 'rejected' or price_per_l is not null)
);
create index on public.milk_collections (area_manager_id, collected_at desc);
create index on public.milk_collections (farmer_id);

-- ---------- milk taken out of stock for something other than a sale ----------
create table public.milk_usage (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null default public.my_milk_center_id() references public.area_managers(id) on delete cascade,
  milk_type       milk_kind not null,
  litres          numeric(8,2) not null check (litres > 0),
  reason          usage_reason not null,
  note            text,
  created_at      timestamptz not null default now(),
  is_sample       boolean not null default false
);
create index on public.milk_usage (area_manager_id, created_at desc);

-- ---------- product catalog (what the shop sells) ----------
-- "milk" products sell from the raw milk stock, so they carry a milk_type and no stock_qty
create table public.products (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null default public.my_milk_center_id() references public.area_managers(id) on delete cascade,
  name            text not null check (length(trim(name)) > 1),
  category        product_category not null,
  milk_type       milk_kind,
  unit            text not null default 'kg' check (unit in ('litre', 'kg', 'bottle', 'pack')),
  price           numeric(10,2) not null check (price > 0),
  discount_pct    integer not null default 0 check (discount_pct between 0 and 90),
  stock_qty       numeric(10,2) check (stock_qty is null or stock_qty >= 0),
  made_on         date,
  expires_on      date,
  is_available    boolean not null default true,
  is_sample       boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint milk_products_use_milk_stock check (
    (category = 'milk' and milk_type is not null and unit = 'litre' and stock_qty is null)
    or (category <> 'milk' and stock_qty is not null)
  )
);
create index on public.products (area_manager_id);

-- ---------- shop orders: customer app orders and walk-in sales ----------
create table public.shop_orders (
  id               uuid primary key default gen_random_uuid(),
  area_manager_id  uuid not null references public.area_managers(id) on delete cascade,
  customer_id      uuid references public.profiles(id) on delete set null,
  customer_name    text not null,
  customer_phone   text,
  channel          sale_channel not null,
  delivery_address text,
  status           shop_order_status not null default 'pending',
  total_amount     numeric(12,2) not null default 0 check (total_amount >= 0),
  created_at       timestamptz not null default now(),
  delivered_at     timestamptz,
  is_sample        boolean not null default false
);
create index on public.shop_orders (area_manager_id, created_at desc);

create table public.shop_order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.shop_orders(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  name        text not null,
  category    product_category not null,
  milk_type   milk_kind,
  unit        text not null,
  quantity    numeric(10,2) not null check (quantity > 0),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  line_total  numeric(12,2) generated always as (quantity * unit_price) stored
);
create index on public.shop_order_items (order_id);

-- ---------- row level security ----------
alter table public.center_settings  enable row level security;
alter table public.farmers          enable row level security;
alter table public.milk_collections enable row level security;
alter table public.milk_usage       enable row level security;
alter table public.products         enable row level security;
alter table public.shop_orders      enable row level security;
alter table public.shop_order_items enable row level security;

create policy "settings: own center" on public.center_settings
  for all using (area_manager_id = public.my_milk_center_id() or public.is_admin())
  with check (area_manager_id = public.my_milk_center_id());

-- a center manages its own farmers; a farmer with the app sees their own record
create policy "farmers: read" on public.farmers
  for select using (area_manager_id = public.my_milk_center_id() or profile_id = auth.uid() or public.is_admin());
create policy "farmers: center adds" on public.farmers
  for insert with check (area_manager_id = public.my_milk_center_id());
create policy "farmers: center edits" on public.farmers
  for update using (area_manager_id = public.my_milk_center_id())
  with check (area_manager_id = public.my_milk_center_id());

-- collections are written only through record_collection / decide_collection / pay_farmer
create policy "collections: read" on public.milk_collections
  for select using (
    area_manager_id = public.my_milk_center_id()
    or public.is_admin()
    or exists (select 1 from public.farmers f where f.id = farmer_id and f.profile_id = auth.uid())
  );

create policy "usage: own center" on public.milk_usage
  for all using (area_manager_id = public.my_milk_center_id() or public.is_admin())
  with check (area_manager_id = public.my_milk_center_id());

-- products: the center manages them; any signed-in user can browse available products of verified centers
create policy "products: center manages" on public.products
  for all using (area_manager_id = public.my_milk_center_id())
  with check (area_manager_id = public.my_milk_center_id());
create policy "products: browse" on public.products
  for select to authenticated using (
    is_available and exists (select 1 from public.area_managers a where a.id = area_manager_id and a.verification_status = 'active')
    or public.is_admin()
  );

-- orders are written through record_sale / update_shop_order (the customer app gets its own rpc later)
create policy "shop orders: read" on public.shop_orders
  for select using (area_manager_id = public.my_milk_center_id() or customer_id = auth.uid() or public.is_admin());
create policy "shop order items: read" on public.shop_order_items
  for select using (exists (select 1 from public.shop_orders o where o.id = order_id
    and (o.area_manager_id = public.my_milk_center_id() or o.customer_id = auth.uid() or public.is_admin())));

-- ---------- milk stock per type: bought − sold − bulk − used ----------
create view public.milk_stock with (security_invoker = true) as
with types as (select unnest(enum_range(null::milk_kind)) as milk_type),
centers as (select public.my_milk_center_id() as area_manager_id)
select c.area_manager_id, t.milk_type,
  coalesce((select sum(quantity_l) from public.milk_collections m
            where m.area_manager_id = c.area_manager_id and m.milk_type = t.milk_type and m.status = 'accepted'), 0) as bought_l,
  coalesce((select sum(i.quantity) from public.shop_order_items i join public.shop_orders o on o.id = i.order_id
            where o.area_manager_id = c.area_manager_id and i.category = 'milk' and i.milk_type = t.milk_type and o.status <> 'cancelled'), 0) as sold_l,
  coalesce((select sum(b.quantity_l) from public.bulk_orders b join public.bulk_requirements r on r.id = b.requirement_id
            where b.area_manager_id = c.area_manager_id and r.milk_type = t.milk_type and b.status in ('dispatched', 'delivered')), 0) as bulk_l,
  coalesce((select sum(litres) from public.milk_usage u
            where u.area_manager_id = c.area_manager_id and u.milk_type = t.milk_type), 0) as used_l
from centers c cross join types t
where c.area_manager_id is not null;

create or replace function public.milk_in_stock(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select sum(quantity_l) from milk_collections where area_manager_id = p_center and milk_type = p_type and status = 'accepted'), 0)
  - coalesce((select sum(i.quantity) from shop_order_items i join shop_orders o on o.id = i.order_id
              where o.area_manager_id = p_center and i.category = 'milk' and i.milk_type = p_type and o.status <> 'cancelled'), 0)
  - coalesce((select sum(b.quantity_l) from bulk_orders b join bulk_requirements r on r.id = b.requirement_id
              where b.area_manager_id = p_center and r.milk_type = p_type and b.status in ('dispatched', 'delivered')), 0)
  - coalesce((select sum(litres) from milk_usage where area_manager_id = p_center and milk_type = p_type), 0);
$$;

-- ---------- summaries for the dashboard (computed in the database, days in pakistan time) ----------
create view public.center_daily with (security_invoker = true) as
with c as (select public.my_milk_center_id() as id),
days as (
  select generate_series((now() at time zone 'Asia/Karachi')::date - 29, (now() at time zone 'Asia/Karachi')::date, interval '1 day')::date as day
),
col as (
  select (m.collected_at at time zone 'Asia/Karachi')::date as day,
    sum(m.quantity_l)   filter (where m.status = 'accepted') as bought_l,
    sum(m.total_amount) filter (where m.status = 'accepted') as milk_cost,
    count(distinct m.farmer_id) filter (where m.status = 'accepted') as farmers,
    count(*) filter (where m.quality = 'premium'  and m.status <> 'rejected') as premium,
    count(*) filter (where m.quality = 'fresh'    and m.status <> 'rejected') as fresh,
    count(*) filter (where m.quality = 'standard' and m.status <> 'rejected') as standard,
    count(*) filter (where m.status = 'rejected' and m.reject_reason = 'Failed the quality test') as failed,
    count(*) filter (where m.status = 'offered') as awaiting
  from public.milk_collections m, c
  where m.area_manager_id = c.id and m.collected_at >= now() - interval '31 days'
  group by 1
),
shop as (
  select (o.created_at at time zone 'Asia/Karachi')::date as day, sum(o.total_amount) as shop_sales, count(*) as orders
  from public.shop_orders o, c
  where o.area_manager_id = c.id and o.status <> 'cancelled' and o.created_at >= now() - interval '31 days'
  group by 1
),
milk_out as (
  select (o.created_at at time zone 'Asia/Karachi')::date as day, sum(i.quantity) as sold_l
  from public.shop_order_items i join public.shop_orders o on o.id = i.order_id, c
  where o.area_manager_id = c.id and o.status <> 'cancelled' and i.category = 'milk' and o.created_at >= now() - interval '31 days'
  group by 1
),
bulk as (
  select (coalesce(b.dispatched_at, b.created_at) at time zone 'Asia/Karachi')::date as day,
    sum(b.total_amount) as bulk_sales, sum(b.quantity_l) as bulk_l
  from public.bulk_orders b, c
  where b.area_manager_id = c.id and b.status in ('dispatched', 'delivered')
  group by 1
)
select d.day,
  coalesce(shop.shop_sales, 0) + coalesce(bulk.bulk_sales, 0) as sales,
  coalesce(shop.shop_sales, 0) as shop_sales,
  coalesce(bulk.bulk_sales, 0) as bulk_sales,
  coalesce(shop.orders, 0) as orders,
  coalesce(col.milk_cost, 0) as milk_cost,
  coalesce(col.bought_l, 0) as bought_l,
  coalesce(milk_out.sold_l, 0) + coalesce(bulk.bulk_l, 0) as sold_l,
  coalesce(col.farmers, 0) as farmers,
  coalesce(col.premium, 0) as premium, coalesce(col.fresh, 0) as fresh, coalesce(col.standard, 0) as standard,
  coalesce(col.failed, 0) as failed, coalesce(col.awaiting, 0) as awaiting
from days d
left join col using (day) left join shop using (day) left join milk_out using (day) left join bulk using (day)
where (select id from c) is not null
order by d.day;

-- per farmer: last 30 days and what the center owes them
create view public.farmer_stats with (security_invoker = true) as
select f.id as farmer_id,
  coalesce(sum(m.quantity_l)   filter (where m.status = 'accepted' and m.collected_at >= now() - interval '30 days'), 0) as litres_30d,
  coalesce(sum(m.total_amount) filter (where m.status = 'accepted' and m.collected_at >= now() - interval '30 days'), 0) as earned_30d,
  coalesce(sum(m.total_amount) filter (where m.status = 'accepted' and m.payment = 'unpaid'), 0) as unpaid_amount,
  count(m.id) filter (where m.collected_at >= now() - interval '30 days') as tests_30d,
  count(m.id) filter (where m.quality = 'premium' and m.collected_at >= now() - interval '30 days') as premium_30d,
  count(m.id) filter (where m.reject_reason = 'Failed the quality test' and m.collected_at >= now() - interval '30 days') as failed_30d,
  max(m.collected_at) as last_collected_at
from public.farmers f
left join public.milk_collections m on m.farmer_id = f.id
group by f.id;

-- what sold in the last 30 days, per product
create view public.product_sales_30d with (security_invoker = true) as
select i.product_id, i.name, i.category, i.unit, sum(i.quantity) as qty, sum(i.line_total) as revenue
from public.shop_order_items i
join public.shop_orders o on o.id = i.order_id
where o.status <> 'cancelled' and o.created_at >= now() - interval '30 days'
  and o.area_manager_id = public.my_milk_center_id()
group by 1, 2, 3, 4;

-- ---------- ai engine (sample model) ----------
-- inputs: the four iot parameters + milk type. output: grade, shelf life, adulteration risk,
-- recommended price and plain-language reasons. normal ranges used:
--   ph 6.6 to 6.8 (below 6.4 = souring) · density 1.028 to 1.034 g/ml (low = water added)
--   ec 4.0 to 5.5 mS/cm (high = salt or udder infection) · warm milk shortens shelf life
create or replace function public.assess_milk(
  p_milk_type milk_kind, p_temperature numeric, p_ph numeric, p_density numeric, p_ec numeric
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_rate    numeric;
  v_risk    risk_level := 'low';
  v_score   integer := 100;
  v_notes   text[] := '{}';
  v_accept  boolean := true;
  v_quality quality_grade;
  v_fresh   integer;
  v_price   numeric;
  v_center  uuid := public.my_milk_center_id();
begin
  select case p_milk_type when 'cow' then cow_rate when 'buffalo' then buffalo_rate else mixed_rate end
    into v_rate from center_settings where area_manager_id = v_center;
  v_rate := coalesce(v_rate, case p_milk_type when 'cow' then 170 when 'buffalo' then 200 else 185 end);

  -- density: water lowers it, starch or powder raises it
  if p_density < 1.026 then
    v_risk := 'high'; v_score := v_score - 45; v_notes := array_append(v_notes, 'Density is low, water may have been added'::text);
  elsif p_density < 1.028 then
    v_risk := 'medium'; v_score := v_score - 15; v_notes := array_append(v_notes, 'Density is a little low'::text);
  elsif p_density > 1.036 then
    v_risk := 'medium'; v_score := v_score - 15; v_notes := array_append(v_notes, 'Density is high, solids may have been added'::text);
  end if;

  -- conductivity: salt or mastitis raises it
  if p_ec > 6.5 then
    v_risk := 'high'; v_score := v_score - 40; v_notes := array_append(v_notes, 'Conductivity is high, possible salt or udder infection'::text);
  elsif p_ec > 5.5 then
    if v_risk = 'low' then v_risk := 'medium'; end if;
    v_score := v_score - 12; v_notes := array_append(v_notes, 'Conductivity is above normal'::text);
  end if;

  -- acidity
  if p_ph < 6.4 then
    v_accept := false; v_score := v_score - 50; v_notes := array_append(v_notes, 'pH is low, the milk is turning sour'::text);
  elsif p_ph < 6.55 then
    v_score := v_score - 15; v_notes := array_append(v_notes, 'pH is slightly low, sell this milk first'::text);
  elsif p_ph > 6.9 then
    if v_risk = 'low' then v_risk := 'medium'; end if;
    v_score := v_score - 15; v_notes := array_append(v_notes, 'pH is high, possible soda or udder infection'::text);
  end if;

  -- small drifts from the ideal also count, so grades spread naturally
  v_score := v_score - round(abs(p_ph - 6.70) * 110)::int;
  v_score := v_score - round(greatest(0, (case p_milk_type when 'buffalo' then 1.030 else 1.029 end) - p_density) * 6000)::int;
  v_score := v_score - round(greatest(0, p_ec - 4.9) * 8)::int;
  if p_temperature > 36 then v_score := v_score - 2; end if;

  if p_temperature > 38 then
    v_score := v_score - 5; v_notes := array_append(v_notes, 'Milk is warm, chill it soon'::text);
  end if;

  if v_risk = 'high' then v_accept := false; end if;

  v_quality := case when v_score >= 92 then 'premium' when v_score >= 78 then 'fresh' else 'standard' end;

  -- shelf life once chilled: 48 h for good milk, less when acidic or held warm
  v_fresh := round(48
    * least(1, greatest(0.15, (p_ph - 6.35) / 0.3))
    * case when p_temperature <= 10 then 1 when p_temperature <= 30 then 0.9 when p_temperature <= 37 then 0.8 else 0.65 end);
  v_fresh := greatest(v_fresh, 2);

  if v_accept then
    v_price := round(v_rate
      * case v_quality when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end
      * case v_risk when 'medium' then 0.95 else 1 end);
  end if;

  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_quality, 'freshness_hours', v_fresh,
    'adulteration_risk', v_risk, 'price_per_l', v_price, 'score', greatest(v_score, 0),
    'base_rate', v_rate, 'notes', to_jsonb(v_notes), 'model', 'sample-rules-v1'
  );
end;
$$;

-- ---------- record a collection: test → assess → offer ----------
-- p_price null = take the ai price. milk the model rejects is recorded as rejected.
create or replace function public.record_collection(
  p_farmer uuid, p_quantity numeric, p_shift milk_shift,
  p_temperature numeric, p_ph numeric, p_density numeric, p_ec numeric,
  p_source text default 'simulated', p_price numeric default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_farmer public.farmers;
  v_ai     jsonb;
  v_id     uuid;
  v_ok     boolean;
begin
  if v_center is null then raise exception 'only a verified milk center can record milk'; end if;
  select * into v_farmer from farmers where id = p_farmer and area_manager_id = v_center;
  if v_farmer.id is null then raise exception 'this farmer is not registered with your center'; end if;
  if not v_farmer.is_active then raise exception 'this farmer is marked inactive'; end if;
  if p_price is not null and p_price <= 0 then raise exception 'price must be more than zero'; end if;

  v_ai := public.assess_milk(v_farmer.milk_type, p_temperature, p_ph, p_density, p_ec);
  v_ok := (v_ai->>'accept')::boolean;

  insert into milk_collections (
    area_manager_id, farmer_id, milk_type, shift, quantity_l,
    temperature_c, ph, density, ec_ms, test_source, device_serial,
    quality, freshness_hours, adulteration_risk, ai_price_per_l, ai_notes,
    price_per_l, status, decided_at, reject_reason
  ) values (
    v_center, p_farmer, v_farmer.milk_type, p_shift, p_quantity,
    p_temperature, p_ph, p_density, p_ec, p_source,
    (select device_serial from center_settings where area_manager_id = v_center),
    case when v_ok then (v_ai->>'quality')::quality_grade end,
    (v_ai->>'freshness_hours')::integer, (v_ai->>'adulteration_risk')::risk_level,
    (v_ai->>'price_per_l')::numeric,
    array(select jsonb_array_elements_text(v_ai->'notes')),
    case when v_ok then coalesce(p_price, (v_ai->>'price_per_l')::numeric) end,
    case when v_ok then 'offered'::collection_status else 'rejected'::collection_status end,
    case when v_ok then null else now() end,
    case when v_ok then null else 'Failed the quality test' end
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------- farmer accepts or refuses the offer ----------
-- the farmer answers in the mobile app; at the counter the center can record the answer for them
create or replace function public.decide_collection(p_id uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.milk_collections;
  v_allowed boolean;
begin
  select * into v from milk_collections where id = p_id for update;
  if v.id is null then raise exception 'collection not found'; end if;
  v_allowed := v.area_manager_id = public.my_milk_center_id()
    or exists (select 1 from farmers f where f.id = v.farmer_id and f.profile_id = auth.uid());
  if not v_allowed then raise exception 'not allowed'; end if;
  if v.status <> 'offered' then raise exception 'this offer has already been answered'; end if;

  update milk_collections
     set status = case when p_accept then 'accepted'::collection_status else 'rejected'::collection_status end,
         decided_at = now(),
         reject_reason = case when p_accept then null else coalesce(nullif(trim(p_reason), ''), 'Farmer refused the price') end
   where id = p_id;
end;
$$;

-- ---------- pay a farmer for all accepted, unpaid milk ----------
create or replace function public.pay_farmer(p_farmer uuid)
returns numeric
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_total  numeric;
begin
  if not exists (select 1 from farmers where id = p_farmer and area_manager_id = v_center) then
    raise exception 'this farmer is not registered with your center';
  end if;
  select coalesce(sum(total_amount), 0) into v_total from milk_collections
   where farmer_id = p_farmer and area_manager_id = v_center and status = 'accepted' and payment = 'unpaid';
  update milk_collections set payment = 'paid', paid_at = now()
   where farmer_id = p_farmer and area_manager_id = v_center and status = 'accepted' and payment = 'unpaid';
  return v_total;
end;
$$;

-- ---------- walk-in sale at the counter ----------
-- p_items: [{ "product_id": uuid, "quantity": number }, ...]
create or replace function public.record_sale(p_items jsonb, p_customer_name text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_order  uuid;
  v_item   jsonb;
  v_prod   public.products;
  v_qty    numeric;
  v_price  numeric;
  v_total  numeric := 0;
begin
  if v_center is null then raise exception 'only a verified milk center can record sales'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'add at least one item'; end if;

  insert into shop_orders (area_manager_id, customer_name, channel, status, delivered_at)
  values (v_center, coalesce(nullif(trim(p_customer_name), ''), 'Walk-in customer'), 'walk_in', 'delivered', now())
  returning id into v_order;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    if v_qty is null or v_qty <= 0 then raise exception 'quantity must be more than zero'; end if;
    select * into v_prod from products where id = (v_item->>'product_id')::uuid and area_manager_id = v_center for update;
    if v_prod.id is null then raise exception 'product not found'; end if;

    if v_prod.category = 'milk' then
      if public.milk_in_stock(v_center, v_prod.milk_type) < v_qty then
        raise exception 'not enough % milk in stock', v_prod.milk_type;
      end if;
    else
      if v_prod.stock_qty < v_qty then raise exception 'only % % of % left', v_prod.stock_qty, v_prod.unit, v_prod.name; end if;
      update products set stock_qty = stock_qty - v_qty where id = v_prod.id;
    end if;

    v_price := round(v_prod.price * (100 - v_prod.discount_pct) / 100.0, 2);
    insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
    values (v_order, v_prod.id, v_prod.name, v_prod.category, v_prod.milk_type, v_prod.unit, v_qty, v_price);
    v_total := v_total + v_qty * v_price;
  end loop;

  update shop_orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

-- ---------- move a shop order along ----------
-- pending → preparing → out_for_delivery → delivered ; cancel while pending or preparing
create or replace function public.update_shop_order(p_id uuid, p_status shop_order_status)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.shop_orders;
begin
  select * into v from shop_orders where id = p_id for update;
  if v.id is null or v.area_manager_id is distinct from public.my_milk_center_id() then raise exception 'order not found'; end if;

  if (v.status, p_status) in (('pending', 'preparing'), ('preparing', 'out_for_delivery'), ('out_for_delivery', 'delivered')) then
    update shop_orders set status = p_status,
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end
    where id = p_id;
  elsif p_status = 'cancelled' and v.status in ('pending', 'preparing') then
    update shop_orders set status = 'cancelled' where id = p_id;
    -- put packed products back on the shelf
    update products p set stock_qty = p.stock_qty + i.quantity
      from shop_order_items i where i.order_id = p_id and i.product_id = p.id and p.category <> 'milk';
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
end;
$$;

-- ---------- sample data for demos ----------
-- fills the caller's own center with 30 days of realistic activity. safe to run again:
-- it clears earlier sample rows first and never touches real rows.
create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null then raise exception 'only a verified milk center can do this'; end if;
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
  v_qty     numeric; v_temp numeric; v_ph numeric; v_den numeric; v_ec numeric; r numeric;
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
    values (v_center, 'Fresh cow milk', 'milk', 'cow', 'litre', 220, null, null, null, true) returning id into p_cow;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, made_on, expires_on, is_sample)
    values (v_center, 'Fresh buffalo milk', 'milk', 'buffalo', 'litre', 260, null, null, null, true) returning id into p_buf;
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
        v_den  := round((case types[i] when 'buffalo' then 1.0305 when 'cow' then 1.0295 else 1.030 end + (random() - 0.5) * 0.003)::numeric, 4);
        v_ec   := round((case types[i] when 'buffalo' then 4.3 else 4.7 end + (random() - 0.5) * 0.8)::numeric, 2);
        r := random();
        if r < 0.035 then v_den := round((1.0235 + random() * 0.0025)::numeric, 4);      -- water added
        elsif r < 0.055 then v_ph := round((6.30 + random() * 0.12)::numeric, 2);        -- souring
        elsif r < 0.07 then v_ec := round((6.7 + random() * 0.6)::numeric, 2);           -- salt / infection
        elsif r < 0.12 then v_ph := round((6.47 + random() * 0.07)::numeric, 2);         -- slightly acidic
        end if;

        v_ai := public.assess_milk(types[i], v_temp, v_ph, v_den, v_ec);
        v_ok := (v_ai->>'accept')::boolean;
        v_reason := null;
        if not v_ok then v_status := 'rejected'; v_reason := 'Failed the quality test';
        elsif v_ts > now() - interval '50 minutes' then v_status := 'offered';
        elsif random() < 0.03 then v_status := 'rejected'; v_reason := 'Farmer refused the price';
        else v_status := 'accepted';
        end if;

        insert into milk_collections (
          area_manager_id, farmer_id, milk_type, shift, quantity_l, collected_at,
          temperature_c, ph, density, ec_ms, test_source, device_serial,
          quality, freshness_hours, adulteration_risk, ai_price_per_l, ai_notes,
          price_per_l, status, decided_at, reject_reason, payment, paid_at, is_sample
        ) values (
          v_center, v_farmers[i], types[i], s, v_qty, v_ts,
          v_temp, v_ph, v_den, v_ec, 'simulated', 'AD-IOT-0001',
          case when v_ok then (v_ai->>'quality')::quality_grade end,
          (v_ai->>'freshness_hours')::int, (v_ai->>'adulteration_risk')::risk_level,
          (v_ai->>'price_per_l')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
          -- now and then the manager offers a little more or less than the ai price
          case when v_ok then (v_ai->>'price_per_l')::numeric + case when random() < 0.12 then round(random() * 8) - 4 else 0 end end,
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
                'milk', v_type, 'litre', v_qty, case v_idx when 1 then 220 else 260 end);
        v_total := v_qty * case v_idx when 1 then 220 else 260 end;

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

  -- the newest app order of the day has just come in
  update shop_orders set status = 'pending', delivered_at = null
   where id = (select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app'
                 and status <> 'cancelled' and created_at > now() - interval '3 hours' order by created_at desc limit 1);
end;
$$;

-- functions are called through the api by signed-in users only
revoke execute on function public.seed_sample_data(), public.clear_sample_data() from anon;
revoke execute on function public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric) from anon;
revoke execute on function public.record_sale(jsonb, text) from anon;
