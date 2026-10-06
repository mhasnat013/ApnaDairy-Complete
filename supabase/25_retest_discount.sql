-- 25: retest leftover milk on the app, and a discount the ai suggests from the retest
-- run after 24_bulk_grades.sql (safe to run again).
--
-- 1. an area manager retests milk that is still on the app. if it fails, it comes off the app.
-- 2. if it passes, the ai suggests a discount from how much freshness was lost and how much shelf life is left.
--    the area manager can take it, change it, or give none.
-- 3. any discount on app milk needs a passing retest from the last 3 hours.

-- ---------- 1. retests ----------
create table if not exists public.milk_retests (
  id               uuid primary key default gen_random_uuid(),
  area_manager_id  uuid not null references public.area_managers(id) on delete cascade,
  product_id       uuid references public.products(id) on delete set null,
  milk_type        milk_kind not null,
  reading_id       uuid unique references public.device_readings(id),
  litres_left      numeric not null check (litres_left >= 0),
  price            numeric,
  score_before     numeric,          -- freshness score of this milk when it was bought
  score_now        numeric,          -- freshness score at the retest
  hours_left       numeric,          -- shelf life left, from the retest
  passed           boolean not null,
  grade            quality_grade,
  suggested_pct    integer,
  applied_pct      integer,          -- what the area manager chose
  created_at       timestamptz not null default now()
);
create index if not exists milk_retests_product on public.milk_retests (product_id, created_at desc);
alter table public.milk_retests enable row level security;
drop policy if exists "retests read" on public.milk_retests;
create policy "retests read" on public.milk_retests for select to authenticated
  using (area_manager_id = public.my_seller_id() or public.is_admin());

-- ---------- 2. the suggested discount ----------
-- the less shelf life is left and the more freshness was lost since buying, the bigger the discount (steps of 5%, up to 50%).
-- milk with a day or more left that has hardly changed needs none.
create or replace function public.suggest_discount(p_hours numeric, p_score numeric, p_before numeric)
returns jsonb
language plpgsql immutable
as $$
declare
  v_drop  numeric := greatest(coalesce(p_before, p_score) - p_score, 0);
  v_time  numeric := greatest(24 - p_hours, 0) * 1.2;   -- up to about 29% for milk close to going off
  v_loss  numeric := v_drop * 1.5;                       -- 1.5% for each freshness point lost
  v_pct   integer;
begin
  v_pct := least(50, greatest(0, round((v_time + v_loss) / 5) * 5))::integer;
  if p_hours >= 24 and v_drop < 5 then v_pct := 0; end if;
  return jsonb_build_object('pct', v_pct, 'drop', round(v_drop, 1), 'from_time', round(v_time, 1), 'from_loss', round(v_loss, 1));
end;
$$;

create or replace function public.retest_listing(p_product uuid, p_reading uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_p      public.products;
  v_r      public.device_readings;
  v_ai     jsonb;
  v_before numeric;
  v_hours  numeric;
  v_score  numeric;
  v_sug    jsonb;
  v_id     uuid;
begin
  if v_center is null then raise exception 'only a milk center can retest milk'; end if;
  select * into v_p from products where id = p_product and area_manager_id = v_center and category = 'milk';
  if v_p.id is null then raise exception 'listing not found'; end if;
  if coalesce(v_p.listed_l, 0) <= 0 then raise exception 'there is no milk left on this listing to retest'; end if;
  select * into v_r from device_readings where id = p_reading for update;
  if v_r.id is null or v_r.area_manager_id <> v_center then raise exception 'this reading is not from your device'; end if;
  if v_r.status <> 'ok' then raise exception 'the device test did not finish properly. test again'; end if;
  if v_r.received_at < now() - interval '15 minutes' then raise exception 'this test is more than 15 minutes old. test the milk again'; end if;
  if v_r.collection_id is not null or exists (select 1 from bulk_orders where dispatch_reading_id = p_reading)
     or exists (select 1 from milk_retests where reading_id = p_reading) then
    raise exception 'this test was already used. test the milk again';
  end if;

  v_ai := public.assess_milk(v_p.milk_type, v_r.temperature_c, v_r.ph, v_r.ec_ms, v_r.tds_ppm, v_r.reading_at);
  v_hours := coalesce((v_ai->>'freshness_hours')::numeric, 0);
  v_score := coalesce((v_ai->'freshness'->>'freshness_score')::numeric, (v_ai->>'score')::numeric);
  -- freshness when bought: the milk of this type bought in the last 3 days
  select round(sum(freshness_score * quantity_l) / nullif(sum(quantity_l), 0)) into v_before
    from milk_collections where area_manager_id = v_center and milk_type = v_p.milk_type and status = 'accepted'
     and collected_at > now() - interval '3 days' and freshness_score is not null;

  if not coalesce((v_ai->>'accept')::boolean, false) then
    -- failed: off the app straight away
    update products set is_available = false, listed_l = 0 where id = v_p.id;
    insert into milk_retests (area_manager_id, product_id, milk_type, reading_id, litres_left, price, score_before, score_now, hours_left, passed)
    values (v_center, v_p.id, v_p.milk_type, p_reading, v_p.listed_l, v_p.price, v_before, v_score, 0, false)
    returning id into v_id;
    return jsonb_build_object('id', v_id, 'passed', false, 'notes', v_ai->'notes', 'litres', v_p.listed_l);
  end if;

  v_sug := public.suggest_discount(v_hours, v_score, v_before);
  insert into milk_retests (area_manager_id, product_id, milk_type, reading_id, litres_left, price, score_before, score_now, hours_left,
                            passed, grade, suggested_pct)
  values (v_center, v_p.id, v_p.milk_type, p_reading, v_p.listed_l, v_p.price, v_before, v_score, v_hours,
          true, (v_ai->>'quality')::quality_grade, (v_sug->>'pct')::integer)
  returning id into v_id;
  return v_sug || jsonb_build_object('id', v_id, 'passed', true, 'grade', v_ai->>'quality', 'score_now', v_score,
    'score_before', v_before, 'hours_left', v_hours, 'litres', v_p.listed_l, 'price', v_p.price, 'current_pct', v_p.discount_pct);
end;
$$;

-- the area manager's choice after a retest: the suggestion, more, less or none
create or replace function public.set_listing_discount(p_retest uuid, p_pct integer)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_t public.milk_retests;
begin
  select * into v_t from milk_retests where id = p_retest and area_manager_id = public.my_milk_center_id();
  if v_t.id is null then raise exception 'retest not found'; end if;
  if not v_t.passed then raise exception 'this milk failed the retest and is off the app'; end if;
  if v_t.created_at < now() - interval '3 hours' then raise exception 'this retest is more than 3 hours old. retest the milk first'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 90 then raise exception 'the discount can be 0 to 90%%'; end if;
  perform set_config('apnadairy.retest_discount', 'on', true);
  update products set discount_pct = p_pct where id = v_t.product_id;
  update milk_retests set applied_pct = p_pct where id = p_retest;
end;
$$;

-- ---------- 3. any discount on app milk goes through a retest ----------
create or replace function public.guard_milk_discount()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.category = 'milk' and coalesce(new.discount_pct, 0) > 0
     and (tg_op = 'INSERT' or new.discount_pct is distinct from old.discount_pct)
     and coalesce(current_setting('apnadairy.retest_discount', true), '') <> 'on'
     and not (tg_op = 'INSERT' and coalesce(new.is_sample, false)) then   -- sample data is loaded with its discounts
    raise exception 'retest the milk on your IoT device before giving a discount';
  end if;
  return new;
end;
$$;
drop trigger if exists products_milk_discount on public.products;
create trigger products_milk_discount before insert or update of discount_pct on public.products
  for each row execute function public.guard_milk_discount();

-- ---------- 4. one device test, one use: collection, bulk dispatch or retest ----------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.record_collection'::regproc);
  if v_def not like '%milk_retests where reading_id%' then
    v_def := replace(v_def, $r$if v_r.collection_id is not null then raise exception 'this test is already used for another collection. test again'; end if;$r$,
      $r$if v_r.collection_id is not null or exists (select 1 from bulk_orders where dispatch_reading_id = v_r.id)
     or exists (select 1 from milk_retests where reading_id = v_r.id) then raise exception 'this test is already used. test again'; end if;$r$);
    if v_def not like '%milk_retests where reading_id%' then raise exception 'record_collection did not match, nothing changed'; end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.update_bulk_order(uuid, bulk_order_status, text, uuid)'::regprocedure);
  if v_def not like '%milk_retests where reading_id%' then
    v_def := replace(v_def, $r$if v_r.collection_id is not null or exists (select 1 from bulk_orders where dispatch_reading_id = p_reading) then$r$,
      $r$if v_r.collection_id is not null or exists (select 1 from bulk_orders where dispatch_reading_id = p_reading)
         or exists (select 1 from milk_retests where reading_id = p_reading) then$r$);
    if v_def not like '%milk_retests where reading_id%' then raise exception 'update_bulk_order did not match, nothing changed'; end if;
    execute v_def;
  end if;
end $$;

revoke all on function public.guard_milk_discount() from public, anon, authenticated;
revoke all on function public.retest_listing(uuid, uuid), public.set_listing_discount(uuid, integer) from public, anon;
grant execute on function public.suggest_discount(numeric, numeric, numeric), public.retest_listing(uuid, uuid),
  public.set_listing_discount(uuid, integer) to authenticated;
grant select on public.milk_retests to authenticated;
