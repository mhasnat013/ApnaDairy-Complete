-- 37: bids can offer a different milk grade; bulk milk is sent from tested stock
-- run after 36_milk_expiry.sql (safe to run again).
--
-- 1. a center can bid a lower (or higher) grade than the buyer asked for, e.g. standard milk at a lower price when
--    premium was asked. the bid and the order carry the grade really offered, so standard is never shown as premium.
-- 2. a center bids on the milk it normally has (its fresh stock plus its usual daily collection); the buyer's
--    acceptance does not re-check that forecast.
-- 3. dispatch needs no new iot test: the milk goes out of the center's tested stock, of the offered grade or better,
--    and the order keeps what that stock was (grade, when tested, freshness).

alter table public.bids add column if not exists offered_quality quality_grade;
alter table public.bulk_orders add column if not exists quality quality_grade;

-- bids and orders made before this file offered exactly what was asked
update public.bids b set offered_quality = r.quality
  from public.bulk_requirements r
 where r.id = b.requirement_id and r.product = 'milk' and b.offered_quality is null;
update public.bulk_orders o set quality = coalesce(b.offered_quality, r.quality)
  from public.bids b, public.bulk_requirements r
 where b.id = o.bid_id and r.id = o.requirement_id and r.product = 'milk' and o.quality is null;

-- ---------- capacity: promises count at the grade really offered ----------
create or replace function public.bulk_capacity(p_center uuid, p_type milk_kind, p_delivery date, p_skip_requirement uuid default null,
                                                p_grade quality_grade default 'standard')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
  v_days    integer := greatest(p_delivery - v_today, 0);
  -- delivered by midday on the delivery day
  v_when    timestamptz := greatest(now(), (p_delivery::timestamp + interval '12 hours') at time zone 'Asia/Karachi');
  v_daily   numeric := public.daily_collection(p_center, p_type);
  v_share   numeric := case when p_grade = 'standard' then 1 else public.grade_share(p_center, p_type, p_grade) end;
  v_all     numeric := 0;
  v_stock   numeric := 0;
  v_bids    numeric;
  v_orders  numeric;
  v_bids_g  numeric;
  v_orders_g numeric;
  v_listed  numeric := 0;
  v_total   numeric;
  v_graded  numeric;
  t         milk_kind;
begin
  for t in select x from unnest(case when p_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[p_type] end) x loop
    v_all := v_all + public.milk_fresh_at(p_center, t, v_when);
    v_stock := v_stock + public.milk_fresh_at(p_center, t, v_when, p_grade);
  end loop;
  select coalesce(sum(b.quantity_l), 0), coalesce(sum(b.quantity_l) filter (where coalesce(b.offered_quality, r.quality) >= p_grade), 0)
    into v_bids, v_bids_g
    from bids b join bulk_requirements r on r.id = b.requirement_id
   where b.area_manager_id = p_center and b.status = 'submitted' and r.status = 'open' and r.product = 'milk'
     and b.requirement_id is distinct from p_skip_requirement
     and b.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  select coalesce(sum(o.quantity_l), 0), coalesce(sum(o.quantity_l) filter (where coalesce(o.quality, r.quality) >= p_grade), 0)
    into v_orders, v_orders_g
    from bulk_orders o join bulk_requirements r on r.id = o.requirement_id
   where o.area_manager_id = p_center and o.status = 'confirmed' and r.product = 'milk'
     and o.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  if v_days < 2 then
    select coalesce(sum(listed_l), 0) into v_listed from products
     where area_manager_id = p_center and category = 'milk' and is_available and not is_sample and expired_at is null
       and (p_type = 'mixed' or milk_type = p_type);
  end if;
  v_total  := v_all + v_daily * least(v_days, 2) - v_bids - v_orders - v_listed;
  v_graded := v_stock + v_daily * v_share * least(v_days, 2) - v_bids_g - v_orders_g;
  return jsonb_build_object('days', v_days, 'grade', p_grade, 'share', round(v_share, 2),
    'daily_l', round(v_daily * v_share, 1), 'stock_l', round(v_stock, 1), 'coming_l', round(v_daily * v_share * least(v_days, 2), 1),
    'promised_l', round(v_bids_g + v_orders_g, 1),
    'total_l', greatest(floor(v_total), 0),
    'max_l', greatest(floor(least(v_total, v_graded)), 0));
end;
$$;

-- ---------- a bid names the grade it offers ----------
drop function if exists public.place_bid(uuid, numeric, numeric, date, integer, text, numeric);
create or replace function public.place_bid(p_requirement uuid, p_price numeric, p_quantity numeric, p_delivery_date date,
                                            p_max_age_hours integer default null, p_notes text default null, p_make numeric default 0,
                                            p_quality text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req    public.bulk_requirements;
  v_center uuid;
  v_left   numeric;
  v_cap    jsonb;
  v_make   numeric := coalesce(p_make, 0);
  v_grade  quality_grade;
  v_id     uuid;
begin
  select * into v_req from public.bulk_requirements where id = p_requirement;
  if v_req.id is null then raise exception 'requirement not found'; end if;
  v_center := case when v_req.product = 'milk' then public.my_milk_center_id() else public.my_byproduct_id() end;
  if v_center is null then
    raise exception '%', case when v_req.product = 'milk' then 'only verified milk collection centers can bid on milk'
                              else 'only verified byproduct sellers can bid on dairy products' end;
  end if;
  if not public.center_billing_ok(v_center) then
    raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to bid again';
  end if;
  if v_req.status <> 'open' or v_req.bid_deadline <= now() then raise exception 'bidding is closed for this requirement'; end if;
  if exists (select 1 from bids where requirement_id = p_requirement and area_manager_id = v_center and status = 'accepted') then
    raise exception 'the buyer already accepted your bid on this requirement';
  end if;
  if p_price is null or p_price = 'NaN' or p_price <= 0 then raise exception 'enter your price'; end if;
  if p_quantity is null or p_quantity = 'NaN' or p_quantity <= 0 then raise exception 'enter how much you can supply'; end if;
  v_left := v_req.quantity_l - public.requirement_covered(p_requirement);
  if p_quantity > v_left then raise exception 'only % % is still needed', public.fmt_qty(v_left), v_req.unit; end if;
  if p_delivery_date < (now() at time zone 'Asia/Karachi')::date then raise exception 'delivery date cannot be in the past'; end if;

  if v_req.product = 'milk' then
    v_make := 0;
    if coalesce(p_quality, '') not in ('', 'standard', 'fresh', 'premium') then raise exception 'choose the grade you offer'; end if;
    v_grade := coalesce(nullif(p_quality, '')::quality_grade, v_req.quality);
    v_cap := public.bulk_capacity(v_center, v_req.milk_type, p_delivery_date, p_requirement, v_grade);
    if p_quantity > (v_cap->>'max_l')::numeric then
      raise exception 'you can supply about % L of % milk at % grade on that day (fresh stock % L + collection % L, minus % L already promised)',
        v_cap->>'max_l', v_req.milk_type, v_grade, v_cap->>'stock_l', v_cap->>'coming_l', v_cap->>'promised_l';
    end if;
  else
    if v_make = 'NaN' or v_make > p_quantity then raise exception 'what you will make cannot be more than you offer'; end if;
    if v_make > 0 and p_delivery_date <= (now() at time zone 'Asia/Karachi')::date then
      raise exception 'for delivery today, offer only what you have in stock';
    end if;
    v_cap := public.product_capacity(v_center, v_req.product, p_requirement);
    if p_quantity - v_make > (v_cap->>'available')::numeric then
      raise exception 'you have % % in stock that is not promised to anyone. offer that much, plus what you will make by the delivery date',
        public.fmt_qty((v_cap->>'available')::numeric), v_req.unit;
    end if;
  end if;

  insert into public.bids (requirement_id, area_manager_id, price_per_l, quantity_l, delivery_date, max_age_hours, notes, make_qty, offered_quality)
  values (p_requirement, v_center, p_price, p_quantity, p_delivery_date, p_max_age_hours, p_notes, v_make, v_grade)
  on conflict (requirement_id, area_manager_id) do update
     set price_per_l = excluded.price_per_l, quantity_l = excluded.quantity_l, delivery_date = excluded.delivery_date,
         max_age_hours = excluded.max_age_hours, notes = excluded.notes, make_qty = excluded.make_qty,
         offered_quality = excluded.offered_quality, status = 'submitted', updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.place_bid(uuid, numeric, numeric, date, integer, text, numeric, text) from public, anon;
grant execute on function public.place_bid(uuid, numeric, numeric, date, integer, text, numeric, text) to authenticated;

-- the business sees the grade in the new-bid notification
create or replace function public.notify_new_bid()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_center text; r bulk_requirements;
begin
  select * into r from bulk_requirements where id = new.requirement_id;
  select b.user_id into v_owner from business_profiles b where b.id = r.business_id;
  select center_name into v_center from area_managers where id = new.area_manager_id;
  perform public.notify(v_owner, 'new_bid', v_center || case when tg_op = 'UPDATE' then ' changed their offer' else ' sent an offer' end,
    'Rs ' || public.fmt_qty(new.price_per_l) || ' for ' || public.fmt_qty(new.quantity_l) || case when r.unit = 'kg' then ' kg' else ' L' end
      || case when new.offered_quality is not null then ' of ' || new.offered_quality || ' milk'
              || case when new.offered_quality < r.quality then ' (lower than the ' || r.quality || ' you asked for)' else '' end
         else '' end || '.',
    '/business/requirements/' || r.id);
  return new;
end;
$$;
-- a changed offer is news too
drop trigger if exists bids_notify_new on public.bids;
create trigger bids_notify_new after insert or update of price_per_l, quantity_l, offered_quality on public.bids
  for each row when (new.status = 'submitted') execute function public.notify_new_bid();

-- ---------- accepting: the order keeps the offered grade; no forecast re-check for milk ----------
create or replace function public.accept_bid(p_bid uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_bid   public.bids;
  v_req   public.bulk_requirements;
  v_name  text;
  v_left  numeric;
  v_qty   numeric;
  v_cap   jsonb;
  v_order uuid;
begin
  select * into v_bid from public.bids where id = p_bid;
  if v_bid.id is null or v_bid.status <> 'submitted' then raise exception 'this bid is no longer available'; end if;
  select * into v_req from public.bulk_requirements where id = v_bid.requirement_id for update;
  if v_req.business_id is distinct from public.my_business_id() then raise exception 'you can only accept bids on your own requirements'; end if;
  if v_req.status <> 'open' then raise exception 'this requirement is already covered or was closed'; end if;
  if v_bid.delivery_date < (now() at time zone 'Asia/Karachi')::date then
    raise exception 'this bid was for delivery on %, which has passed', to_char(v_bid.delivery_date, 'FMDD Mon');
  end if;
  v_left := v_req.quantity_l - public.requirement_covered(v_req.id);
  if v_left <= 0 then raise exception 'your order is already covered'; end if;
  v_qty := least(v_bid.quantity_l, v_left);

  select center_name into v_name from area_managers where id = v_bid.area_manager_id;
  if v_req.product <> 'milk' then
    v_cap := public.product_capacity(v_bid.area_manager_id, v_req.product, v_req.id);
    if v_qty - least(v_bid.make_qty, v_qty) > (v_cap->>'available')::numeric then
      raise exception '% no longer has enough in stock for this bid. pick another bid, or ask them to bid again', v_name;
    end if;
  end if;

  update public.bids set status = 'accepted', updated_at = now() where id = v_bid.id;
  insert into public.bulk_orders (requirement_id, bid_id, business_id, area_manager_id, quantity_l,
                                  price_per_l, delivery_date, delivery_city, delivery_address, quality)
  values (v_req.id, v_bid.id, v_req.business_id, v_bid.area_manager_id, v_qty,
          v_bid.price_per_l, v_bid.delivery_date, v_req.delivery_city, v_req.delivery_address,
          case when v_req.product = 'milk' then coalesce(v_bid.offered_quality, v_req.quality) end)
  returning id into v_order;

  if v_left - v_qty <= 0 then
    update public.bulk_requirements set status = 'awarded' where id = v_req.id;
    update public.bids set status = 'not_selected', updated_at = now() where requirement_id = v_req.id and status = 'submitted';
  end if;
  return v_order;
end;
$$;

-- ---------- what the tested stock is: grade, test times, freshness ----------
-- fresh milk in stock of this grade or better, batch by batch (first in, first out)
create or replace function public.fresh_stock_summary(p_center uuid, p_type milk_kind, p_grade quality_grade)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with types as (select x from unnest(case when p_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[p_type] end) x),
  stock as (select t.x, greatest(public.milk_in_stock(p_center, t.x), 0) as left_l from types t),
  b as (
    select m.milk_type, m.quantity_l, m.quality, m.freshness_score, coalesce(m.reading_at, m.collected_at) as tested_at,
           coalesce(m.reading_at, m.collected_at) + public.shelf_hours(m.freshness_hours) * interval '1 hour' as good_until,
           coalesce(sum(m.quantity_l) over (partition by m.milk_type order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type in (select x from types) and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  shelf as (
    select b.*, least(b.quantity_l, greatest(s.left_l - b.before_l, 0)) as l
    from b join stock s on s.x = b.milk_type
  )
  select jsonb_build_object(
    'source', 'stock',
    'litres', coalesce(round(sum(l), 1), 0),
    'quality', min(quality),
    'tested_from', min(tested_at), 'tested_to', max(tested_at),
    'freshness_score', round(sum(l * freshness_score) / nullif(sum(l) filter (where freshness_score is not null), 0)),
    'good_until', min(good_until))
  from shelf
  where l > 0 and good_until > now() and quality >= p_grade;
$$;
revoke all on function public.fresh_stock_summary(uuid, milk_kind, quality_grade) from public, anon;
grant execute on function public.fresh_stock_summary(uuid, milk_kind, quality_grade) to authenticated;

-- the center's own view before dispatching
create or replace function public.my_dispatch_stock(p_order uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v public.bulk_orders; r public.bulk_requirements;
begin
  select * into v from bulk_orders where id = p_order;
  if v.id is null or v.area_manager_id is distinct from public.my_seller_id() then raise exception 'order not found'; end if;
  select * into r from bulk_requirements where id = v.requirement_id;
  if r.product <> 'milk' then return null; end if;
  return public.fresh_stock_summary(v.area_manager_id, r.milk_type, coalesce(v.quality, r.quality))
         || jsonb_build_object('grade', coalesce(v.quality, r.quality), 'needed', v.quantity_l);
end;
$$;
revoke all on function public.my_dispatch_stock(uuid) from public, anon;
grant execute on function public.my_dispatch_stock(uuid) to authenticated;

-- ---------- dispatch from tested stock ----------
do $$
declare d text; a text; b text;
begin
  select pg_get_functiondef('public.update_bulk_order(uuid,bulk_order_status,text,uuid)'::regprocedure) into d;
  if position('test the milk on the IoT device before dispatching' in d) > 0 then
    a := substring(d from position('      -- the milk going out is tested on the device first' in d)
                     for position('      update public.bulk_orders set dispatch_reading_id = v_r.id,' in d) - position('      -- the milk going out is tested on the device first' in d));
    b := $new$      -- no new test: the milk goes out of tested stock, of the grade offered to the buyer or better
      v_grade := coalesce(v.quality, v_req.quality);
      for t in select x from unnest(case when v_req.milk_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_req.milk_type] end) x order by x loop
        perform public.lock_milk(v.area_manager_id, t);
      end loop;
      v_stock := public.fresh_stock_summary(v.area_manager_id, v_req.milk_type, v_grade);
      if coalesce((v_stock->>'litres')::numeric, 0) < v.quantity_l then
        raise exception 'only % L of fresh % milk tested % or better is in your stock, % L is needed',
          round(coalesce((v_stock->>'litres')::numeric, 0)), v_req.milk_type, v_grade, round(v.quantity_l);
      end if;
      v_need := v.quantity_l;
      for t in select x from unnest(case when v_req.milk_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[v_req.milk_type] end) x loop
        exit when v_need <= 0;
        v_take := least(v_need, greatest(public.milk_fresh_at(v.area_manager_id, t, now(), v_grade), 0));
        if v_take > 0 then
          insert into bulk_order_milk (order_id, milk_type, litres) values (p_order, t, v_take);
          v_need := v_need - v_take;
        end if;
      end loop;
      update public.bulk_orders set dispatch_quality = v_stock where id = p_order;
$new$;
    d := replace(d, a, b);
    -- drop the old block that saved the device reading
    d := regexp_replace(d, '      update public\.bulk_orders set dispatch_reading_id = v_r\.id,.*?where id = p_order;\n', '', 's');
    d := replace(d, '  v_ai          jsonb;', '  v_ai          jsonb;' || chr(10) || '  v_grade       quality_grade;' || chr(10) || '  v_stock       jsonb;');
    execute d;
  end if;
end $$;

-- the order records its own litres (and how much tested stock there was)
do $$
declare d text;
begin
  select pg_get_functiondef('public.update_bulk_order(uuid,bulk_order_status,text,uuid)'::regprocedure) into d;
  if position('set dispatch_quality = v_stock where id = p_order' in d) > 0 then
    d := replace(d, 'set dispatch_quality = v_stock where id = p_order',
                    'set dispatch_quality = v_stock || jsonb_build_object(''litres'', v.quantity_l, ''stock_l'', v_stock->''litres'', ''dispatched_at'', now()) where id = p_order');
    execute d;
  end if;
end $$;

-- everyone sees the grade each offer really is
create or replace view public.public_bids as
 select b.id,
    b.requirement_id,
    a.center_name,
    a.city as center_city,
    b.price_per_l,
    b.quantity_l,
    b.delivery_date,
    b.max_age_hours,
    b.status,
    b.updated_at,
    b.offered_quality
   from bids b
     join area_managers a on a.id = b.area_manager_id
     join bulk_requirements r on r.id = b.requirement_id
  where b.status in ('submitted', 'accepted') and r.status in ('open', 'awarded');
