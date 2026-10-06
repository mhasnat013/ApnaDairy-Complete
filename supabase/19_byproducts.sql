-- 19: byproduct sellers (desi ghee, butter, yogurt, cheese, lassi, cream)
-- run after 18_admins.sql (safe to run again).
--
-- a byproduct seller has no iot device and no milk collection. they list products for customers in the app
-- and bid on byproduct requirements from businesses. they pay only the monthly platform fee.

alter type public.product_category add value if not exists 'cheese';

-- ---------- who is calling ----------
create or replace function public.my_seller_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select a.id from public.area_managers a join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and a.verification_status = 'active' and p.status = 'active';
$$;
create or replace function public.my_byproduct_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select a.id from public.area_managers a join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid() and a.type = 'byproduct' and a.verification_status = 'active' and p.status = 'active';
$$;
grant execute on function public.my_seller_id(), public.my_byproduct_id() to authenticated;

-- 30.00 -> 30, 2.50 -> 2.5 in messages
create or replace function public.fmt_qty(p numeric)
returns text language sql immutable as $$ select rtrim(rtrim(round(p, 2)::text, '0'), '.') $$;

-- ---------- shared tables: any approved seller, not only milk centers ----------
do $$
declare r record; q text;
begin
  for r in select schemaname, tablename, policyname, qual, with_check from pg_policies
           where (schemaname = 'public' and tablename in ('bids', 'bulk_orders', 'bulk_reviews', 'center_invoices', 'products',
                    'shop_order_items', 'shop_orders', 'shop_photos', 'shop_profiles', 'business_profiles'))
              or (schemaname = 'storage' and policyname like 'shop photos storage%')
  loop
    if coalesce(r.qual, '') || coalesce(r.with_check, '') like '%my_milk_center_id%' then
      q := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if r.qual is not null then q := q || ' using (' || replace(r.qual, 'my_milk_center_id()', 'my_seller_id()') || ')'; end if;
      if r.with_check is not null then q := q || ' with check (' || replace(r.with_check, 'my_milk_center_id()', 'my_seller_id()') || ')'; end if;
      execute q;
    end if;
  end loop;
end $$;

drop policy if exists "requirements: read" on public.bulk_requirements;
create policy "requirements: read" on public.bulk_requirements for select
  using (business_id = public.my_business_id() or public.is_admin()
         or (public.my_seller_id() is not null and status <> 'cancelled'));

alter table public.products alter column area_manager_id set default public.my_seller_id();

-- functions that work the same for every seller
do $$
declare f text; d text;
begin
  foreach f in array array['public.billing_overview()', 'public.pay_invoice(uuid,text,text)', 'public.withdraw_bid(uuid)',
                           'public.reply_review(uuid,text)', 'public.demo_delivery_code(text,uuid)',
                           'public.update_shop_order(uuid,shop_order_status,text)'] loop
    select pg_get_functiondef(f::regprocedure) into d;
    if position('my_milk_center_id' in d) > 0 then
      d := replace(d, 'public.my_milk_center_id()', 'public.my_seller_id()');
      d := replace(d, 'only a verified milk center has billing', 'only an approved seller has billing');
      execute d;
    end if;
  end loop;
end $$;

-- milk centers sell fresh milk, byproduct sellers everything else
create or replace function public.check_center_product()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_type area_manager_type;
begin
  select type into v_type from area_managers where id = new.area_manager_id;
  if new.category <> 'milk' and v_type = 'milk_center' then raise exception 'milk centers list fresh milk only'; end if;
  if new.category = 'milk' and v_type = 'byproduct' then raise exception 'byproduct sellers list dairy products, not fresh milk'; end if;
  if new.category <> 'milk' then
    if new.stock_qty is null or new.stock_qty < 0 then raise exception 'say how much you have in stock'; end if;
    if new.unit not in ('kg', 'litre', 'pack') then raise exception 'unit must be kg, litre or pack'; end if;
    if new.expires_on is not null and new.made_on is not null and new.expires_on < new.made_on then
      raise exception 'the expiry date is before the date it was made';
    end if;
  end if;
  return new;
end;
$$;

-- checked before anything else on a product (trigger names run in order)
drop trigger if exists products_milk_centers_sell_milk on public.products;
drop trigger if exists products_0_seller_type on public.products;
create trigger products_0_seller_type before insert or update on public.products
  for each row execute function public.check_center_product();

-- ---------- billing: byproduct sellers pay the monthly fee only ----------
create or replace function public.on_center_approved()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare s public.platform_settings;
begin
  if new.verification_status = 'active' and old.verification_status is distinct from 'active' then
    select * into s from platform_settings;
    if new.type = 'milk_center' and not exists (select 1 from center_invoices where area_manager_id = new.id and kind = 'device' and status <> 'void') then
      insert into center_invoices (area_manager_id, kind, description, device_fee, amount, due_date)
      values (new.id, 'device', 'ApnaDairy IoT milk tester (one-time)', s.device_price, s.device_price,
              (now() at time zone 'Asia/Karachi')::date + s.payment_days);
    end if;
    perform public.bill_center_month(new.id, (now() at time zone 'Asia/Karachi')::date);
  end if;
  return new;
end;
$$;

create or replace function public.generate_monthly_invoices(p_month date default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, (now() at time zone 'Asia/Karachi')::date))::date;
  v_count integer := 0;
  c record;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  for c in select a.id from area_managers a join profiles p on p.id = a.user_id
           where a.verification_status = 'active' and p.status = 'active' loop
    if not exists (select 1 from center_invoices where area_manager_id = c.id and kind = 'monthly' and period_month = v_month and status <> 'void') then
      perform public.bill_center_month(c.id, v_month);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- byproduct sellers approved before this file have no monthly bill yet
do $$
declare c record;
begin
  for c in select a.id from area_managers a where a.type = 'byproduct' and a.verification_status = 'active' loop
    perform public.bill_center_month(c.id, (now() at time zone 'Asia/Karachi')::date);
  end loop;
end $$;

-- ---------- shops and products in the customer app ----------
create or replace view public.public_shops as
  select a.id, a.center_name, a.city, a.address, a.latitude, a.longitude, s.tagline, s.description, s.opening_hours,
         s.whatsapp, s.phone, s.delivery_radius_km,
         (select ph.path from shop_photos ph where ph.area_manager_id = a.id order by ph.sort, ph.created_at limit 1) as cover_path,
         coalesce((select json_agg(ph.path order by ph.sort, ph.created_at) from shop_photos ph where ph.area_manager_id = a.id), '[]'::json) as photos,
         (select round(avg(r.rating), 1) from shop_reviews r where r.area_manager_id = a.id) as rating,
         (select count(*) from shop_reviews r where r.area_manager_id = a.id)::integer as review_count,
         a.verified_at as member_since,
         a.type as seller_type
  from area_managers a join profiles p on p.id = a.user_id left join shop_profiles s on s.area_manager_id = a.id
  where a.verification_status = 'active' and p.status = 'active';

create or replace view public.public_products as
  select pr.id, pr.area_manager_id as shop_id, sh.center_name as shop_name, sh.city, sh.rating, sh.review_count, sh.cover_path,
         pr.name, pr.category, pr.milk_type, pr.unit, pr.description, pr.price as list_price, pr.discount_pct,
         round(pr.price * (100 - pr.discount_pct) / 100.0) as price,
         greatest(coalesce(pr.stock_qty, 0), 0) as available_qty, pr.made_on, pr.expires_on, pr.created_at
  from products pr join public_shops sh on sh.id = pr.area_manager_id
  where pr.category <> 'milk' and pr.is_available and coalesce(pr.stock_qty, 0) > 0
    and (pr.expires_on is null or pr.expires_on >= (now() at time zone 'Asia/Karachi')::date);
grant select on public.public_shops, public.public_products to anon, authenticated;

-- customers order milk and dairy products; each item uses up its stock
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
  v_sum   numeric := 0;
  v_price numeric;
  v_name  text;
begin
  if auth.uid() is null then raise exception 'sign in to order'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'add at least one item'; end if;
  if coalesce(trim(p_address), '') = '' then raise exception 'enter a delivery address'; end if;
  select * into v_set from platform_settings;
  select full_name into v_name from profiles where id = auth.uid();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item->>'quantity')::numeric;
    select * into v_p from products where id = coalesce(v_item->>'listing_id', v_item->>'product_id')::uuid;
    if v_p.id is null or not v_p.is_available then raise exception 'this item is no longer on sale'; end if;
    if v_qty is null or v_qty = 'NaN' or v_qty <= 0 then raise exception 'enter how much you want'; end if;
    if v_shop is null then
      v_shop := v_p.area_manager_id;
      insert into shop_orders (area_manager_id, customer_id, customer_name, customer_phone, channel, delivery_address, status)
      values (v_shop, auth.uid(), coalesce(v_name, 'Customer'), p_phone, 'app', trim(p_address), 'pending')
      returning id into v_order;
    elsif v_p.area_manager_id <> v_shop then
      raise exception 'order from one shop at a time';
    end if;

    if v_p.category = 'milk' then
      perform public.lock_milk(v_p.area_manager_id, v_p.milk_type);    -- wait for any other order of this milk
      select * into v_p from products where id = v_p.id for update;
      select * into v_l from public_listings where id = v_p.id;
      if v_l.id is null then raise exception 'this milk is no longer on sale'; end if;
      if v_qty < v_set.order_min_l or v_qty > v_set.order_max_l then
        raise exception 'you can order % to % L of milk at a time', rtrim(rtrim(v_set.order_min_l::text, '0'), '.'), rtrim(rtrim(v_set.order_max_l::text, '0'), '.');
      end if;
      if v_qty > v_l.available_l then raise exception 'only % L of % milk is left', rtrim(rtrim(v_l.available_l::text, '0'), '.'), v_l.milk_type; end if;
      insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
      values (v_order, v_l.id, v_l.name, 'milk', v_l.milk_type, 'litre', v_qty, v_l.price_per_l);
      update products set listed_l = greatest(coalesce(listed_l, v_l.available_l) - v_qty, 0) where id = v_p.id;
      v_total := v_total + v_qty * v_l.price_per_l;
      v_sum := v_sum + v_qty;
    else
      select * into v_p from products where id = v_p.id for update;    -- one order at a time takes this stock
      if v_p.expires_on is not null and v_p.expires_on < (now() at time zone 'Asia/Karachi')::date then raise exception '% has expired', v_p.name; end if;
      if v_p.unit = 'pack' and v_qty <> trunc(v_qty) then raise exception 'order whole packs of %', v_p.name; end if;
      if v_qty > coalesce(v_p.stock_qty, 0) then
        raise exception 'only % % of % is left', public.fmt_qty(coalesce(v_p.stock_qty, 0)), v_p.unit, v_p.name;
      end if;
      v_price := round(v_p.price * (100 - v_p.discount_pct) / 100.0);
      insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
      values (v_order, v_p.id, v_p.name, v_p.category, v_p.milk_type, v_p.unit, v_qty, v_price);
      update products set stock_qty = stock_qty - v_qty where id = v_p.id;
      v_total := v_total + v_qty * v_price;
    end if;
  end loop;

  if v_sum > v_set.order_max_l then
    raise exception 'you can order at most % L of milk in one order', rtrim(rtrim(v_set.order_max_l::text, '0'), '.');
  end if;
  update shop_orders set total_amount = v_total where id = v_order;
  return v_order;
end;
$$;

create or replace function public.update_shop_order(p_id uuid, p_status shop_order_status, p_code text default null)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.shop_orders; v_msg text;
begin
  select * into v from shop_orders where id = p_id for update;
  if v.id is null or v.area_manager_id is distinct from public.my_seller_id() then raise exception 'order not found'; end if;

  if (v.status, p_status) in (('pending', 'preparing'), ('preparing', 'out_for_delivery')) then
    update shop_orders set status = p_status where id = p_id;
  elsif v.status = 'out_for_delivery' and p_status = 'delivered' then
    v_msg := public.check_delivery_code('shop', p_id, p_code);
    if v_msg is not null then return v_msg; end if;
    update shop_orders set status = 'delivered', delivered_at = now() where id = p_id;
  elsif p_status = 'cancelled' and v.status in ('pending', 'preparing') then
    update shop_orders set status = 'cancelled' where id = p_id;
    -- milk litres go back on the listing, products back into stock
    perform set_config('apnadairy.order_restore', 'on', true);
    update products pr set listed_l = coalesce(pr.listed_l, 0) + i.quantity
      from shop_order_items i where i.order_id = p_id and i.product_id = pr.id and pr.category = 'milk';
    perform set_config('apnadairy.order_restore', 'off', true);
    update products pr set stock_qty = coalesce(pr.stock_qty, 0) + i.quantity
      from shop_order_items i where i.order_id = p_id and i.product_id = pr.id and pr.category <> 'milk';
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- ---------- bulk market for byproducts ----------
alter table public.bulk_requirements add column if not exists product public.product_category not null default 'milk';
alter table public.bulk_requirements add column if not exists unit text not null default 'litre';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requirement_unit') then
    alter table public.bulk_requirements add constraint requirement_unit
      check ((product = 'milk' and unit = 'litre') or (product <> 'milk' and unit in ('kg', 'litre', 'pack')));
  end if;
end $$;
alter table public.bids add column if not exists make_qty numeric(10,2) not null default 0 check (make_qty >= 0);

-- milk requirements go to milk centers, byproduct requirements to byproduct sellers
create or replace view public.request_board as
  select r.id, r.milk_type, r.quantity_l, r.required_date, r.delivery_city, r.delivery_address, r.quality,
         r.target_price, r.bid_deadline, r.notes, r.status, r.created_at, b.business_name, b.business_type,
         (select count(*) from bids x where x.requirement_id = r.id and x.status = 'submitted')::integer as bid_count,
         (select min(x.price_per_l) from bids x where x.requirement_id = r.id and x.status = 'submitted') as lowest_offer,
         r.quantity_l - public.requirement_covered(r.id) as remaining_l,
         r.product, r.unit
  from bulk_requirements r join business_profiles b on b.id = r.business_id
  where r.status = 'open' and r.bid_deadline > now()
    and r.required_date >= (now() at time zone 'Asia/Karachi')::date
    and ((r.product = 'milk' and public.my_milk_center_id() is not null)
      or (r.product <> 'milk' and public.my_byproduct_id() is not null)
      or public.is_admin());
grant select on public.request_board to authenticated;

-- what a byproduct seller can promise from stock: stock of that product minus what other bids and orders take from stock
create or replace function public.product_capacity(p_seller uuid, p_product product_category, p_skip_requirement uuid default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with st as (
    select coalesce(sum(greatest(stock_qty, 0)), 0) as stock from products
    where area_manager_id = p_seller and category = p_product
      and (expires_on is null or expires_on >= (now() at time zone 'Asia/Karachi')::date)
  ),
  pr as (
    select coalesce(sum(greatest(b.quantity_l - b.make_qty, 0)), 0) as promised
    from bids b join bulk_requirements r on r.id = b.requirement_id
    where b.area_manager_id = p_seller and r.product = p_product and b.requirement_id is distinct from p_skip_requirement
      and ((b.status = 'submitted' and r.status = 'open')
        or exists (select 1 from bulk_orders o where o.bid_id = b.id and o.status = 'confirmed'))
  )
  select jsonb_build_object('stock', st.stock, 'promised', pr.promised, 'available', greatest(st.stock - pr.promised, 0))
  from st, pr;
$$;

drop function if exists public.place_bid(uuid, numeric, numeric, date, integer, text);
create or replace function public.place_bid(
  p_requirement   uuid,
  p_price         numeric,
  p_quantity      numeric,
  p_delivery_date date,
  p_max_age_hours integer default null,
  p_notes         text default null,
  p_make          numeric default 0
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_req    public.bulk_requirements;
  v_center uuid;
  v_left   numeric;
  v_cap    jsonb;
  v_make   numeric := coalesce(p_make, 0);
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
    v_cap := public.bulk_capacity(v_center, v_req.milk_type, p_delivery_date, p_requirement);
    if p_quantity > (v_cap->>'max_l')::numeric then
      raise exception 'you can supply about % L of % milk on that day (fresh stock % L + collection % L, minus % L already promised)',
        v_cap->>'max_l', v_req.milk_type, v_cap->>'stock_l', v_cap->>'coming_l', v_cap->>'promised_l';
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

  insert into public.bids (requirement_id, area_manager_id, price_per_l, quantity_l, delivery_date, max_age_hours, notes, make_qty)
  values (p_requirement, v_center, p_price, p_quantity, p_delivery_date, p_max_age_hours, p_notes, v_make)
  on conflict (requirement_id, area_manager_id) do update
     set price_per_l = excluded.price_per_l, quantity_l = excluded.quantity_l, delivery_date = excluded.delivery_date,
         max_age_hours = excluded.max_age_hours, notes = excluded.notes, make_qty = excluded.make_qty,
         status = 'submitted', updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

-- accepting checks again that the seller can still supply it
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
  if v_req.product = 'milk' then
    perform public.lock_milk(v_bid.area_manager_id, v_req.milk_type);
    v_cap := public.bulk_capacity(v_bid.area_manager_id, v_req.milk_type, v_bid.delivery_date, v_req.id);
    if v_qty > (v_cap->>'max_l')::numeric then
      raise exception '% can now supply only about % L for that day. pick another bid, or ask them to bid again', v_name, v_cap->>'max_l';
    end if;
  else
    v_cap := public.product_capacity(v_bid.area_manager_id, v_req.product, v_req.id);
    if v_qty - least(v_bid.make_qty, v_qty) > (v_cap->>'available')::numeric then
      raise exception '% no longer has enough in stock for this bid. pick another bid, or ask them to bid again', v_name;
    end if;
  end if;

  update public.bids set status = 'accepted', updated_at = now() where id = v_bid.id;
  insert into public.bulk_orders (requirement_id, bid_id, business_id, area_manager_id, quantity_l,
                                  price_per_l, delivery_date, delivery_city, delivery_address)
  values (v_req.id, v_bid.id, v_req.business_id, v_bid.area_manager_id, v_qty,
          v_bid.price_per_l, v_bid.delivery_date, v_req.delivery_city, v_req.delivery_address)
  returning id into v_order;

  if v_left - v_qty <= 0 then
    update public.bulk_requirements set status = 'awarded' where id = v_req.id;
    update public.bids set status = 'not_selected', updated_at = now() where requirement_id = v_req.id and status = 'submitted';
  end if;
  return v_order;
end;
$$;

-- dispatch takes the goods out of stock; milk from fresh milk, products from product stock
create or replace function public.update_bulk_order(p_order uuid, p_status bulk_order_status, p_code text default null)
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
    else
      select coalesce(sum(stock_qty), 0) into v_left from products
       where area_manager_id = v.area_manager_id and category = v_req.product
         and (expires_on is null or expires_on >= (now() at time zone 'Asia/Karachi')::date);
      if v_left < v.quantity_l then
        raise exception 'only % % is in stock, % % is needed. update your stock on the products page first', public.fmt_qty(v_left), v_req.unit, public.fmt_qty(v.quantity_l), v_req.unit;
      end if;
      v_need := v.quantity_l;
      -- the oldest stock goes first
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
    -- the order is needed again: reopen the requirement for a few more hours of bidding
    update public.bulk_requirements r set status = 'open',
           bid_deadline = greatest(r.bid_deadline, least(now() + interval '12 hours', (r.required_date::timestamp + interval '23 hours') at time zone 'Asia/Karachi'))
     where r.id = v.requirement_id and r.status in ('awarded', 'open') and r.required_date >= (now() at time zone 'Asia/Karachi')::date;
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- the seller's own capacity, for the bid form
create or replace function public.my_product_capacity(p_product product_category, p_requirement uuid default null)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.product_capacity(public.my_byproduct_id(), p_product, p_requirement) where public.my_byproduct_id() is not null;
$$;

-- ---------- who may call what ----------
revoke execute on function public.product_capacity(uuid, public.product_category, uuid) from public, anon, authenticated;
revoke execute on function public.place_bid(uuid, numeric, numeric, date, integer, text, numeric), public.my_product_capacity(public.product_category, uuid),
  public.accept_bid(uuid), public.update_bulk_order(uuid, bulk_order_status, text), public.place_shop_order(jsonb, text, text),
  public.update_shop_order(uuid, shop_order_status, text) from public, anon;
grant execute on function public.place_bid(uuid, numeric, numeric, date, integer, text, numeric), public.my_product_capacity(public.product_category, uuid),
  public.accept_bid(uuid), public.update_bulk_order(uuid, bulk_order_status, text), public.place_shop_order(jsonb, text, text),
  public.update_shop_order(uuid, shop_order_status, text) to authenticated;

-- the public request board shows what is needed: milk or a dairy product
create or replace view public.public_requests as
  select r.id, r.milk_type, r.quantity_l, r.required_date, r.delivery_city, r.quality, r.target_price, r.bid_deadline,
         r.created_at, b.business_type,
         (select count(*) from bids x where x.requirement_id = r.id and x.status = 'submitted')::integer as bid_count,
         (select min(x.price_per_l) from bids x where x.requirement_id = r.id and x.status = 'submitted') as lowest_offer,
         r.product, r.unit, r.quantity_l - public.requirement_covered(r.id) as remaining_l
  from bulk_requirements r join business_profiles b on b.id = r.business_id
  where r.status = 'open' and r.bid_deadline > now() and r.required_date >= (now() at time zone 'Asia/Karachi')::date;
grant select on public.public_requests to anon, authenticated;
