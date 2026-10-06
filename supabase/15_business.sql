-- 15: business portal, final rules
-- run after 14_manager_admin.sql (safe to run again).
--
-- 1. a requirement can be covered by several bids: it stays open until its litres are covered
-- 2. accepting a bid checks again that the center can still supply that milk on that day
-- 3. requirements need a future date and deadline; old ones stop taking bids
-- 4. track record of every center (ai test results, on-time delivery, ratings) shown next to its bid
-- 5. after delivery the business rates the center, 1 to 5 stars

-- ---------- 1. litres already ordered on a requirement ----------
create or replace function public.requirement_covered(p_requirement uuid)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(quantity_l), 0) from bulk_orders where requirement_id = p_requirement and status <> 'cancelled';
$$;

-- ---------- 3. a new requirement must make sense ----------
create or replace function public.check_requirement()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.required_date < (now() at time zone 'Asia/Karachi')::date then raise exception 'the delivery date is in the past'; end if;
  if new.bid_deadline <= now() then raise exception 'bidding has to close in the future'; end if;
  if new.quantity_l > 50000 then raise exception 'a requirement can be at most 50,000 L'; end if;
  return new;
end;
$$;
drop trigger if exists bulk_requirements_check on public.bulk_requirements;
create trigger bulk_requirements_check before insert on public.bulk_requirements
  for each row execute function public.check_requirement();

-- ---------- 1 + 2. accept a bid, several per requirement ----------
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
  if v_req.business_id is distinct from public.my_business_id() then
    raise exception 'you can only accept bids on your own requirements';
  end if;
  if v_req.status <> 'open' then raise exception 'this requirement is already covered or was closed'; end if;
  if v_bid.delivery_date < (now() at time zone 'Asia/Karachi')::date then
    raise exception 'this bid was for delivery on %, which has passed', to_char(v_bid.delivery_date, 'FMDD Mon');
  end if;

  v_left := v_req.quantity_l - public.requirement_covered(v_req.id);
  if v_left <= 0 then raise exception 'your litres are already covered'; end if;
  v_qty := least(v_bid.quantity_l, v_left);

  -- the center may have promised its milk elsewhere since it bid
  select center_name into v_name from area_managers where id = v_bid.area_manager_id;
  perform public.lock_milk(v_bid.area_manager_id, v_req.milk_type);
  v_cap := public.bulk_capacity(v_bid.area_manager_id, v_req.milk_type, v_bid.delivery_date, v_req.id);
  if v_qty > (v_cap->>'max_l')::numeric then
    raise exception '% can now supply only about % L for that day. pick another bid, or ask them to bid again', v_name, v_cap->>'max_l';
  end if;

  update public.bids set status = 'accepted', updated_at = now() where id = v_bid.id;
  insert into public.bulk_orders (requirement_id, bid_id, business_id, area_manager_id, quantity_l,
                                  price_per_l, delivery_date, delivery_city, delivery_address)
  values (v_req.id, v_bid.id, v_req.business_id, v_bid.area_manager_id, v_qty,
          v_bid.price_per_l, v_bid.delivery_date, v_req.delivery_city, v_req.delivery_address)
  returning id into v_order;

  -- covered: close it and let the other centers know
  if v_left - v_qty <= 0 then
    update public.bulk_requirements set status = 'awarded' where id = v_req.id;
    update public.bids set status = 'not_selected', updated_at = now()
     where requirement_id = v_req.id and status = 'submitted';
  end if;
  return v_order;
end;
$$;

-- a business can stop a requirement; orders already placed on it stay
create or replace function public.cancel_requirement(p_requirement uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.bulk_requirements
     set status = case when public.requirement_covered(id) > 0 then 'closed'::requirement_status else 'cancelled'::requirement_status end
   where id = p_requirement and business_id = public.my_business_id() and status = 'open';
  if not found then raise exception 'only your open requirements can be cancelled'; end if;
  update public.bids set status = 'not_selected', updated_at = now()
   where requirement_id = p_requirement and status = 'submitted';
end;
$$;

-- bids: never more than the litres still needed, and an accepted bid cannot be changed
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
  v_left   numeric;
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
  if exists (select 1 from bids where requirement_id = p_requirement and area_manager_id = v_center and status = 'accepted') then
    raise exception 'the buyer already accepted your bid on this requirement';
  end if;
  if p_price is null or p_price <= 0 then raise exception 'enter your price per litre'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'enter the litres you can supply'; end if;
  v_left := v_req.quantity_l - public.requirement_covered(p_requirement);
  if p_quantity > v_left then raise exception 'only % L is still needed', round(v_left); end if;
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

-- the board shows what is still needed, and hides requirements whose date has passed
create or replace view public.request_board as
  select r.id, r.milk_type, r.quantity_l, r.required_date, r.delivery_city, r.delivery_address, r.quality,
         r.target_price, r.bid_deadline, r.notes, r.status, r.created_at, b.business_name, b.business_type,
         (select count(*) from bids x where x.requirement_id = r.id and x.status = 'submitted')::integer as bid_count,
         (select min(x.price_per_l) from bids x where x.requirement_id = r.id and x.status = 'submitted') as lowest_offer,
         r.quantity_l - public.requirement_covered(r.id) as remaining_l
  from bulk_requirements r join business_profiles b on b.id = r.business_id
  where r.status = 'open' and r.bid_deadline > now()
    and r.required_date >= (now() at time zone 'Asia/Karachi')::date
    and (public.my_milk_center_id() is not null or public.is_admin());

-- ---------- 5. ratings after delivery ----------
create table if not exists public.bulk_reviews (
  order_id        uuid primary key references public.bulk_orders(id) on delete cascade,
  business_id     uuid not null references public.business_profiles(id) on delete cascade,
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  rating          integer not null check (rating between 1 and 5),
  comment         text check (char_length(comment) <= 300),
  created_at      timestamptz not null default now()
);
alter table public.bulk_reviews enable row level security;
drop policy if exists "bulk reviews: read" on public.bulk_reviews;
create policy "bulk reviews: read" on public.bulk_reviews for select
  using (business_id = public.my_business_id() or area_manager_id = public.my_milk_center_id() or public.is_admin());

create or replace function public.rate_bulk_order(p_order uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v public.bulk_orders;
begin
  select * into v from bulk_orders where id = p_order;
  if v.id is null or v.business_id is distinct from public.my_business_id() then raise exception 'order not found'; end if;
  if v.status <> 'delivered' then raise exception 'you can rate an order once it is delivered'; end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'pick 1 to 5 stars'; end if;
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment)
  values (p_order, v.business_id, v.area_manager_id, p_rating, nullif(trim(p_comment), ''))
  on conflict (order_id) do update set rating = excluded.rating, comment = excluded.comment, created_at = now();
end;
$$;

-- ---------- 4. track record of centers, for the business comparing bids ----------
create or replace function public.center_track_record(p_centers uuid[])
returns table (center_id uuid, tests_30d bigint, pass_pct integer, premium_pct integer,
               orders_delivered bigint, on_time_pct integer, rating numeric, ratings bigint)
language sql stable security definer set search_path = public
as $$
  select a.id,
    (select count(*) from milk_collections m where m.area_manager_id = a.id and m.collected_at > now() - interval '30 days'),
    (select round(100.0 * count(*) filter (where coalesce(m.reject_reason, '') <> 'Failed the quality test') / nullif(count(*), 0))::integer
       from milk_collections m where m.area_manager_id = a.id and m.collected_at > now() - interval '30 days'),
    (select round(100.0 * count(*) filter (where m.quality = 'premium') / nullif(count(*) filter (where m.quality is not null), 0))::integer
       from milk_collections m where m.area_manager_id = a.id and m.collected_at > now() - interval '30 days'),
    (select count(*) from bulk_orders o where o.area_manager_id = a.id and o.status = 'delivered'),
    (select round(100.0 * count(*) filter (where (o.delivered_at at time zone 'Asia/Karachi')::date <= o.delivery_date) / nullif(count(*), 0))::integer
       from bulk_orders o where o.area_manager_id = a.id and o.status = 'delivered'),
    (select round(avg(r.rating), 1) from bulk_reviews r where r.area_manager_id = a.id),
    (select count(*) from bulk_reviews r where r.area_manager_id = a.id)
  from area_managers a
  where a.id = any(p_centers) and a.type = 'milk_center'
    and (public.my_business_id() is not null or public.my_milk_center_id() is not null or public.is_admin());
$$;

-- ---------- who may call what ----------
revoke execute on function public.check_requirement() from public, anon, authenticated;
revoke execute on function public.requirement_covered(uuid), public.accept_bid(uuid), public.cancel_requirement(uuid),
  public.place_bid(uuid, numeric, numeric, date, integer, text), public.rate_bulk_order(uuid, integer, text),
  public.center_track_record(uuid[]) from public, anon;
grant execute on function public.requirement_covered(uuid), public.accept_bid(uuid), public.cancel_requirement(uuid),
  public.place_bid(uuid, numeric, numeric, date, integer, text), public.rate_bulk_order(uuid, integer, text),
  public.center_track_record(uuid[]) to authenticated;
grant select on public.request_board to authenticated;
grant select on public.bulk_reviews to authenticated;
