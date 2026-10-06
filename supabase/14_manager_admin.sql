-- 14: area manager and admin, final rules
-- run after 13_iot_sampling.sql (safe to run again).
--
-- 1. apnadairy charges only the iot device and the monthly subscription: no commission on milk sold
-- 2. app listings: the area manager lists a number of litres of tested milk; every order uses them up.
--    quality comes from the ai grades of the milk in stock. litres per order are set by the super admin.
-- 3. no counter (walk-in) sales: customers order through the app
-- 4. milk is tested only with the iot device; litres of a collection are no longer corrected afterwards
-- 5. a bulk bid can be at most what the center can supply on the delivery day
-- 6. day book: what came in and went out on any date; admin analytics

-- ---------- 1. no commission ----------
update public.platform_settings set commission_pct = 0 where commission_pct <> 0;
alter table public.platform_settings drop constraint if exists no_commission;
alter table public.platform_settings add constraint no_commission check (commission_pct = 0);
-- bills not paid yet drop their commission
update public.center_invoices
   set amount = amount - commission, commission = 0, commission_pct = 0,
       description = replace(description, ' and commission', '')
 where (status = 'due' or is_sample) and commission > 0;

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
  v_id     uuid;
begin
  select id into v_id from center_invoices where area_manager_id = p_center and kind = 'monthly' and period_month = v_month and status <> 'void';
  if v_id is not null then return v_id; end if;
  select * into s from platform_settings;
  select * into v_prev from public.center_month_sales(p_center, (v_month - interval '1 month')::date);
  t := public.tier_for(v_prev.online_sales);   -- a center that sold more last month pays a smaller fee
  v_fee := round(s.monthly_fee * (100 - t.discount_pct) / 100.0);
  insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                               sales_basis, online_sales, commission_pct, commission, amount, due_date, is_sample)
  values (p_center, 'monthly', v_month, to_char(v_month, 'FMMonth YYYY') || ' platform fee',
          s.monthly_fee, t.name, t.discount_pct, v_prev.online_sales, v_prev.online_sales, 0, 0,
          v_fee, greatest(v_month, (now() at time zone 'Asia/Karachi')::date) + s.payment_days, p_sample)
  returning id into v_id;
  return v_id;
end;
$$;

-- centers approved before billing existed never got a device bill
insert into public.center_invoices (area_manager_id, kind, description, device_fee, amount, due_date)
select a.id, 'device', 'ApnaDairy IoT milk tester (one-time)', s.device_price, s.device_price,
       (now() at time zone 'Asia/Karachi')::date + s.payment_days
from public.area_managers a cross join public.platform_settings s
where a.type = 'milk_center' and a.verification_status = 'active'
  and not exists (select 1 from public.center_invoices i where i.area_manager_id = a.id and i.kind = 'device' and i.status <> 'void');

-- ---------- 2. app listings ----------
alter table public.platform_settings
  add column if not exists order_min_l numeric(6,2) not null default 1 check (order_min_l > 0),
  add column if not exists order_max_l numeric(6,2) not null default 20 check (order_max_l > 0);
alter table public.platform_settings drop constraint if exists order_limits;
alter table public.platform_settings add constraint order_limits check (order_max_l >= order_min_l);

-- existing listings start with the fresh milk they could sell until now
update public.products pr set listed_l = floor(public.milk_sellable(pr.area_manager_id, pr.milk_type))
 where pr.category = 'milk' and pr.listed_l is null and not pr.is_sample;

-- the area manager can list at most the fresh milk in stock. orders lower the litres, which is always allowed.
create or replace function public.check_listing_litres()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_left numeric;
begin
  -- sample data is inserted by the seed; every edit by the area manager is checked
  if new.category <> 'milk' or (tg_op = 'INSERT' and new.is_sample) then return new; end if;
  if tg_op = 'INSERT' or coalesce(new.listed_l, 0) > coalesce(old.listed_l, 0) then
    if new.listed_l is null or new.listed_l < 0 then raise exception 'say how many litres to list'; end if;
    v_left := floor(greatest(public.milk_sellable(new.area_manager_id, new.milk_type), 0) * 2) / 2;
    if new.listed_l > v_left then
      raise exception 'you have % L of fresh % milk in stock. list that much or less', rtrim(rtrim(v_left::text, '0'), '.'), new.milk_type;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists products_listing_litres on public.products;
create trigger products_listing_litres before insert or update of listed_l on public.products
  for each row execute function public.check_listing_litres();

-- quality of what is on the shelf: the ai grade that most of the fresh litres in stock have
create or replace function public.listing_grade(p_center uuid, p_type milk_kind)
returns quality_grade
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.quality, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  shelf as (
    select least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l, b.quality,
           greatest(coalesce(b.freshness_hours, 24) - extract(epoch from now() - b.t) / 3600, 0) as h
    from b, stock
  )
  select quality from shelf where l > 0 and h > 0 and quality is not null
  group by quality order by sum(l) desc, quality desc limit 1;
$$;

drop view if exists public.public_listings;
create view public.public_listings as
select pr.id, pr.area_manager_id as shop_id, sh.center_name as shop_name, sh.city, sh.rating, sh.review_count, sh.cover_path,
       pr.name, pr.milk_type, public.listing_grade(pr.area_manager_id, pr.milk_type) as quality, pr.description,
       pr.price as list_price, pr.discount_pct, round(pr.price * (100 - pr.discount_pct) / 100.0) as price_per_l,
       greatest(0, round(floor(least(coalesce(pr.listed_l, st.sellable_l), st.sellable_l) * 2) / 2, 1)) as available_l,
       ps.order_min_l as min_order_l, ps.order_max_l as max_order_l,
       f.freshness_score, f.hours_left, f.oldest_hours,
       pr.created_at
from public.products pr
join public.public_shops sh on sh.id = pr.area_manager_id
cross join public.platform_settings ps
cross join lateral (select public.milk_sellable(pr.area_manager_id, pr.milk_type) as sellable_l) st
cross join lateral public.listing_freshness(pr.area_manager_id, pr.milk_type) f
where pr.category = 'milk' and pr.is_available;
grant select on public.public_listings to anon, authenticated;

-- app order: litres per order within the admin's limits, taken from the listing and from stock
create or replace function public.place_shop_order(p_items jsonb, p_address text, p_phone text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_item  jsonb;
  v_l     record;
  v_p     public.products;
  v_set   public.platform_settings;
  v_shop  uuid;
  v_order uuid;
  v_qty   numeric;
  v_total numeric := 0;
  v_name  text;
begin
  if auth.uid() is null then raise exception 'sign in to order'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'add at least one item'; end if;
  if coalesce(trim(p_address), '') = '' then raise exception 'enter a delivery address'; end if;
  select * into v_set from platform_settings;
  select full_name into v_name from profiles where id = auth.uid();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    select * into v_p from products where id = (v_item->>'listing_id')::uuid and category = 'milk';
    if v_p.id is null then raise exception 'this milk is no longer on sale'; end if;
    perform public.lock_milk(v_p.area_manager_id, v_p.milk_type);    -- wait for any other order of this milk
    select * into v_p from products where id = v_p.id for update;
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
    if v_qty is null or v_qty < v_set.order_min_l or v_qty > v_set.order_max_l then
      raise exception 'you can order % to % L of milk at a time', rtrim(rtrim(v_set.order_min_l::text, '0'), '.'), rtrim(rtrim(v_set.order_max_l::text, '0'), '.');
    end if;
    if v_qty > v_l.available_l then raise exception 'only % L of % milk is left', rtrim(rtrim(v_l.available_l::text, '0'), '.'), v_l.milk_type; end if;
    insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
    values (v_order, v_l.id, v_l.name, 'milk', v_l.milk_type, 'litre', v_qty, v_l.price_per_l);
    update products set listed_l = greatest(coalesce(listed_l, v_l.available_l) - v_qty, 0) where id = v_p.id;
    v_total := v_total + v_qty * v_l.price_per_l;
  end loop;

  update shop_orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

-- a cancelled order gives its litres back to the listing
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
    update products pr set listed_l = coalesce(pr.listed_l, 0) + i.quantity
      from shop_order_items i where i.order_id = p_id and i.product_id = pr.id and pr.category = 'milk';
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- ---------- 3. no counter sales ----------
revoke execute on function public.record_sale(jsonb, text) from public, anon, authenticated;
-- sample data: shops sell through the app only
do $$
declare d text;
begin
  select pg_get_functiondef('public.seed_sample_data()'::regprocedure) into d;
  d := replace(d, $r$case when random() < 0.45 then 'app' else 'walk_in' end$r$, $r$'app'::sale_channel$r$);
  d := replace(d, $r$' platform fee and commission'$r$, $r$' platform fee'$r$);
  execute d;
end $$;
update public.shop_orders o
   set channel = 'app',
       customer_name = (array['Ayesha Khan','Bilal Ahmed','Sana Tariq','Usman Ali','Hira Malik','Fatima Noor','Hamza Sheikh',
                             'Zainab Raza','Ali Raza','Mariam Iqbal','Saad Qureshi','Noor Fatima','Imran Butt','Kiran Javed'])[1 + floor(random() * 14)::int],
       delivery_address = coalesce(delivery_address, (array['House 12, Street 4, Gulshan Colony','Flat 3, Al-Noor Plaza','House 140, Canal View',
                             'House 21, Street 9, Satellite Town','Shop 5, Main Bazaar','House 7, Model Town'])[1 + floor(random() * 6)::int])
 where o.is_sample and o.channel = 'walk_in';

-- ---------- 4. device-only tests, no litre corrections ----------
revoke execute on function public.correct_collection(uuid, numeric, text) from public, anon, authenticated;

create or replace function public.record_collection(
  p_farmer uuid, p_quantity numeric, p_shift milk_shift,
  p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
  p_source text default 'device', p_price numeric default null, p_manual_reason text default null,
  p_reading uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_farmer public.farmers;
  v_r      public.device_readings;
  v_ai     jsonb;
  v_ok     boolean;
  v_price  numeric;
  v_id     uuid;
begin
  if v_center is null then raise exception 'only a verified milk center can record milk'; end if;
  if not public.center_billing_ok(v_center) then raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to continue'; end if;
  if p_source <> 'device' then raise exception 'test the milk with your IoT device'; end if;
  if not public.center_device_active(v_center) then raise exception 'your IoT device activates once its bill is paid'; end if;

  -- the reading is taken from what the device sent, never from the browser
  select * into v_r from device_readings where id = p_reading for update;
  if v_r.id is null or v_r.area_manager_id <> v_center then raise exception 'test the milk with the device first'; end if;
  if v_r.status <> 'ok' then raise exception 'this test failed the sensor check. test again'; end if;
  if v_r.collection_id is not null then raise exception 'this test is already used for another collection. test again'; end if;
  if v_r.received_at < now() - interval '15 minutes' then raise exception 'this test is more than 15 minutes old. test again'; end if;

  select * into v_farmer from farmers where id = p_farmer and area_manager_id = v_center;
  if v_farmer.id is null then raise exception 'this farmer is not registered with your center'; end if;
  if not v_farmer.is_active then raise exception 'this farmer is marked inactive'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 2000 then raise exception 'enter between 0.5 and 2000 litres'; end if;

  -- ec from tds: the tds code corrects to 25 °C already (see 12_iot_integration.sql)
  v_ai := public.assess_milk(v_farmer.milk_type, v_r.temperature_c, v_r.ph, v_r.ec_ms, v_r.tds_ppm, v_r.reading_at);
  v_ok := (v_ai->>'accept')::boolean;
  if v_ok then
    v_price := coalesce(p_price, (v_ai->>'offer_price')::numeric);
    if v_price < (v_ai->>'min_price')::numeric then
      raise exception 'farmers must get at least % of the market rate: Rs % per litre or more', rtrim(rtrim(v_ai->>'farmer_min_pct', '0'), '.') || '%', v_ai->>'min_price';
    end if;
  end if;

  insert into milk_collections (
    area_manager_id, farmer_id, milk_type, shift, quantity_l,
    temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, device_serial, device_reading_id,
    quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
    ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason
  ) values (
    v_center, p_farmer, v_farmer.milk_type, p_shift, p_quantity,
    v_r.temperature_c, v_r.ph, v_r.ec_ms, v_r.tds_ppm, v_r.reading_at, 'device', v_r.device_serial, v_r.id,
    case when v_ok then (v_ai->>'quality')::quality_grade end,
    (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
    (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
    (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
    v_price,
    case when v_ok then 'offered'::collection_status else 'rejected'::collection_status end,
    case when v_ok then null else now() end,
    case when v_ok then null else 'Failed the quality test' end
  ) returning id into v_id;
  update device_readings set collection_id = v_id where id = v_r.id;
  return v_id;
end;
$$;

-- the farmer's usual drop-offs, for quick picks when recording milk
create or replace function public.farmer_usual_litres(p_farmer uuid)
returns numeric[]
language sql stable security definer set search_path = public
as $$
  select coalesce(array_agg(q order by n desc, q), '{}') from (
    select round(quantity_l) as q, count(*) as n from milk_collections
    where farmer_id = p_farmer and area_manager_id = public.my_milk_center_id() and collected_at > now() - interval '60 days'
    group by 1 order by count(*) desc, 1 limit 3
  ) x where q > 0;
$$;

-- ---------- 5. bulk bids within what the center can supply ----------
-- milk stays fresh about 2 days, so the milk that can reach the buyer on the delivery day is:
--   fresh milk in stock now (only if delivery is within 2 days)
-- + the average daily collection × days until delivery (at most 2 days)
-- − milk already promised in the center's other open bids, bulk orders and app listings for those days
create or replace function public.bulk_capacity(p_center uuid, p_type milk_kind, p_delivery date, p_skip_requirement uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
  v_days    integer := greatest(p_delivery - v_today, 0);
  v_daily   numeric := public.daily_collection(p_center, p_type);
  v_stock   numeric := case when v_days < 2 then greatest(public.bulk_stock(p_center, p_type), 0) else 0 end;
  v_coming  numeric := v_daily * least(v_days, 2);
  v_bids    numeric;
  v_orders  numeric;
  v_listed  numeric := 0;
  v_max     numeric;
begin
  select coalesce(sum(b.quantity_l), 0) into v_bids
    from bids b join bulk_requirements r on r.id = b.requirement_id
   where b.area_manager_id = p_center and b.status = 'submitted' and r.status = 'open'
     and b.requirement_id is distinct from p_skip_requirement
     and b.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  select coalesce(sum(o.quantity_l), 0) into v_orders
    from bulk_orders o join bulk_requirements r on r.id = o.requirement_id
   where o.area_manager_id = p_center and o.status = 'confirmed'
     and o.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  if v_days < 2 then
    select coalesce(sum(listed_l), 0) into v_listed from products
     where area_manager_id = p_center and category = 'milk' and is_available and not is_sample
       and (p_type = 'mixed' or milk_type = p_type);
  end if;
  v_max := greatest(floor(v_stock + v_coming - v_bids - v_orders - v_listed), 0);
  return jsonb_build_object('days', v_days, 'daily_l', round(v_daily, 1), 'stock_l', round(v_stock, 1), 'coming_l', round(v_coming, 1),
    'promised_l', round(v_bids + v_orders + v_listed, 1), 'max_l', v_max);
end;
$$;

drop function if exists public.my_bid_capacity(milk_kind);
create or replace function public.my_bid_capacity(p_type milk_kind, p_delivery date, p_requirement uuid default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.bulk_capacity(public.my_milk_center_id(), p_type, p_delivery, p_requirement)
  where public.my_milk_center_id() is not null;
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
  v_cap    jsonb;
  v_id     uuid;
begin
  if v_center is null then raise exception 'only verified milk collection centers can bid'; end if;
  if not public.center_billing_ok(v_center) then
    raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to bid again';
  end if;
  select * into v_req from public.bulk_requirements where id = p_requirement;
  if v_req.id is null then raise exception 'requirement not found'; end if;
  if v_req.status <> 'open' or v_req.bid_deadline <= now() then raise exception 'bidding is closed for this requirement'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'enter the litres you can supply'; end if;
  if p_quantity > v_req.quantity_l then raise exception 'you cannot offer more than the % L requested', v_req.quantity_l; end if;
  if p_delivery_date < (now() at time zone 'Asia/Karachi')::date then raise exception 'delivery date cannot be in the past'; end if;

  v_cap := public.bulk_capacity(v_center, v_req.milk_type, p_delivery_date, p_requirement);
  if p_quantity > (v_cap->>'max_l')::numeric then
    raise exception 'you can supply about % L of % milk on that day (fresh stock % L + collection % L, minus % L already promised)',
      v_cap->>'max_l', v_req.milk_type, v_cap->>'stock_l', v_cap->>'coming_l', v_cap->>'promised_l';
  end if;

  insert into public.bids (requirement_id, area_manager_id, price_per_l, quantity_l, delivery_date, max_age_hours, notes)
  values (p_requirement, v_center, p_price, p_quantity, p_delivery_date, p_max_age_hours, p_notes)
  on conflict (requirement_id, area_manager_id) do update
     set price_per_l = excluded.price_per_l, quantity_l = excluded.quantity_l, delivery_date = excluded.delivery_date,
         max_age_hours = excluded.max_age_hours, notes = excluded.notes, status = 'submitted', updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------- 6. day book and analytics ----------
-- what came in and went out on one day (pakistan time), per milk type
create or replace function public.center_day_book(p_day date)
returns table (milk_type milk_kind, bought_l numeric, paid_farmers numeric, sold_l numeric, sales numeric,
               bulk_l numeric, bulk_sales numeric, spoiled_l numeric, used_l numeric)
language sql stable security definer set search_path = public
as $$
  with c as (select public.my_milk_center_id() as id),
  b as (select (p_day::timestamp at time zone 'Asia/Karachi') as s, ((p_day + 1)::timestamp at time zone 'Asia/Karachi') as e),
  t as (select unnest(enum_range(null::milk_kind)) as milk_type)
  select t.milk_type,
    coalesce((select sum(m.quantity_l) from milk_collections m, b where m.area_manager_id = c.id and m.milk_type = t.milk_type
              and m.status = 'accepted' and m.collected_at >= b.s and m.collected_at < b.e), 0),
    coalesce((select sum(m.total_amount) from milk_collections m, b where m.area_manager_id = c.id and m.milk_type = t.milk_type
              and m.status = 'accepted' and m.collected_at >= b.s and m.collected_at < b.e), 0),
    coalesce((select sum(i.quantity) from shop_order_items i join shop_orders o on o.id = i.order_id, b where o.area_manager_id = c.id
              and i.category = 'milk' and i.milk_type = t.milk_type and o.status = 'delivered' and o.delivered_at >= b.s and o.delivered_at < b.e), 0),
    coalesce((select sum(i.line_total) from shop_order_items i join shop_orders o on o.id = i.order_id, b where o.area_manager_id = c.id
              and i.category = 'milk' and i.milk_type = t.milk_type and o.status = 'delivered' and o.delivered_at >= b.s and o.delivered_at < b.e), 0),
    coalesce((select sum(x.litres) from bulk_order_milk x join bulk_orders o on o.id = x.order_id, b where o.area_manager_id = c.id
              and x.milk_type = t.milk_type and o.status = 'delivered' and o.delivered_at >= b.s and o.delivered_at < b.e), 0),
    coalesce((select sum(x.litres * o.price_per_l) from bulk_order_milk x join bulk_orders o on o.id = x.order_id, b where o.area_manager_id = c.id
              and x.milk_type = t.milk_type and o.status = 'delivered' and o.delivered_at >= b.s and o.delivered_at < b.e), 0),
    coalesce((select sum(u.litres) from milk_usage u, b where u.area_manager_id = c.id and u.milk_type = t.milk_type
              and u.reason = 'spoiled' and u.created_at >= b.s and u.created_at < b.e), 0),
    coalesce((select sum(u.litres) from milk_usage u, b where u.area_manager_id = c.id and u.milk_type = t.milk_type
              and u.reason <> 'spoiled' and u.created_at >= b.s and u.created_at < b.e), 0)
  from t, c where c.id is not null;
$$;

-- the first day a center has anything on record (date pickers start here)
create or replace function public.my_first_day()
returns date
language sql stable security definer set search_path = public
as $$
  select least(
    (select (coalesce(verified_at, created_at) at time zone 'Asia/Karachi')::date from area_managers where id = public.my_milk_center_id()),
    (select (min(collected_at) at time zone 'Asia/Karachi')::date from milk_collections where area_manager_id = public.my_milk_center_id()),
    (select (min(created_at) at time zone 'Asia/Karachi')::date from shop_orders where area_manager_id = public.my_milk_center_id())
  );
$$;

-- platform analytics for the super admin
create or replace function public.admin_analytics(p_days integer default 30)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_from  date := v_today - (greatest(p_days, 7) - 1);
  v_start timestamptz := v_from::timestamp at time zone 'Asia/Karachi';
  r jsonb;
begin
  if not public.is_admin() then raise exception 'only super admin can see analytics'; end if;
  with days as (select generate_series(v_from, v_today, interval '1 day')::date as d),
  col as (
    select (collected_at at time zone 'Asia/Karachi')::date as d,
           sum(quantity_l) filter (where status = 'accepted') as l, sum(total_amount) filter (where status = 'accepted') as paid,
           count(*) as tests, count(*) filter (where reject_reason = 'Failed the quality test') as failed
    from milk_collections where collected_at >= v_start group by 1
  ),
  sold as (
    select (delivered_at at time zone 'Asia/Karachi')::date as d, sum(total_amount) as amt, count(*) as n
    from shop_orders where status = 'delivered' and delivered_at >= v_start group by 1
  ),
  bulk as (
    select (delivered_at at time zone 'Asia/Karachi')::date as d, sum(total_amount) as amt
    from bulk_orders where status = 'delivered' and delivered_at >= v_start group by 1
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_today,
    'daily', (select jsonb_agg(jsonb_build_object('day', days.d, 'collected_l', coalesce(col.l, 0), 'paid', coalesce(col.paid, 0),
                'sales', coalesce(sold.amt, 0) + coalesce(bulk.amt, 0), 'orders', coalesce(sold.n, 0),
                'tests', coalesce(col.tests, 0), 'failed', coalesce(col.failed, 0)) order by days.d)
              from days left join col using (d) left join sold using (d) left join bulk using (d)),
    'quality', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                  select case when reject_reason = 'Failed the quality test' then 'failed' else quality::text end as k, count(*) as n
                  from milk_collections where collected_at >= v_start and (quality is not null or reject_reason = 'Failed the quality test')
                  group by 1) q where k is not null),
    'centers', (select coalesce(jsonb_agg(x order by x.collected_l desc), '[]') from (
                  select a.id, a.center_name, a.city,
                    coalesce((select sum(quantity_l) from milk_collections m where m.area_manager_id = a.id and m.status = 'accepted' and m.collected_at >= v_start), 0) as collected_l,
                    coalesce((select sum(total_amount) from shop_orders o where o.area_manager_id = a.id and o.status = 'delivered' and o.delivered_at >= v_start), 0)
                      + coalesce((select sum(total_amount) from bulk_orders o where o.area_manager_id = a.id and o.status = 'delivered' and o.delivered_at >= v_start), 0) as sales,
                    (select round(100.0 * count(*) filter (where quality = 'premium') / nullif(count(*) filter (where quality is not null), 0))
                       from milk_collections m where m.area_manager_id = a.id and m.collected_at >= v_start) as premium_pct,
                    (select count(*) from farmers f where f.area_manager_id = a.id and f.is_active) as farmers,
                    (select serial from iot_devices d where d.area_manager_id = a.id) as device,
                    public.center_billing_ok(a.id) as billing_ok
                  from area_managers a where a.type = 'milk_center' and a.verification_status = 'active') x),
    'income', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'device', dev, 'subscription', sub) order by m), '[]') from (
                  select date_trunc('month', paid_at at time zone 'Asia/Karachi')::date as m,
                         sum(amount) filter (where kind = 'device') as dev, sum(amount) filter (where kind = 'monthly') as sub
                  from center_invoices where status = 'paid' and paid_at >= (date_trunc('month', v_today) - interval '5 months') group by 1) i),
    'totals', jsonb_build_object(
      'centers', (select count(*) from area_managers where type = 'milk_center' and verification_status = 'active'),
      'businesses', (select count(*) from business_profiles where verification_status = 'active'),
      'farmers', (select count(*) from farmers where is_active),
      'customers', (select count(*) from profiles where role = 'customer'),
      'devices', (select count(*) from iot_devices where area_manager_id is not null and is_active),
      'outstanding', (select coalesce(sum(amount), 0) from center_invoices where status = 'due'))
  ) into r;
  return r;
end;
$$;

-- the center's device is the one given in iot_devices; the old default serial is dropped
alter table public.center_settings alter column device_serial drop not null, alter column device_serial drop default;
update public.center_settings s set device_serial = (select d.serial from public.iot_devices d where d.area_manager_id = s.area_manager_id)
 where device_serial is distinct from (select d.serial from public.iot_devices d where d.area_manager_id = s.area_manager_id);

-- give a device to a center, move it, or take it back (p_center null). the old center's settings forget it.
create or replace function public.assign_device(p_serial text, p_center uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_old uuid;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  select area_manager_id into v_old from iot_devices where serial = p_serial;
  if not found then raise exception 'device not found'; end if;
  if p_center is not null and not exists (select 1 from area_managers where id = p_center and type = 'milk_center') then
    raise exception 'devices can only go to a milk center';
  end if;
  if v_old is not null and v_old is distinct from p_center then
    update center_settings set device_serial = null where area_manager_id = v_old;
  end if;
  update iot_devices set area_manager_id = null where area_manager_id = p_center and serial <> p_serial;
  update iot_devices set area_manager_id = p_center where serial = p_serial;
  if p_center is not null then
    update center_settings set device_serial = p_serial where area_manager_id = p_center;
  end if;
end;
$$;

-- admin: last test of each device
create or replace function public.device_activity()
returns table (serial text, last_test timestamptz, tests_7d bigint, failed_7d bigint)
language sql stable security definer set search_path = public
as $$
  select d.serial, max(r.received_at), count(r.id) filter (where r.received_at > now() - interval '7 days'),
         count(r.id) filter (where r.received_at > now() - interval '7 days' and r.status <> 'ok')
  from iot_devices d left join device_readings r on r.device_serial = d.serial
  where public.is_admin()
  group by d.serial;
$$;

-- ---------- who may call what ----------
revoke execute on function public.check_listing_litres(), public.bulk_capacity(uuid, milk_kind, date, uuid) from public, anon, authenticated;
revoke execute on function public.place_shop_order(jsonb, text, text), public.update_shop_order(uuid, shop_order_status, text),
  public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text, uuid),
  public.farmer_usual_litres(uuid), public.my_bid_capacity(milk_kind, date, uuid),
  public.place_bid(uuid, numeric, numeric, date, integer, text), public.center_day_book(date), public.my_first_day(),
  public.admin_analytics(integer), public.device_activity() from public, anon;
grant execute on function public.place_shop_order(jsonb, text, text), public.update_shop_order(uuid, shop_order_status, text),
  public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text, uuid),
  public.farmer_usual_litres(uuid), public.my_bid_capacity(milk_kind, date, uuid),
  public.place_bid(uuid, numeric, numeric, date, integer, text), public.center_day_book(date), public.my_first_day(),
  public.admin_analytics(integer), public.device_activity() to authenticated;
