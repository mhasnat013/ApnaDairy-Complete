-- =========================================================
-- apnadairy · farmer protection (step 2)
-- 1. only the farmer answers an offer, in the mobile app. the shop can cancel
--    its own offer but can no longer accept it for the farmer.
-- 2. payments: the shop sends a payment, the farmer confirms it in the app.
--    only then are those collections paid. disputed payments go back to unpaid.
-- 3. receipt numbers for every accepted collection and every confirmed payment.
-- 4. a collection can be cancelled or its litres corrected only with a reason,
--    and every change is kept in an audit log (the farmer re-accepts a correction).
-- 5. offers expire after 2 hours without an answer.
-- 6. the reading time is the server's clock; readings typed by hand are marked,
--    and need a reason while the iot device is active.
-- 7. milk taken out of stock can be added, undone within 15 minutes, never edited.
-- demo accounts get a clearly labelled "answer as farmer" so the flow can be shown
-- without the mobile app; real accounts never can.
-- run in supabase sql editor (after 09_trust_fixes.sql)
-- =========================================================

-- ---------- receipts ----------
create sequence public.collection_receipt_seq start 1001;
create sequence public.payout_receipt_seq start 501;

alter table public.milk_collections
  add column receipt_no    text unique,
  add column manual_reason text,
  add column payout_id     uuid,
  add column voided_at     timestamptz;

-- ---------- farmer payouts ----------
create type payout_status as enum ('sent', 'confirmed', 'disputed');

create table public.farmer_payouts (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  farmer_id       uuid not null references public.farmers(id) on delete cascade,
  amount          numeric(12,2) not null check (amount > 0),
  litres          numeric(10,2) not null,
  collections     integer not null,
  method          text not null check (method in ('cash', 'jazzcash', 'easypaisa', 'bank')),
  reference       text,
  status          payout_status not null default 'sent',
  receipt_no      text unique,
  farmer_note     text,
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  is_sample       boolean not null default false
);
create index on public.farmer_payouts (area_manager_id, created_at desc);
create index on public.farmer_payouts (farmer_id);
alter table public.milk_collections add constraint milk_collections_payout_fk foreign key (payout_id) references public.farmer_payouts(id) on delete set null;

alter table public.farmer_payouts enable row level security;
create policy "payouts: center, farmer or admin reads" on public.farmer_payouts
  for select using (
    area_manager_id = public.my_milk_center_id() or public.is_admin()
    or exists (select 1 from public.farmers f where f.id = farmer_id and f.profile_id = auth.uid())
  );
-- writes go through send_payout / farmer_answer_payout

-- ---------- audit log ----------
create table public.collection_audit (
  id              uuid primary key default gen_random_uuid(),
  collection_id   uuid not null references public.milk_collections(id) on delete cascade,
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  action          text not null check (action in ('cancelled', 'corrected', 'expired', 'usage_undone')),
  reason          text not null,
  before          jsonb,
  after           jsonb,
  actor           uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
create index on public.collection_audit (area_manager_id, created_at desc);
alter table public.collection_audit enable row level security;
create policy "audit: center or admin reads" on public.collection_audit
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());

-- a separate log for stock removals that were undone (they have no collection)
create table public.usage_audit (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  entry           jsonb not null,
  actor           uuid references public.profiles(id),
  created_at      timestamptz not null default now()
);
alter table public.usage_audit enable row level security;
create policy "usage audit: center or admin reads" on public.usage_audit
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());

-- ---------- linking a farmer's app account to their farmer record ----------
-- phones are compared as digits, with +92 / 92 written as 0
create or replace function public.norm_phone(p text)
returns text language sql immutable as $$
  select case when d like '92%' and length(d) = 12 then '0' || substr(d, 3) else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

create or replace function public.link_farmer_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.profile_id is null and coalesce(new.phone, '') <> '' then
    select id into new.profile_id from profiles
     where role = 'farmer' and public.norm_phone(phone) = public.norm_phone(new.phone) limit 1;
  end if;
  return new;
end;
$$;
create trigger farmers_link_profile before insert or update of phone on public.farmers
  for each row execute function public.link_farmer_profile();

-- the farmer app calls this after sign-up: claims farmer records registered with the same phone
create or replace function public.link_my_farmer_records()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_phone text; v_n integer;
begin
  select phone into v_phone from profiles where id = auth.uid() and role = 'farmer';
  if coalesce(v_phone, '') = '' then raise exception 'add your phone number to your profile first'; end if;
  update farmers set profile_id = auth.uid()
   where profile_id is null and public.norm_phone(phone) = public.norm_phone(v_phone);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ---------- offers expire after 2 hours ----------
create or replace function public.expire_offers(p_center uuid default null)
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_n integer := 0; c record;
begin
  for c in select id, area_manager_id from milk_collections
           where status = 'offered' and collected_at < now() - interval '2 hours'
             and (p_center is null or area_manager_id = p_center)
           for update loop
    update milk_collections set status = 'rejected', decided_at = now(), reject_reason = 'Offer expired, the farmer did not answer'
     where id = c.id;
    insert into collection_audit (collection_id, area_manager_id, action, reason)
    values (c.id, c.area_manager_id, 'expired', 'No answer within 2 hours');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- a center tidies its own expired offers (called when the collection page opens)
create or replace function public.expire_my_offers()
returns integer
language sql security definer set search_path = public
as $$ select public.expire_offers(public.my_milk_center_id()); $$;

-- ---------- accepting: only the farmer ----------
-- returns 'accepted', 'refused' or 'expired' (an expired offer is closed, not left open)
create or replace function public.accept_offer_internal(p_id uuid, p_accept boolean, p_reason text)
returns text
language plpgsql security definer set search_path = public
as $$
declare v public.milk_collections;
begin
  select * into v from milk_collections where id = p_id for update;
  if v.id is null then raise exception 'offer not found'; end if;
  if v.status <> 'offered' then raise exception 'this offer has already been answered'; end if;
  if v.collected_at < now() - interval '2 hours' then
    perform public.expire_offers(v.area_manager_id);
    return 'expired';
  end if;
  update milk_collections
     set status = case when p_accept then 'accepted'::collection_status else 'rejected'::collection_status end,
         decided_at = now(),
         reject_reason = case when p_accept then null else coalesce(nullif(trim(p_reason), ''), 'Farmer refused the price') end,
         receipt_no = case when p_accept then 'AD-C-' || lpad(nextval('collection_receipt_seq')::text, 6, '0') end
   where id = p_id;
  return case when p_accept then 'accepted' else 'refused' end;
end;
$$;
revoke execute on function public.accept_offer_internal(uuid, boolean, text) from public, anon, authenticated;

-- the farmer answers in the mobile app
drop function if exists public.decide_collection(uuid, boolean, text);
create or replace function public.decide_collection(p_id uuid, p_accept boolean, p_reason text default null)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from milk_collections m join farmers f on f.id = m.farmer_id
                 where m.id = p_id and f.profile_id = auth.uid()) then
    raise exception 'only the farmer can answer this offer, in the ApnaDairy app';
  end if;
  return public.accept_offer_internal(p_id, p_accept, p_reason);
end;
$$;

-- demo accounts only: answer as the farmer, so the flow can be shown without the app
create or replace function public.demo_farmer_answer(p_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from milk_collections m join area_managers a on a.id = m.area_manager_id
                 where m.id = p_id and a.id = public.my_milk_center_id() and a.is_demo) then
    raise exception 'only demo accounts can answer for a farmer';
  end if;
  return public.accept_offer_internal(p_id, p_accept, case when p_accept then null else 'Farmer refused the price (demo)' end);
end;
$$;

-- ---------- the shop cancels or corrects a collection, with a reason ----------
create or replace function public.cancel_collection(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.milk_collections;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'give a reason for cancelling'; end if;
  select * into v from milk_collections where id = p_id and area_manager_id = public.my_milk_center_id() for update;
  if v.id is null then raise exception 'collection not found'; end if;
  if v.status = 'rejected' then raise exception 'this collection is already closed'; end if;
  if v.payout_id is not null or v.payment = 'paid' then raise exception 'this milk is already in a payment to the farmer and cannot be cancelled'; end if;
  if v.status = 'accepted' and v.collected_at < now() - interval '24 hours' then
    raise exception 'accepted milk can be cancelled only within 24 hours. contact ApnaDairy support';
  end if;
  update milk_collections set status = 'rejected', decided_at = now(), voided_at = now(),
         reject_reason = 'Cancelled by the shop: ' || trim(p_reason)
   where id = p_id;
  insert into collection_audit (collection_id, area_manager_id, action, reason, before, actor)
  values (p_id, v.area_manager_id, 'cancelled', trim(p_reason),
          jsonb_build_object('status', v.status, 'quantity_l', v.quantity_l, 'price_per_l', v.price_per_l), auth.uid());
end;
$$;

-- litres were typed wrong: fix them, log it, and send the corrected offer to the farmer again
create or replace function public.correct_collection(p_id uuid, p_quantity numeric, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.milk_collections;
begin
  if coalesce(trim(p_reason), '') = '' then raise exception 'give a reason for the correction'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 2000 then raise exception 'enter the correct litres'; end if;
  select * into v from milk_collections where id = p_id and area_manager_id = public.my_milk_center_id() for update;
  if v.id is null then raise exception 'collection not found'; end if;
  if v.status = 'rejected' then raise exception 'this collection is closed'; end if;
  if v.payout_id is not null or v.payment = 'paid' then raise exception 'this milk is already in a payment to the farmer and cannot be changed'; end if;
  if v.collected_at < now() - interval '24 hours' then raise exception 'collections can be corrected only within 24 hours'; end if;
  if p_quantity = v.quantity_l then raise exception 'the litres are the same as before'; end if;
  update milk_collections
     set quantity_l = p_quantity, status = 'offered', decided_at = null, receipt_no = null,
         collected_at = case when v.status = 'accepted' then now() else collected_at end   -- the farmer gets a fresh 2 hours to answer
   where id = p_id;
  insert into collection_audit (collection_id, area_manager_id, action, reason, before, after, actor)
  values (p_id, v.area_manager_id, 'corrected', trim(p_reason),
          jsonb_build_object('quantity_l', v.quantity_l, 'status', v.status),
          jsonb_build_object('quantity_l', p_quantity, 'status', 'offered'), auth.uid());
end;
$$;

-- ---------- recording milk: server time, honest manual readings ----------
drop function if exists public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, timestamptz, text, numeric);
create or replace function public.record_collection(
  p_farmer uuid, p_quantity numeric, p_shift milk_shift,
  p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
  p_source text default 'simulated', p_price numeric default null, p_manual_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_farmer public.farmers;
  v_ai     jsonb;
  v_ok     boolean;
  v_price  numeric;
  v_id     uuid;
begin
  if v_center is null then raise exception 'only a verified milk center can record milk'; end if;
  if not public.center_billing_ok(v_center) then raise exception 'your ApnaDairy bill is overdue. pay it on the billing page to continue'; end if;
  if p_source not in ('device', 'simulated', 'manual') then raise exception 'unknown reading source'; end if;
  if p_source in ('device', 'simulated') and not public.center_device_active(v_center) then
    raise exception 'your IoT device activates once its invoice is paid. you can enter readings by hand meanwhile';
  end if;
  if p_source = 'manual' and public.center_device_active(v_center) and coalesce(trim(p_manual_reason), '') = '' then
    raise exception 'your IoT device is active. say why the readings are entered by hand';
  end if;
  select * into v_farmer from farmers where id = p_farmer and area_manager_id = v_center;
  if v_farmer.id is null then raise exception 'this farmer is not registered with your center'; end if;
  if not v_farmer.is_active then raise exception 'this farmer is marked inactive'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 2000 then raise exception 'enter the litres'; end if;

  -- the reading time is always the server's clock, so it cannot be backdated
  v_ai := public.assess_milk(v_farmer.milk_type, p_temperature, p_ph, p_ec, p_tds, now());
  v_ok := (v_ai->>'accept')::boolean;
  if v_ok then
    v_price := coalesce(p_price, (v_ai->>'offer_price')::numeric);
    if v_price < (v_ai->>'min_price')::numeric then
      raise exception 'farmers must get at least % of the market rate: Rs % per litre or more', rtrim(rtrim(v_ai->>'farmer_min_pct', '0'), '.') || '%', v_ai->>'min_price';
    end if;
  end if;

  insert into milk_collections (
    area_manager_id, farmer_id, milk_type, shift, quantity_l,
    temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, manual_reason, device_serial,
    quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
    ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason
  ) values (
    v_center, p_farmer, v_farmer.milk_type, p_shift, p_quantity,
    p_temperature, p_ph, p_ec, p_tds, now(), p_source, nullif(trim(p_manual_reason), ''),
    (select device_serial from center_settings where area_manager_id = v_center),
    case when v_ok then (v_ai->>'quality')::quality_grade end,
    (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
    (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
    (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
    v_price,
    case when v_ok then 'offered'::collection_status else 'rejected'::collection_status end,
    case when v_ok then null else now() end,
    case when v_ok then null else 'Failed the quality test' end
  ) returning id into v_id;
  return v_id;
end;
$$;

-- ---------- payments: the shop sends, the farmer confirms ----------
drop function if exists public.pay_farmer(uuid);
create or replace function public.send_payout(p_farmer uuid, p_method text, p_reference text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_total  numeric; v_litres numeric; v_n integer;
  v_id     uuid;
begin
  if not exists (select 1 from farmers where id = p_farmer and area_manager_id = v_center) then
    raise exception 'this farmer is not registered with your center';
  end if;
  if p_method not in ('cash', 'jazzcash', 'easypaisa', 'bank') then raise exception 'choose how you paid'; end if;
  if p_method <> 'cash' and coalesce(trim(p_reference), '') = '' then raise exception 'enter the transaction id'; end if;
  if exists (select 1 from farmer_payouts where farmer_id = p_farmer and status = 'sent') then
    raise exception 'a payment to this farmer is still waiting for their confirmation';
  end if;
  select coalesce(sum(total_amount), 0), coalesce(sum(quantity_l), 0), count(*) into v_total, v_litres, v_n
    from milk_collections where farmer_id = p_farmer and area_manager_id = v_center
     and status = 'accepted' and payment = 'unpaid' and payout_id is null;
  if v_n = 0 then raise exception 'nothing to pay this farmer'; end if;

  insert into farmer_payouts (area_manager_id, farmer_id, amount, litres, collections, method, reference)
  values (v_center, p_farmer, v_total, v_litres, v_n, p_method, nullif(trim(p_reference), ''))
  returning id into v_id;
  update milk_collections set payout_id = v_id
   where farmer_id = p_farmer and area_manager_id = v_center and status = 'accepted' and payment = 'unpaid' and payout_id is null;
  return v_id;
end;
$$;

create or replace function public.answer_payout_internal(p_id uuid, p_confirm boolean, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.farmer_payouts;
begin
  select * into v from farmer_payouts where id = p_id for update;
  if v.id is null then raise exception 'payment not found'; end if;
  if v.status <> 'sent' then raise exception 'this payment has already been answered'; end if;
  if p_confirm then
    update farmer_payouts set status = 'confirmed', answered_at = now(), farmer_note = nullif(trim(p_note), ''),
           receipt_no = 'AD-P-' || lpad(nextval('payout_receipt_seq')::text, 6, '0')
     where id = p_id;
    update milk_collections set payment = 'paid', paid_at = now() where payout_id = p_id;
  else
    update farmer_payouts set status = 'disputed', answered_at = now(), farmer_note = coalesce(nullif(trim(p_note), ''), 'Farmer says the money was not received')
     where id = p_id;
    update milk_collections set payout_id = null where payout_id = p_id;   -- back to unpaid, can be sent again
  end if;
end;
$$;
revoke execute on function public.answer_payout_internal(uuid, boolean, text) from public, anon, authenticated;

-- the farmer confirms (or disputes) in the mobile app
create or replace function public.farmer_answer_payout(p_id uuid, p_confirm boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from farmer_payouts p join farmers f on f.id = p.farmer_id where p.id = p_id and f.profile_id = auth.uid()) then
    raise exception 'only the farmer can confirm this payment, in the ApnaDairy app';
  end if;
  perform public.answer_payout_internal(p_id, p_confirm, p_note);
end;
$$;

create or replace function public.demo_farmer_answer_payout(p_id uuid, p_confirm boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from farmer_payouts p join area_managers a on a.id = p.area_manager_id
                 where p.id = p_id and a.id = public.my_milk_center_id() and a.is_demo) then
    raise exception 'only demo accounts can answer for a farmer';
  end if;
  perform public.answer_payout_internal(p_id, p_confirm, case when p_confirm then null else 'Not received (demo)' end);
end;
$$;

-- what the shop owes: unpaid accepted milk, and what is waiting for the farmer's confirmation
create or replace view public.farmer_stats with (security_invoker = true) as
select f.id as farmer_id,
  coalesce(sum(m.quantity_l)   filter (where m.status = 'accepted' and m.collected_at >= now() - interval '30 days'), 0) as litres_30d,
  coalesce(sum(m.total_amount) filter (where m.status = 'accepted' and m.collected_at >= now() - interval '30 days'), 0) as earned_30d,
  coalesce(sum(m.total_amount) filter (where m.status = 'accepted' and m.payment = 'unpaid'), 0) as unpaid_amount,
  count(m.id) filter (where m.collected_at >= now() - interval '30 days') as tests_30d,
  count(m.id) filter (where m.quality = 'premium' and m.collected_at >= now() - interval '30 days') as premium_30d,
  count(m.id) filter (where m.reject_reason = 'Failed the quality test' and m.collected_at >= now() - interval '30 days') as failed_30d,
  max(m.collected_at) as last_collected_at,
  coalesce(sum(m.total_amount) filter (where m.status = 'accepted' and m.payment = 'unpaid' and m.payout_id is not null), 0) as awaiting_confirmation
from public.farmers f
left join public.milk_collections m on m.farmer_id = f.id
group by f.id;

-- ---------- stock removals: add, undo within 15 minutes, never edit ----------
drop policy if exists "usage: own center" on public.milk_usage;
create policy "usage: center or admin reads" on public.milk_usage
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
create policy "usage: center adds" on public.milk_usage
  for insert with check (area_manager_id = public.my_milk_center_id());

create or replace function public.check_usage_stock()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not new.is_sample and public.milk_in_stock(new.area_manager_id, new.milk_type) < new.litres then
    raise exception 'only % L of % milk is in stock', rtrim(rtrim(round(greatest(public.milk_in_stock(new.area_manager_id, new.milk_type), 0), 1)::text, '0'), '.'), new.milk_type;
  end if;
  return new;
end;
$$;
create trigger milk_usage_within_stock before insert on public.milk_usage
  for each row execute function public.check_usage_stock();

create or replace function public.undo_usage(p_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.milk_usage;
begin
  select * into v from milk_usage where id = p_id and area_manager_id = public.my_milk_center_id() for update;
  if v.id is null then raise exception 'entry not found'; end if;
  if v.created_at < now() - interval '15 minutes' then raise exception 'entries can be undone only within 15 minutes'; end if;
  insert into usage_audit (area_manager_id, entry, actor) values (v.area_manager_id, to_jsonb(v), auth.uid());
  delete from milk_usage where id = p_id;
end;
$$;

-- ---------- sample data: receipts and confirmed payouts for paid milk ----------
create or replace function public.seed_sample_receipts(p_center uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := coalesce(p_center, public.my_milk_center_id()); f record; v_id uuid;
begin
  update milk_collections set receipt_no = 'AD-C-' || lpad(nextval('collection_receipt_seq')::text, 6, '0')
   where area_manager_id = v_center and is_sample and status = 'accepted' and receipt_no is null;
  -- one confirmed weekly payout per farmer and paid week
  for f in select farmer_id, date_trunc('week', paid_at) as wk, sum(total_amount) amt, sum(quantity_l) l, count(*) n, min(paid_at) paid
           from milk_collections where area_manager_id = v_center and is_sample and payment = 'paid' and payout_id is null
           group by 1, 2 loop
    insert into farmer_payouts (area_manager_id, farmer_id, amount, litres, collections, method, reference, status, receipt_no, created_at, answered_at, is_sample)
    values (v_center, f.farmer_id, f.amt, f.l, f.n, case when random() < 0.6 then 'cash' else 'jazzcash' end,
            null, 'confirmed', 'AD-P-' || lpad(nextval('payout_receipt_seq')::text, 6, '0'), f.paid - interval '2 hours', f.paid, true)
    returning id into v_id;
    update milk_collections set payout_id = v_id
     where area_manager_id = v_center and farmer_id = f.farmer_id and is_sample and payment = 'paid' and date_trunc('week', paid_at) = f.wk;
  end loop;
end;
$$;
revoke execute on function public.seed_sample_receipts(uuid) from public, anon, authenticated;

-- the portal calls this one: the sample loader, then receipts and payouts for the paid sample milk
create or replace function public.seed_sample_data_v2()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  perform public.seed_sample_data();
  perform public.seed_sample_receipts();
end;
$$;
revoke execute on function public.seed_sample_data_v2() from public, anon;

-- sample payouts are removed with the sample farmers (farmer_id cascades)

revoke execute on function public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text) from public, anon;
revoke execute on function public.send_payout(uuid, text, text), public.cancel_collection(uuid, text), public.correct_collection(uuid, numeric, text),
  public.demo_farmer_answer(uuid, boolean), public.demo_farmer_answer_payout(uuid, boolean), public.undo_usage(uuid),
  public.expire_my_offers(), public.decide_collection(uuid, boolean, text), public.farmer_answer_payout(uuid, boolean, text),
  public.link_my_farmer_records() from public, anon;
revoke execute on function public.expire_offers(uuid), public.check_usage_stock(), public.link_farmer_profile() from public, anon, authenticated;

-- one-time backfill: receipt numbers for milk accepted before this file, and payouts for paid sample milk
update public.milk_collections set receipt_no = 'AD-C-' || lpad(nextval('public.collection_receipt_seq')::text, 6, '0')
 where status = 'accepted' and receipt_no is null and not is_sample;
select public.seed_sample_receipts(a.id) from public.area_managers a
 where a.type = 'milk_center' and exists (select 1 from public.milk_collections m where m.area_manager_id = a.id and m.is_sample);
