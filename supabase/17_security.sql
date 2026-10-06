-- 17: closing loopholes found in the full review
-- run after 16_farmer_answer.sql (safe to run again).

-- ---------- 1. one requirement can have several orders (split between centers) ----------
alter table public.bulk_orders drop constraint if exists bulk_orders_requirement_id_key;
alter table public.bulk_orders add column if not exists cancelled_by text check (cancelled_by in ('center', 'business'));

-- ---------- 2. farmer app accounts: linked by phone, as before ----------
-- the area manager adds farmers; a farmer who signs up in the app with the same phone is linked automatically.
-- only that automatic link can set profile_id, so a center cannot link a farmer record to its own account.
alter table public.farmers drop column if exists link_request;
drop function if exists public.confirm_farmer_link(uuid, boolean);

create or replace function public.link_farmer_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.profile_id := null;
  elsif new.profile_id is distinct from old.profile_id and coalesce(current_setting('apnadairy.farmer_link', true), '') <> 'on' then
    new.profile_id := old.profile_id;
  end if;
  -- link to the farmer app account with the same phone
  if new.profile_id is null and coalesce(new.phone, '') <> '' then
    select id into new.profile_id from profiles
     where role = 'farmer' and public.norm_phone(phone) = public.norm_phone(new.phone) limit 1;
  end if;
  return new;
end;
$$;
drop trigger if exists farmers_link_profile on public.farmers;
create trigger farmers_link_profile before insert or update on public.farmers
  for each row execute function public.link_farmer_profile();

create or replace function public.link_my_farmer_records()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_phone text; v_n integer;
begin
  select phone into v_phone from profiles where id = auth.uid() and role = 'farmer';
  if coalesce(v_phone, '') = '' then raise exception 'add your phone number to your profile first'; end if;
  perform set_config('apnadairy.farmer_link', 'on', true);
  update farmers set profile_id = auth.uid()
   where profile_id is null and public.norm_phone(phone) = public.norm_phone(v_phone);
  get diagnostics v_n = row_count;
  perform set_config('apnadairy.farmer_link', 'off', true);
  return v_n;
end;
$$;

-- ---------- 3. a center cannot mark its own bill paid ----------
-- the center sends its transaction id; the super admin checks the money arrived and confirms
alter table public.center_invoices add column if not exists submitted_at timestamptz;

create or replace function public.pay_invoice(p_invoice uuid, p_method text, p_ref text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.center_invoices;
begin
  select * into v from center_invoices where id = p_invoice for update;
  if v.id is null then raise exception 'invoice not found'; end if;
  if v.status <> 'due' then raise exception 'this invoice is not due'; end if;
  if p_method not in ('jazzcash', 'easypaisa', 'bank', 'cash') then raise exception 'choose a payment method'; end if;

  if public.is_admin() then
    -- the admin confirms a payment the center sent, or records cash paid at the office
    if p_method <> 'cash' and coalesce(trim(p_ref), '') = '' then raise exception 'enter the transaction id'; end if;
    update center_invoices set status = 'paid', paid_at = now(), payment_method = p_method,
           payment_ref = nullif(trim(p_ref), '') where id = p_invoice;
  elsif v.area_manager_id = public.my_milk_center_id() then
    if p_method = 'cash' then raise exception 'cash is paid at the ApnaDairy office, which records it for you'; end if;
    if coalesce(trim(p_ref), '') = '' then raise exception 'enter the transaction id'; end if;
    update center_invoices set submitted_at = now(), payment_method = p_method, payment_ref = trim(p_ref) where id = p_invoice;
  else
    raise exception 'not allowed';
  end if;
end;
$$;

create or replace view public.admin_billing with (security_invoker = true) as
  select i.id, i.area_manager_id, i.kind, i.period_month, i.description, i.device_fee, i.subscription_fee, i.tier,
         i.discount_pct, i.sales_basis, i.online_sales, i.commission_pct, i.commission, i.amount, i.status, i.issued_at,
         i.due_date, i.paid_at, i.payment_method, i.payment_ref, i.is_sample, a.center_name, a.city, i.submitted_at
  from center_invoices i join area_managers a on a.id = i.area_manager_id;

-- ---------- 4. prices and amounts must be real numbers ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collection_price_is_number') then
    alter table public.milk_collections add constraint collection_price_is_number
      check (price_per_l is null or (price_per_l <> 'NaN' and price_per_l > 0)) not valid;
    alter table public.milk_collections add constraint collection_total_is_number
      check (total_amount is null or total_amount <> 'NaN') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'product_price_is_number') then
    alter table public.products add constraint product_price_is_number check (price <> 'NaN' and price > 0) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'bid_price_is_number') then
    alter table public.bids add constraint bid_price_is_number check (price_per_l <> 'NaN' and quantity_l <> 'NaN') not valid;
  end if;
end $$;

-- ---------- 5. verification documents must really be uploaded ----------
create or replace function public.has_required_docs(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  with d as (
    select v.doc_type from verification_documents v
    where v.user_id = p_user and split_part(v.file_path, '/', 1) = p_user::text
      and exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.file_path)
  )
  select exists (select 1 from d where doc_type = 'cnic_front')
     and exists (select 1 from d where doc_type in ('business_registration', 'ntn_certificate', 'bank_statement', 'utility_bill', 'shop_photo'));
$$;
drop policy if exists "docs: insert own" on public.verification_documents;
create policy "docs: insert own" on public.verification_documents for insert
  with check (user_id = auth.uid() and split_part(file_path, '/', 1) = auth.uid()::text);

-- ---------- 6. sample data and dates cannot be faked by a real center ----------
create or replace function public.guard_sample_rows()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.is_sample and not exists (select 1 from area_managers where id = new.area_manager_id and is_demo) then
    raise exception 'sample data is only for demo accounts';
  end if;
  if tg_table_name = 'products' and tg_op = 'UPDATE' and new.milk_type is distinct from old.milk_type then
    raise exception 'the milk type of a listing cannot change. create a new listing instead';
  end if;
  if tg_table_name = 'milk_usage' and tg_op = 'INSERT' and not new.is_sample then
    new.created_at := now();   -- stock taken out is recorded at the real time
  end if;
  return new;
end;
$$;
drop trigger if exists products_guard_sample on public.products;
create trigger products_guard_sample before insert or update on public.products
  for each row execute function public.guard_sample_rows();
drop trigger if exists milk_usage_guard_sample on public.milk_usage;
create trigger milk_usage_guard_sample before insert on public.milk_usage
  for each row execute function public.guard_sample_rows();

create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null or not exists (select 1 from area_managers where id = v_center and is_demo) then
    raise exception 'only demo accounts have sample data';
  end if;
  update farmers f set is_sample = false
   where f.area_manager_id = v_center and f.is_sample
     and exists (select 1 from milk_collections m where m.farmer_id = f.id and not m.is_sample);
  delete from shop_reviews     where area_manager_id = v_center and is_sample;
  delete from center_invoices  where area_manager_id = v_center and is_sample;
  delete from shop_orders      where area_manager_id = v_center and is_sample;
  delete from milk_usage       where area_manager_id = v_center and is_sample;
  delete from milk_collections where area_manager_id = v_center and is_sample;
  delete from products         where area_manager_id = v_center and is_sample;
  delete from farmers          where area_manager_id = v_center and is_sample;
end;
$$;

-- ---------- 7. listing litres: cancelling an order always gives the litres back ----------
create or replace function public.check_listing_litres()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_left numeric;
begin
  if new.category <> 'milk' or (tg_op = 'INSERT' and new.is_sample) then return new; end if;
  if coalesce(current_setting('apnadairy.order_restore', true), '') = 'on' then return new; end if;
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
    v_msg := public.check_delivery_code('shop', p_id, p_code);
    if v_msg is not null then return v_msg; end if;
    update shop_orders set status = 'delivered', delivered_at = now() where id = p_id;
  elsif p_status = 'cancelled' and v.status in ('pending', 'preparing') then
    update shop_orders set status = 'cancelled' where id = p_id;
    -- the litres go back on the listing; the listing still never shows more than the fresh milk in stock
    perform set_config('apnadairy.order_restore', 'on', true);
    update products pr set listed_l = coalesce(pr.listed_l, 0) + i.quantity
      from shop_order_items i where i.order_id = p_id and i.product_id = pr.id and pr.category = 'milk';
    perform set_config('apnadairy.order_restore', 'off', true);
  else
    raise exception 'this change is not allowed for the current order status';
  end if;
  return null;
end;
$$;

-- ---------- 8. order size counts the whole order ----------
do $$
declare d text;
begin
  select pg_get_functiondef('public.place_shop_order(jsonb, text, text)'::regprocedure) into d;
  if position('v_sum' in d) = 0 then
    d := replace(d, 'v_total numeric := 0;', 'v_total numeric := 0;' || chr(10) || '  v_sum   numeric := 0;');
    d := replace(d, '  update shop_orders set total_amount = v_total where id = v_order;',
      '  if v_sum > v_set.order_max_l then' || chr(10) ||
      '    raise exception ''you can order at most % L of milk in one order'', rtrim(rtrim(v_set.order_max_l::text, ''0''), ''.'');' || chr(10) ||
      '  end if;' || chr(10) ||
      '  update shop_orders set total_amount = v_total where id = v_order;');
    d := replace(d, '    v_total := v_total + v_qty * v_l.price_per_l;', '    v_total := v_total + v_qty * v_l.price_per_l;' || chr(10) || '    v_sum := v_sum + v_qty;');
    execute d;
  end if;
end $$;

-- ---------- 9. a center cancelling a bulk order: the buyer can get bids again, and it shows on the center's record ----------
do $$
declare d text;
begin
  select pg_get_functiondef('public.update_bulk_order(uuid, bulk_order_status, text)'::regprocedure) into d;
  if position('cancelled_by' in d) = 0 then
    d := replace(d,
      '    update public.bulk_orders set status = ''cancelled'' where id = p_order;',
      '    update public.bulk_orders set status = ''cancelled'', cancelled_by = case when v_is_center then ''center'' else ''business'' end where id = p_order;' || chr(10) ||
      '    -- the litres are needed again: reopen the requirement for a few more hours of bidding' || chr(10) ||
      '    update public.bulk_requirements r set status = ''open'',' || chr(10) ||
      '           bid_deadline = greatest(r.bid_deadline, least(now() + interval ''12 hours'', (r.required_date::timestamp + interval ''23 hours'') at time zone ''Asia/Karachi''))' || chr(10) ||
      '     where r.id = v.requirement_id and r.status in (''awarded'', ''open'') and r.required_date >= (now() at time zone ''Asia/Karachi'')::date;');
    execute d;
  end if;
end $$;

drop function if exists public.center_track_record(uuid[]);
create or replace function public.center_track_record(p_centers uuid[])
returns table (center_id uuid, tests_30d bigint, pass_pct integer, premium_pct integer,
               orders_delivered bigint, on_time_pct integer, rating numeric, ratings bigint, cancelled_by_center bigint)
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
    (select count(*) from bulk_reviews r where r.area_manager_id = a.id),
    (select count(*) from bulk_orders o where o.area_manager_id = a.id and o.cancelled_by = 'center')
  from area_managers a
  where a.id = any(p_centers)
    and (public.my_business_id() is not null or public.my_milk_center_id() is not null or public.is_admin());
$$;

-- ---------- 10. small exposures ----------
revoke execute on function public.has_required_docs(uuid), public.base_role(uuid) from public, anon;
grant execute on function public.has_required_docs(uuid), public.base_role(uuid) to authenticated;

revoke execute on function public.link_farmer_profile(), public.guard_sample_rows() from public, anon, authenticated;
revoke execute on function public.center_track_record(uuid[]),
  public.pay_invoice(uuid, text, text), public.clear_sample_data() from public, anon;
grant execute on function public.center_track_record(uuid[]),
  public.pay_invoice(uuid, text, text), public.clear_sample_data(), public.link_my_farmer_records() to authenticated;
