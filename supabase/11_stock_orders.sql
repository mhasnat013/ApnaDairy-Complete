-- 11: stock and orders you can trust
-- run after 10_farmer_protection.sql, once.
--
-- 1. sellable stock: milk past its shelf life (from the ai test) can no longer be sold, first in first out
-- 2. no overselling: orders, counter sales, dispatches and stock removals for one milk type wait for each other
-- 3. app listings sell all fresh stock; every order takes its litres out straight away
-- 4. bulk: a bid is capped at 2 days of the center's milk, and dispatch needs the milk in stock
-- 5. delivery codes: an app or bulk order is marked delivered only with the buyer's code (or by the buyer)
-- 6. one meaning of "sold": money counts when an order is delivered; stock is held when it is placed

-- ---------- 1. what is on the shelf, first in first out ----------
-- leftover stock is the newest milk. a batch is expired once its shelf life from the test has run out.
-- batches older than 10 days are always past shelf life, so anything left from them counts as expired.
create or replace function public.milk_shelf(p_center uuid, p_type milk_kind)
returns table (in_stock numeric, expired_l numeric, sellable_l numeric, fresh_hours numeric, oldest_hours numeric)
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  shelf as (
    select least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l,
           greatest(coalesce(b.freshness_hours, 24) - extract(epoch from now() - b.t) / 3600, 0) as h,
           extract(epoch from now() - b.t) / 3600 as age
    from b, stock
  ),
  agg as (
    select coalesce(sum(l) filter (where h > 0), 0) as fresh_l,
           round(sum(l * h) filter (where h > 0) / nullif(sum(l) filter (where h > 0), 0), 1) as fresh_h,
           round(max(age) filter (where l > 0 and h > 0), 1) as oldest
    from shelf
  )
  select stock.left_l, stock.left_l - least(agg.fresh_l, stock.left_l), least(agg.fresh_l, stock.left_l), agg.fresh_h, agg.oldest
  from stock, agg;
$$;

create or replace function public.milk_sellable(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$ select sellable_l from public.milk_shelf(p_center, p_type); $$;

-- the listings now score only milk that can still be sold
create or replace function public.listing_freshness(p_center uuid, p_type milk_kind)
returns table (freshness_score integer, hours_left numeric, oldest_hours numeric)
language sql stable security definer set search_path = public
as $$
  select case when s.sellable_l > 0 then round(least(100, coalesce(s.fresh_hours, 0) / 36 * 100))::int else 0 end,
         s.fresh_hours, s.oldest_hours
  from public.milk_shelf(p_center, p_type) s;
$$;

-- for the inventory page: every milk type of my center
create or replace function public.my_milk_shelf()
returns table (milk_type milk_kind, in_stock numeric, expired_l numeric, sellable_l numeric, fresh_hours numeric, oldest_hours numeric)
language sql stable security definer set search_path = public
as $$
  select t.milk_type, s.in_stock, s.expired_l, s.sellable_l, s.fresh_hours, s.oldest_hours
  from unnest(enum_range(null::milk_kind)) as t(milk_type)
  cross join lateral public.milk_shelf(public.my_milk_center_id(), t.milk_type) s
  where public.my_milk_center_id() is not null;
$$;

-- ---------- 2. one milk type of one center changes stock at a time ----------
create or replace function public.lock_milk(p_center uuid, p_type milk_kind)
returns void
language sql volatile security definer set search_path = public
as $$ select pg_advisory_xact_lock(hashtextextended(p_center::text || ':' || p_type::text, 11)); $$;

create or replace function public.check_usage_stock()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  perform public.lock_milk(new.area_manager_id, new.milk_type);
  if not new.is_sample and public.milk_in_stock(new.area_manager_id, new.milk_type) < new.litres then
    raise exception 'only % L of % milk is in stock', rtrim(rtrim(round(greatest(public.milk_in_stock(new.area_manager_id, new.milk_type), 0), 1)::text, '0'), '.'), new.milk_type;
  end if;
  return new;
end;
$$;

-- ---------- 3. app listings: all fresh stock, no fixed limit ----------
update public.products set listed_l = null where category = 'milk' and listed_l is not null;

create or replace view public.public_listings as
select pr.id, pr.area_manager_id as shop_id, sh.center_name as shop_name, sh.city, sh.rating, sh.review_count, sh.cover_path,
       pr.name, pr.milk_type, pr.description,
       pr.price as list_price, pr.discount_pct, round(pr.price * (100 - pr.discount_pct) / 100.0) as price_per_l,
       greatest(0, round(floor(st.sellable_l * 2) / 2, 1)) as available_l,
       pr.min_order_l, pr.delivers,
       f.freshness_score, f.hours_left, f.oldest_hours,
       pr.created_at
from public.products pr
join public.public_shops sh on sh.id = pr.area_manager_id
cross join lateral (select public.milk_sellable(pr.area_manager_id, pr.milk_type) as sellable_l) st
cross join lateral public.listing_freshness(pr.area_manager_id, pr.milk_type) f
where pr.category = 'milk' and pr.is_available;

-- ---------- 5. delivery codes (only the buyer can read them) ----------
create table if not exists public.delivery_codes (
  order_kind text not null check (order_kind in ('shop', 'bulk')),
  order_id   uuid not null,
  code       text not null check (code ~ '^[0-9]{4}$'),
  attempts   integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (order_kind, order_id)
);
alter table public.delivery_codes enable row level security;
drop policy if exists "codes: buyer reads" on public.delivery_codes;
create policy "codes: buyer reads" on public.delivery_codes for select using (
  (order_kind = 'shop' and exists (select 1 from public.shop_orders o where o.id = order_id and o.customer_id = auth.uid()))
  or (order_kind = 'bulk' and exists (select 1 from public.bulk_orders b where b.id = order_id and b.business_id = public.my_business_id()))
);

create or replace function public.new_delivery_code()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_table_name = 'shop_orders' then
    if new.channel <> 'app' then return new; end if;   -- counter sales need no code
  end if;
  insert into delivery_codes (order_kind, order_id, code)
  values (case when tg_table_name = 'shop_orders' then 'shop' else 'bulk' end, new.id, lpad(floor(random() * 10000)::int::text, 4, '0'))
  on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists shop_order_code on public.shop_orders;
create trigger shop_order_code after insert on public.shop_orders for each row execute function public.new_delivery_code();
drop trigger if exists bulk_order_code on public.bulk_orders;
create trigger bulk_order_code after insert on public.bulk_orders for each row execute function public.new_delivery_code();

-- codes for orders that are still on the way
insert into public.delivery_codes (order_kind, order_id, code)
select 'shop', id, lpad(floor(random() * 10000)::int::text, 4, '0') from public.shop_orders
 where channel = 'app' and status in ('pending', 'preparing', 'out_for_delivery')
on conflict do nothing;
insert into public.delivery_codes (order_kind, order_id, code)
select 'bulk', id, lpad(floor(random() * 10000)::int::text, 4, '0') from public.bulk_orders
 where status in ('confirmed', 'dispatched')
on conflict do nothing;

-- checks a code; 5 wrong tries lock it, then only the buyer can confirm.
-- a wrong code returns a message instead of raising, so the failed try is saved
drop function if exists public.check_delivery_code(text, uuid, text);
create or replace function public.check_delivery_code(p_kind text, p_order uuid, p_code text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.delivery_codes;
begin
  select * into v from delivery_codes where order_kind = p_kind and order_id = p_order for update;
  if v.order_id is null then return null; end if;   -- old orders made before codes existed
  if v.attempts >= 5 then raise exception 'too many wrong codes. ask the customer to confirm delivery in their app'; end if;
  if coalesce(trim(p_code), '') = v.code then return null; end if;
  update delivery_codes set attempts = attempts + 1 where order_kind = p_kind and order_id = p_order;
  if v.attempts + 1 >= 5 then
    return 'Wrong delivery code. That was the last try, now the customer has to confirm delivery in their app.';
  end if;
  return format('Wrong delivery code. Ask the customer for the 4-digit code in their app (%s %s left).', 4 - v.attempts, case when 4 - v.attempts = 1 then 'try' else 'tries' end);
end;
$$;

-- demo accounts only: shows the code, standing in for the customer reading it out
create or replace function public.demo_delivery_code(p_kind text, p_order uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id(); v_code text;
begin
  if not exists (select 1 from area_managers where id = v_center and is_demo) then
    raise exception 'only demo accounts can see the customer''s code';
  end if;
  select c.code into v_code from delivery_codes c
   where c.order_kind = p_kind and c.order_id = p_order
     and ((p_kind = 'shop' and exists (select 1 from shop_orders o where o.id = p_order and o.area_manager_id = v_center))
       or (p_kind = 'bulk' and exists (select 1 from bulk_orders b where b.id = p_order and b.area_manager_id = v_center)));
  return v_code;
end;
$$;

-- ---------- shop orders: delivery needs the code; cancelling frees the stock ----------
-- returns null when done, or a message when the delivery code was wrong
drop function if exists public.update_shop_order(uuid, shop_order_status);
drop function if exists public.update_shop_order(uuid, shop_order_status, text);
create or replace function public.update_shop_order(p_id uuid, p_status shop_order_status, p_code text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.shop_orders; v_msg text;
begin
  select * into v from shop_orders where id = p_id for update;
  if v.id is null or v.area_manager_id is distinct from public.my_milk_center_id() then raise exception 'order not found'; end if;

  if (v.status, p_status) in (('pending', 'preparing'), ('preparing', 'out_for_delivery')) then
    update shop_orders set status = p_status where id = p_id;
  elsif v.status = 'out_for_delivery' and p_status = 'delivered' then
    if v.channel = 'app' then
      v_msg := public.check_delivery_code('shop', p_id, p_code);
      if v_msg is not null then return v_msg; end if;
    end if;
    update shop_orders set status = 'delivered', delivered_at = now() where id = p_id;
  elsif p_status = 'cancelled' and v.status in ('pending', 'preparing') then
    update shop_orders set status = 'cancelled' where id = p_id;
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- the customer confirms from the app that the milk arrived
create or replace function public.confirm_order_received(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update shop_orders set status = 'delivered', delivered_at = now()
   where id = p_id and customer_id = auth.uid() and status = 'out_for_delivery';
  if not found then raise exception 'this order is not out for delivery'; end if;
end;
$$;

-- ---------- app order: locked stock check, fresh milk only ----------
create or replace function public.place_shop_order(p_items jsonb, p_address text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_item  jsonb;
  v_l     record;
  v_p     public.products;
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
    select * into v_p from products where id = (v_item->>'listing_id')::uuid and category = 'milk';
    if v_p.id is null then raise exception 'this milk is no longer on sale'; end if;
    perform public.lock_milk(v_p.area_manager_id, v_p.milk_type);      -- wait for any other order of this milk
    select * into v_l from public_listings where id = v_p.id;
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
    if v_qty > v_l.available_l then raise exception 'only % L of fresh % milk is left', rtrim(rtrim(v_l.available_l::text, '0'), '.'), v_l.milk_type; end if;
    insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
    values (v_order, v_l.id, v_l.name, 'milk', v_l.milk_type, 'litre', v_qty, v_l.price_per_l);
    v_total := v_total + v_qty * v_l.price_per_l;
  end loop;

  update shop_orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

-- ---------- counter sale: milk only, fresh stock, locked ----------
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
  v_left   numeric;
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
    select * into v_prod from products where id = (v_item->>'product_id')::uuid and area_manager_id = v_center;
    if v_prod.id is null then raise exception 'product not found'; end if;
    if v_prod.category <> 'milk' then raise exception 'milk centers sell milk only'; end if;

    perform public.lock_milk(v_center, v_prod.milk_type);
    v_left := public.milk_sellable(v_center, v_prod.milk_type);
    if v_left < v_qty then
      raise exception 'only % L of fresh % milk is left', rtrim(rtrim(round(greatest(v_left, 0), 1)::text, '0'), '.'), v_prod.milk_type;
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

-- old counter products (dahi and so on) leave the sale form; past sales keep their names
update public.products set is_available = false
 where category <> 'milk' and is_available
   and area_manager_id in (select id from public.area_managers where type = 'milk_center');

-- ---------- 4. bulk: bids within 2 days of milk, dispatch from fresh stock ----------
-- litres of this milk the center collects on an average day (last 14 days). a "mixed" request can be met with any milk.
create or replace function public.daily_collection(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(quantity_l), 0) / 14.0 from milk_collections
   where area_manager_id = p_center and status = 'accepted' and collected_at >= now() - interval '14 days'
     and (p_type = 'mixed' or milk_type = p_type);
$$;

create or replace function public.bulk_stock(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  select case when p_type = 'mixed'
    then (select sum(public.milk_sellable(p_center, t)) from unnest(enum_range(null::milk_kind)) t)
    else public.milk_sellable(p_center, p_type) end;
$$;

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
  v_cap    numeric;
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
  if p_delivery_date < (now() at time zone 'Asia/Karachi')::date then
    raise exception 'delivery date cannot be in the past';
  end if;

  -- milk is fresh for about 2 days, so a center can promise at most 2 days of what it collects
  v_cap := floor(public.daily_collection(v_center, v_req.milk_type) * 2);
  if v_cap < 1 then
    raise exception 'record a few days of % milk collection first. bids are limited to 2 days of the milk you collect', v_req.milk_type;
  end if;
  if p_quantity > v_cap then
    raise exception 'you collect about % L of % milk a day, so you can bid up to % L (2 days of milk)',
      round(public.daily_collection(v_center, v_req.milk_type)), v_req.milk_type, v_cap;
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

-- for the bid form: how much this center can offer on a request
create or replace function public.my_bid_capacity(p_type milk_kind)
returns table (daily_l numeric, max_bid_l numeric, fresh_now_l numeric)
language sql stable security definer set search_path = public
as $$
  select round(public.daily_collection(c, p_type), 1), floor(public.daily_collection(c, p_type) * 2), round(public.bulk_stock(c, p_type), 1)
  from (select public.my_milk_center_id() as c) x where c is not null;
$$;

-- a "mixed" order takes milk of every type out of stock, buffalo first, so the stock view stays right
create table if not exists public.bulk_order_milk (
  order_id  uuid not null references public.bulk_orders(id) on delete cascade,
  milk_type milk_kind not null,
  litres    numeric(10,2) not null check (litres > 0),
  primary key (order_id, milk_type)
);
alter table public.bulk_order_milk enable row level security;
drop policy if exists "bulk milk: center or admin reads" on public.bulk_order_milk;
create policy "bulk milk: center or admin reads" on public.bulk_order_milk for select using (
  exists (select 1 from public.bulk_orders b where b.id = order_id and (b.area_manager_id = public.my_milk_center_id() or public.is_admin())));

-- orders dispatched before this file took milk of the requested type
insert into public.bulk_order_milk (order_id, milk_type, litres)
select b.id, r.milk_type, b.quantity_l from public.bulk_orders b join public.bulk_requirements r on r.id = b.requirement_id
 where b.status in ('dispatched', 'delivered')
on conflict do nothing;

-- stock now reads bulk milk from bulk_order_milk
create or replace function public.milk_in_stock(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  select
    coalesce((select sum(quantity_l) from milk_collections where area_manager_id = p_center and milk_type = p_type and status = 'accepted'), 0)
  - coalesce((select sum(i.quantity) from shop_order_items i join shop_orders o on o.id = i.order_id
              where o.area_manager_id = p_center and i.category = 'milk' and i.milk_type = p_type and o.status <> 'cancelled'), 0)
  - coalesce((select sum(x.litres) from bulk_order_milk x join bulk_orders b on b.id = x.order_id
              where b.area_manager_id = p_center and x.milk_type = p_type and b.status in ('dispatched', 'delivered')), 0)
  - coalesce((select sum(litres) from milk_usage where area_manager_id = p_center and milk_type = p_type), 0);
$$;

create or replace view public.milk_stock with (security_invoker = true) as
with types as (select unnest(enum_range(null::milk_kind)) as milk_type),
centers as (select public.my_milk_center_id() as area_manager_id)
select c.area_manager_id, t.milk_type,
  coalesce((select sum(quantity_l) from public.milk_collections m
            where m.area_manager_id = c.area_manager_id and m.milk_type = t.milk_type and m.status = 'accepted'), 0) as bought_l,
  coalesce((select sum(i.quantity) from public.shop_order_items i join public.shop_orders o on o.id = i.order_id
            where o.area_manager_id = c.area_manager_id and i.category = 'milk' and i.milk_type = t.milk_type and o.status <> 'cancelled'), 0) as sold_l,
  coalesce((select sum(x.litres) from public.bulk_order_milk x join public.bulk_orders b on b.id = x.order_id
            where b.area_manager_id = c.area_manager_id and x.milk_type = t.milk_type and b.status in ('dispatched', 'delivered')), 0) as bulk_l,
  coalesce((select sum(litres) from public.milk_usage u
            where u.area_manager_id = c.area_manager_id and u.milk_type = t.milk_type), 0) as used_l
from centers c cross join types t
where c.area_manager_id is not null;

drop function if exists public.update_bulk_order(uuid, bulk_order_status);
drop function if exists public.update_bulk_order(uuid, bulk_order_status, text);
create or replace function public.update_bulk_order(p_order uuid, p_status bulk_order_status, p_code text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.bulk_orders;
  v_type        milk_kind;
  v_is_center   boolean;
  v_is_business boolean;
  v_need        numeric;
  v_take        numeric;
  v_left        numeric;
  v_msg         text;
  t             milk_kind;
begin
  select * into v from public.bulk_orders where id = p_order for update;
  if v.id is null then raise exception 'order not found'; end if;
  select milk_type into v_type from bulk_requirements where id = v.requirement_id;

  v_is_center   := v.area_manager_id = public.my_milk_center_id();
  v_is_business := v.business_id = public.my_business_id();

  if p_status = 'dispatched' and v_is_center and v.status = 'confirmed' then
    -- lock every type this order may use, in a fixed order, then check fresh stock
    for t in select x from unnest(case when v_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_type] end) x order by x loop
      perform public.lock_milk(v.area_manager_id, t);
    end loop;
    v_left := public.bulk_stock(v.area_manager_id, v_type);
    if v_left < v.quantity_l then
      raise exception 'only % L of fresh % milk is in stock, % L is needed', round(greatest(v_left, 0)), v_type, round(v.quantity_l);
    end if;
    v_need := v.quantity_l;
    for t in select x from unnest(case when v_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_type] end) x loop
      exit when v_need <= 0;
      v_take := least(v_need, greatest(public.milk_sellable(v.area_manager_id, t), 0));
      if v_take > 0 then
        insert into bulk_order_milk (order_id, milk_type, litres) values (p_order, t, v_take);
        v_need := v_need - v_take;
      end if;
    end loop;
    update public.bulk_orders set status = 'dispatched', dispatched_at = now() where id = p_order;
  elsif p_status = 'delivered' and v_is_center and v.status = 'dispatched' then
    v_msg := public.check_delivery_code('bulk', p_order, p_code);
    if v_msg is not null then return v_msg; end if;
    update public.bulk_orders set status = 'delivered', delivered_at = now() where id = p_order;
  elsif p_status = 'delivered' and v_is_business and v.status = 'dispatched' then
    -- the buyer confirms it arrived
    update public.bulk_orders set status = 'delivered', delivered_at = now() where id = p_order;
  elsif p_status = 'cancelled' and (v_is_center or v_is_business) and v.status = 'confirmed' then
    update public.bulk_orders set status = 'cancelled' where id = p_order;
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- ---------- 6. "sold" = delivered, counted on the day it was delivered ----------
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
    from shop_orders o, b where o.area_manager_id = p_center and o.status = 'delivered' and o.delivered_at >= b.s and o.delivered_at < b.e
  ),
  bulk as (
    select coalesce(sum(x.total_amount), 0) as total
    from bulk_orders x, b where x.area_manager_id = p_center and x.status = 'delivered' and x.delivered_at >= b.s and x.delivered_at < b.e
  )
  select shop.total + bulk.total, shop.online + bulk.total from shop, bulk;
$$;

create or replace view public.center_daily with (security_invoker = true) as
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
  select (o.delivered_at at time zone 'Asia/Karachi')::date as day, sum(o.total_amount) as shop_sales, count(*) as orders
  from public.shop_orders o, c
  where o.area_manager_id = c.id and o.status = 'delivered' and o.delivered_at >= now() - interval '31 days'
  group by 1
),
milk_out as (
  select (o.delivered_at at time zone 'Asia/Karachi')::date as day, sum(i.quantity) as sold_l
  from public.shop_order_items i join public.shop_orders o on o.id = i.order_id, c
  where o.area_manager_id = c.id and o.status = 'delivered' and i.category = 'milk' and o.delivered_at >= now() - interval '31 days'
  group by 1
),
bulk as (
  select (b.delivered_at at time zone 'Asia/Karachi')::date as day,
    sum(b.total_amount) as bulk_sales, sum(b.quantity_l) as bulk_l
  from public.bulk_orders b, c
  where b.area_manager_id = c.id and b.status = 'delivered' and b.delivered_at >= now() - interval '31 days'
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

create or replace view public.product_sales_30d with (security_invoker = true) as
select i.product_id, i.name, i.category, i.unit, sum(i.quantity) as qty, sum(i.line_total) as revenue
from public.shop_order_items i
join public.shop_orders o on o.id = i.order_id
where o.status = 'delivered' and o.delivered_at >= now() - interval '30 days'
  and o.area_manager_id = public.my_milk_center_id()
group by 1, 2, 3, 4;

-- ---------- who may call what ----------
-- milk_shelf, milk_sellable and listing_freshness stay callable: the public listings view needs them,
-- and they only return stock and freshness that the listings already show
revoke execute on function public.lock_milk(uuid, milk_kind), public.new_delivery_code(), public.check_delivery_code(text, uuid, text),
  public.daily_collection(uuid, milk_kind), public.bulk_stock(uuid, milk_kind) from public, anon, authenticated;
revoke execute on function public.my_milk_shelf(), public.my_bid_capacity(milk_kind), public.demo_delivery_code(text, uuid),
  public.update_shop_order(uuid, shop_order_status, text), public.confirm_order_received(uuid),
  public.update_bulk_order(uuid, bulk_order_status, text), public.record_sale(jsonb, text),
  public.place_shop_order(jsonb, text, text), public.place_bid(uuid, numeric, numeric, date, integer, text) from public, anon;
grant execute on function public.my_milk_shelf(), public.my_bid_capacity(milk_kind), public.demo_delivery_code(text, uuid),
  public.update_shop_order(uuid, shop_order_status, text), public.confirm_order_received(uuid),
  public.update_bulk_order(uuid, bulk_order_status, text), public.record_sale(jsonb, text),
  public.place_shop_order(jsonb, text, text), public.place_bid(uuid, numeric, numeric, date, integer, text) to authenticated;
