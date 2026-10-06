-- 22: fair bulk milk bids, and a fresh milk test before every bulk milk dispatch
-- run after 21_discount_rule.sql (safe to run again).
--
-- 1. the daily average counts the days the center has been working (up to 14), so new centers are not under-counted
-- 2. stock counts only milk that will still be fresh on the delivery day
-- 3. dispatching a bulk milk order needs a passing iot test of the milk going out; it is saved with the order

-- ---------- 1. average milk a day ----------
create or replace function public.daily_collection(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  with m as (
    select quantity_l, collected_at from milk_collections
    where area_manager_id = p_center and status = 'accepted' and collected_at >= now() - interval '14 days'
      and (p_type = 'mixed' or milk_type = p_type)
  ),
  first_day as (
    select (min(collected_at) at time zone 'Asia/Karachi')::date as d from milk_collections
    where area_manager_id = p_center and status = 'accepted'
  )
  select coalesce(sum(m.quantity_l), 0)
         / greatest(1, least(14, (now() at time zone 'Asia/Karachi')::date - coalesce((select d from first_day), (now() at time zone 'Asia/Karachi')::date) + 1))
  from m;
$$;

-- ---------- 2. milk on the shelf that is still fresh at a given time ----------
create or replace function public.milk_fresh_at(p_center uuid, p_type milk_kind, p_at timestamptz)
returns numeric
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, coalesce(m.reading_at, m.collected_at) + coalesce(m.freshness_hours, 24) * interval '1 hour' as good_until,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  )
  select coalesce(sum(least(b.quantity_l, greatest(stock.left_l - b.before_l, 0))) filter (where b.good_until > p_at), 0)
  from b, stock;
$$;

create or replace function public.bulk_capacity(p_center uuid, p_type milk_kind, p_delivery date, p_skip_requirement uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
  v_days    integer := greatest(p_delivery - v_today, 0);
  -- delivered by midday on the delivery day
  v_when    timestamptz := greatest(now(), (p_delivery::timestamp + interval '12 hours') at time zone 'Asia/Karachi');
  v_daily   numeric := public.daily_collection(p_center, p_type);
  v_stock   numeric := 0;
  v_coming  numeric := v_daily * least(v_days, 2);
  v_bids    numeric;
  v_orders  numeric;
  v_listed  numeric := 0;
  v_max     numeric;
  t         milk_kind;
begin
  for t in select x from unnest(case when p_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[p_type] end) x loop
    v_stock := v_stock + public.milk_fresh_at(p_center, t, v_when);
  end loop;
  select coalesce(sum(b.quantity_l), 0) into v_bids
    from bids b join bulk_requirements r on r.id = b.requirement_id
   where b.area_manager_id = p_center and b.status = 'submitted' and r.status = 'open' and r.product = 'milk'
     and b.requirement_id is distinct from p_skip_requirement
     and b.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  select coalesce(sum(o.quantity_l), 0) into v_orders
    from bulk_orders o join bulk_requirements r on r.id = o.requirement_id
   where o.area_manager_id = p_center and o.status = 'confirmed' and r.product = 'milk'
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

-- ---------- 3. iot test before a bulk milk order leaves ----------
alter table public.bulk_orders add column if not exists dispatch_reading_id uuid unique references public.device_readings(id);
alter table public.bulk_orders add column if not exists dispatch_quality jsonb;

drop function if exists public.update_bulk_order(uuid, bulk_order_status, text);
create or replace function public.update_bulk_order(p_order uuid, p_status bulk_order_status, p_code text default null, p_reading uuid default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.bulk_orders;
  v_req         public.bulk_requirements;
  v_is_center   boolean;
  v_is_business boolean;
  v_need        numeric;
  v_take        numeric;
  v_left        numeric;
  v_msg         text;
  v_r           public.device_readings;
  v_ai          jsonb;
  t             milk_kind;
  p             record;
begin
  select * into v from public.bulk_orders where id = p_order for update;
  if v.id is null then raise exception 'order not found'; end if;
  select * into v_req from bulk_requirements where id = v.requirement_id;
  v_is_center   := v.area_manager_id = public.my_seller_id();
  v_is_business := v.business_id = public.my_business_id();

  if p_status = 'dispatched' and v_is_center and v.status = 'confirmed' then
    if v_req.product = 'milk' then
      -- the milk going out is tested on the device first; old or adulterated milk cannot be sent
      if p_reading is null then raise exception 'test the milk on the IoT device before dispatching'; end if;
      select * into v_r from device_readings where id = p_reading for update;
      if v_r.id is null or v_r.area_manager_id <> v.area_manager_id then raise exception 'this reading is not from your device'; end if;
      if v_r.status <> 'ok' then raise exception 'the device test did not finish properly. test again'; end if;
      if v_r.received_at < now() - interval '15 minutes' then raise exception 'this test is more than 15 minutes old. test the milk again'; end if;
      if v_r.collection_id is not null or exists (select 1 from bulk_orders where dispatch_reading_id = p_reading) then
        raise exception 'this test was already used. test the milk going out';
      end if;
      v_ai := public.assess_milk(v_req.milk_type, v_r.temperature_c, v_r.ph, v_r.ec_ms, v_r.tds_ppm, v_r.reading_at);
      if not coalesce((v_ai->>'accept')::boolean, false) then
        raise exception 'the milk failed the test (%). it cannot be sent to the buyer', lower(coalesce(v_ai->'notes'->>0, 'not fresh'));
      end if;

      for t in select x from unnest(case when v_req.milk_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_req.milk_type] end) x order by x loop
        perform public.lock_milk(v.area_manager_id, t);
      end loop;
      v_left := public.bulk_stock(v.area_manager_id, v_req.milk_type);
      if v_left < v.quantity_l then
        raise exception 'only % L of fresh % milk is in stock, % L is needed', round(greatest(v_left, 0)), v_req.milk_type, round(v.quantity_l);
      end if;
      v_need := v.quantity_l;
      for t in select x from unnest(case when v_req.milk_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_req.milk_type] end) x loop
        exit when v_need <= 0;
        v_take := least(v_need, greatest(public.milk_sellable(v.area_manager_id, t), 0));
        if v_take > 0 then
          insert into bulk_order_milk (order_id, milk_type, litres) values (p_order, t, v_take);
          v_need := v_need - v_take;
        end if;
      end loop;
      update public.bulk_orders set dispatch_reading_id = v_r.id,
             dispatch_quality = jsonb_build_object('temperature_c', v_r.temperature_c, 'ph', v_r.ph, 'ec_ms', v_r.ec_ms, 'tds_ppm', v_r.tds_ppm,
               'tested_at', v_r.reading_at, 'quality', v_ai->'quality', 'freshness_score', v_ai->'freshness'->'freshness_score', 'freshness_hours', v_ai->'freshness_hours', 'device', v_r.device_serial)
       where id = p_order;
    else
      select coalesce(sum(stock_qty), 0) into v_left from products
       where area_manager_id = v.area_manager_id and category = v_req.product
         and (expires_on is null or expires_on >= (now() at time zone 'Asia/Karachi')::date);
      if v_left < v.quantity_l then
        raise exception 'only % % is in stock, % % is needed. update your stock on the products page first', public.fmt_qty(v_left), v_req.unit, public.fmt_qty(v.quantity_l), v_req.unit;
      end if;
      v_need := v.quantity_l;
      for p in select id, stock_qty from products
                where area_manager_id = v.area_manager_id and category = v_req.product and stock_qty > 0
                  and (expires_on is null or expires_on >= (now() at time zone 'Asia/Karachi')::date)
                order by expires_on nulls last, made_on nulls last, created_at for update loop
        exit when v_need <= 0;
        v_take := least(v_need, p.stock_qty);
        update products set stock_qty = stock_qty - v_take where id = p.id;
        v_need := v_need - v_take;
      end loop;
    end if;
    update public.bulk_orders set status = 'dispatched', dispatched_at = now() where id = p_order;
  elsif p_status = 'delivered' and v_is_center and v.status = 'dispatched' then
    v_msg := public.check_delivery_code('bulk', p_order, p_code);
    if v_msg is not null then return v_msg; end if;
    update public.bulk_orders set status = 'delivered', delivered_at = now() where id = p_order;
  elsif p_status = 'delivered' and v_is_business and v.status = 'dispatched' then
    update public.bulk_orders set status = 'delivered', delivered_at = now() where id = p_order;
  elsif p_status = 'cancelled' and (v_is_center or v_is_business) and v.status = 'confirmed' then
    update public.bulk_orders set status = 'cancelled', cancelled_by = case when v_is_center then 'center' else 'business' end where id = p_order;
    update public.bulk_requirements r set status = 'open',
           bid_deadline = greatest(r.bid_deadline, least(now() + interval '12 hours', (r.required_date::timestamp + interval '23 hours') at time zone 'Asia/Karachi'))
     where r.id = v.requirement_id and r.status in ('awarded', 'open') and r.required_date >= (now() at time zone 'Asia/Karachi')::date;
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

revoke execute on function public.milk_fresh_at(uuid, milk_kind, timestamptz), public.daily_collection(uuid, milk_kind),
  public.bulk_capacity(uuid, milk_kind, date, uuid) from public, anon, authenticated;
revoke execute on function public.update_bulk_order(uuid, bulk_order_status, text, uuid) from public, anon;
grant execute on function public.update_bulk_order(uuid, bulk_order_status, text, uuid) to authenticated;
