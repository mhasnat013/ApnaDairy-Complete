-- 41: ai model 1 runs every milk test, and listings show what it found
-- run after 40_public_requests.sql (safe to run again).
--
-- model 1 (ai/model1, the team's trained models: svm for quality, random forests for freshness, shelf life and
-- spoilage risk) runs inside the iot-reading edge function, exported from the .joblib files with identical answers.
-- the function runs it on each averaged device test (temperature, ph, ec) and keeps the answer in
-- model1_predictions. the database reads that answer here. if the model could not run for a test, the same
-- four outputs are worked out by the backup rules.
--
-- what the model decides:
--   grade:  Good = premium, Acceptable = fresh, Poor = standard (bought at the lower price), Spoiled = not bought
--   price:  premium +6%, fresh as is, standard -8% on the city rate (as before)
--   shown:  quality, freshness score, shelf life (hours), spoilage risk (%) on the test, stock and listings
-- milk always sells for 2 days from collection. the model's shelf life is shown as information: once it has
-- passed, the milk stays on sale until its 2 days are up, with a note to sell it first.

-- ---------- 1. device setting ----------
-- true when the device's tds sensor already corrects to 25 °C. ec at the milk's own temperature (what the model
-- expects) is then worked back from it. false: ec = tds / 640 as it is (team formula).
alter table public.iot_devices add column if not exists tds_at_25c boolean not null default false;

-- ---------- 2. the model's answers ----------
alter table public.device_readings
  add column if not exists m1_quality text,
  add column if not exists m1_freshness numeric,
  add column if not exists m1_shelf_life_h numeric,
  add column if not exists m1_spoilage_pct numeric,
  add column if not exists m1_warnings jsonb,
  add column if not exists m1_error text;

-- every answer the model gave, by input, so the same values are never sent twice
create table if not exists public.model1_predictions (
  temperature_c   numeric(6,2) not null,
  ph              numeric(5,2) not null,
  ec_ms           numeric(7,3) not null,
  quality         text not null check (quality in ('Good', 'Acceptable', 'Poor', 'Spoiled')),
  freshness_score numeric not null,
  shelf_life_h    numeric not null,
  spoilage_pct    numeric not null,
  warnings        jsonb not null default '[]',
  created_at      timestamptz not null default now(),
  primary key (temperature_c, ph, ec_ms)
);
alter table public.model1_predictions enable row level security;   -- written by the edge function only

create or replace function public.model1_lookup(p_temperature numeric, p_ph numeric, p_ec numeric)
returns public.model1_predictions
language sql stable security definer set search_path = public
as $$
  select * from model1_predictions
   where temperature_c = round(p_temperature, 2) and ph = round(p_ph, 2) and ec_ms = round(p_ec, 3);
$$;
revoke all on function public.model1_lookup(numeric, numeric, numeric) from public, anon, authenticated;

-- each collection keeps the model's own class and spoilage risk (freshness score and shelf life already have columns)
alter table public.milk_collections
  add column if not exists model_quality text,
  add column if not exists spoilage_pct numeric,
  add column if not exists model_source text;
do $$
begin
  alter table public.milk_collections add constraint milk_collections_model_quality_check
    check (model_quality is null or model_quality in ('Good', 'Acceptable', 'Poor', 'Spoiled'));
exception when duplicate_object then null;
end $$;
-- the model predicts up to 120 hours of shelf life
alter table public.milk_collections drop constraint if exists milk_collections_freshness_hours_check;
alter table public.milk_collections add constraint milk_collections_freshness_hours_check check (freshness_hours >= 0 and freshness_hours <= 120);

-- ---------- 3. freshness: the model's answer ----------
-- keep the old rule-based version as the backup, once
do $$
begin
  if to_regprocedure('public.ai_freshness_rules(numeric, numeric, numeric, timestamptz)') is null then
    if position('model1_lookup' in pg_get_functiondef('public.ai_freshness(numeric, numeric, numeric, timestamptz)'::regprocedure)) > 0 then
      raise exception 'ai_freshness already uses the model but its rule-based backup is missing';
    end if;
    execute replace(pg_get_functiondef('public.ai_freshness(numeric, numeric, numeric, timestamptz)'::regprocedure),
                    'FUNCTION public.ai_freshness(', 'FUNCTION public.ai_freshness_rules(');
  end if;
end $$;

create or replace function public.ai_freshness(p_temperature numeric, p_ph numeric, p_ec numeric, p_reading_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m       public.model1_predictions := public.model1_lookup(p_temperature, p_ph, p_ec);
  r       jsonb;
  v_src   text := 'model';
  v_q     text;
  v_fresh numeric;
  v_shelf numeric;
  v_spoil numeric;
  v_warn  text[] := '{}';
  v_notes text[] := '{}';
  v_risk  risk_level;
begin
  if m.quality is not null then
    v_q := m.quality; v_fresh := m.freshness_score; v_shelf := m.shelf_life_h; v_spoil := m.spoilage_pct;
  else
    -- the model did not answer for these values: the same four outputs from the backup rules
    v_src := 'rules';
    r := public.ai_freshness_rules(p_temperature, p_ph, p_ec, p_reading_at);
    v_fresh := (r->>'freshness_score')::numeric;
    v_shelf := (r->>'freshness_hours')::numeric;
    v_spoil := least(99.5, greatest(0.5, round((6.65 - p_ph) * 250 + greatest(0, p_temperature - 25) * 1.5, 1)));
    v_q := case when p_ph < 6.4 then 'Spoiled' when v_fresh >= 75 then 'Good' when v_fresh >= 50 then 'Acceptable' else 'Poor' end;
  end if;
  v_fresh := least(100, greatest(0, v_fresh));
  v_shelf := least(120, greatest(0, v_shelf));
  v_spoil := least(100, greatest(0, v_spoil));

  -- the values the model was trained on (ai/model1 README, section 7)
  if p_temperature < 2.5 or p_temperature > 40.38 then v_warn := v_warn || format('temperature %s °C', p_temperature); end if;
  if p_ph < 4.45 or p_ph > 7.22 then v_warn := v_warn || format('pH %s', p_ph); end if;
  if p_ec < 1.62 or p_ec > 9.0 then v_warn := v_warn || format('EC %s mS/cm', p_ec); end if;

  -- spoilage risk bands from the model README: under 40% low, 40 to 60% moderate, 60% and over high
  v_risk := case when v_spoil >= 60 then 'high' when v_spoil >= 40 then 'medium' else 'low' end;
  if v_q = 'Spoiled' then v_notes := v_notes || 'The AI model rates this milk as spoiled'::text;
  elsif v_q = 'Poor' then v_notes := v_notes || 'The AI model rates this milk as poor quality, so it is bought at the standard price'::text;
  end if;
  if v_spoil >= 60 then v_notes := v_notes || format('Spoilage risk is high (%s%%)', least(99, round(v_spoil)));
  elsif v_spoil >= 40 then v_notes := v_notes || format('Spoilage risk is moderate (%s%%), sell this milk first', round(v_spoil));
  end if;
  if v_q <> 'Spoiled' and v_shelf < 12 then
    v_notes := v_notes || format('About %s hours of shelf life at %s °C. Chilling it keeps it longer', greatest(round(v_shelf), 1), round(p_temperature));
  end if;
  if cardinality(v_warn) > 0 then
    v_notes := v_notes || ('Outside what the model was trained on: ' || array_to_string(v_warn, ', ') || '. Check the probes if this looks wrong');
  end if;

  return jsonb_build_object('source', v_src, 'model', 'ApnaDairy Model 1',
    'model_quality', v_q, 'freshness_score', round(v_fresh)::int, 'freshness_hours', round(v_shelf)::int,
    'shelf_life_h', round(v_shelf, 1), 'spoilage_pct', round(v_spoil, 1), 'spoilage_risk', v_risk,
    'anomaly', v_q = 'Spoiled', 'warnings', to_jsonb(v_warn), 'notes', to_jsonb(v_notes));
end;
$$;

-- ---------- 4. adulteration (rules until model 2): ec at 25 °C comes from tds ----------
create or replace function public.ai_adulteration(p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_score   integer := 0;
  v_notes   text[] := '{}';
  v_sus     text := null;
  v_risk    risk_level;
  v_ratio   numeric;
begin
  -- ec at 25 °C: from tds when there is one, so cold milk is not mistaken for watered milk
  p_ec := coalesce(nullif(p_tds, 0) / 640, p_ec);
  v_ratio := case when p_ec > 0 then p_tds / (p_ec * 1000) else null end;
  if p_ec < 3.6 then
    v_score := v_score + 70; v_sus := 'water'; v_notes := array_append(v_notes, 'TDS and conductivity are low, water may have been added'::text);
  elsif p_ec < 3.9 then
    v_score := v_score + 30; v_sus := 'water'; v_notes := array_append(v_notes, 'Dissolved solids are a little low'::text);
  end if;
  if p_ec > 6.2 then
    v_score := v_score + 70; v_sus := 'salt'; v_notes := array_append(v_notes, 'TDS and conductivity are high, salt may have been added'::text);
  elsif p_ec > 5.5 then
    v_score := v_score + 25; v_sus := coalesce(v_sus, 'salt or udder infection'); v_notes := array_append(v_notes, 'Conductivity is above normal'::text);
  end if;
  if p_ph > 6.9 then
    v_score := v_score + 40; v_sus := coalesce(v_sus, 'soda'); v_notes := array_append(v_notes, 'pH is high, soda may have been added'::text);
  end if;
  if v_ratio is not null and (v_ratio < 0.4 or v_ratio > 0.7) then
    v_score := v_score + 15; v_notes := array_append(v_notes, 'TDS does not match conductivity, possible additive or sensor fault'::text);
  end if;

  v_score := least(v_score, 99);
  v_risk := case when v_score >= 60 then 'high' when v_score >= 25 then 'medium' else 'low' end;
  return jsonb_build_object('model', 'adulteration-sample-v2', 'adulteration_risk', v_risk, 'adulteration_score', v_score,
    'suspected', v_sus, 'notes', to_jsonb(v_notes));
end;
$$;

-- ---------- 5. the assessment used by recording, retests and the try-it sliders ----------
create or replace function public.assess_milk(p_milk_type milk_kind, p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
                                              p_reading_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  m1       jsonb := public.ai_freshness(p_temperature, p_ph, p_ec, p_reading_at);
  m2       jsonb := public.ai_adulteration(p_temperature, p_ph, p_ec, p_tds);
  v_rate   numeric;
  v_accept boolean;
  v_grade  quality_grade;
  v_market numeric;
  v_notes  text[];
begin
  select * into s from platform_settings;
  -- the market rate is set by apnadairy for the center's city, never by the center itself
  v_rate := public.market_rate_for(public.my_milk_center_id(), p_milk_type);

  -- model 1 decides the grade; spoiled milk, or milk that looks adulterated, is not bought
  v_accept := (m1->>'model_quality') <> 'Spoiled' and (m2->>'adulteration_risk') <> 'high';
  v_grade := case m1->>'model_quality' when 'Good' then 'premium' when 'Acceptable' then 'fresh' else 'standard' end;

  if v_accept then
    v_market := round(v_rate
      * case v_grade when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end
      * case (m2->>'adulteration_risk') when 'medium' then 0.95 else 1 end);
  end if;

  v_notes := array(select jsonb_array_elements_text(m1->'notes')) || array(select jsonb_array_elements_text(m2->'notes'));
  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_grade, 'score', (m1->>'freshness_score')::int, 'base_rate', v_rate,
    'source', m1->>'source', 'model_quality', m1->>'model_quality', 'spoilage_pct', m1->'spoilage_pct', 'shelf_life_h', m1->'shelf_life_h',
    'freshness', m1, 'adulteration', m2,
    'freshness_hours', m1->'freshness_hours', 'spoilage_risk', m1->'spoilage_risk',
    'adulteration_risk', m2->'adulteration_risk', 'adulteration_score', m2->'adulteration_score', 'suspected', m2->'suspected',
    'market_price', v_market,
    'offer_price', case when v_accept then round(v_market * s.farmer_default_pct / 100.0) end,
    'min_price', case when v_accept then ceil(v_market * s.farmer_min_pct / 100.0) end,
    'farmer_default_pct', s.farmer_default_pct, 'farmer_min_pct', s.farmer_min_pct,
    'notes', to_jsonb(v_notes)
  );
end;
$$;

-- a collection keeps the model's class, spoilage risk and which engine answered, from its own device test
create or replace function public.collection_model_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r public.device_readings; f jsonb;
begin
  if new.model_quality is not null then return new; end if;
  if new.device_reading_id is not null then
    select * into r from device_readings where id = new.device_reading_id;
  end if;
  if r.id is not null and r.temperature_c is not null and r.ph is not null and r.ec_ms is not null then
    f := public.ai_freshness(r.temperature_c, r.ph, r.ec_ms, coalesce(r.reading_at, now()));
  elsif new.temperature_c is not null and new.ph is not null and new.ec_ms is not null then
    f := public.ai_freshness(new.temperature_c, new.ph, new.ec_ms, coalesce(new.reading_at, new.collected_at, now()));
  else
    return new;
  end if;
  -- milk graded without a device test (sample data) keeps the class that matches its grade
  new.model_quality := case when r.id is null and new.quality is not null
                            then case new.quality when 'premium' then 'Good' when 'fresh' then 'Acceptable' else 'Poor' end
                            else f->>'model_quality' end;
  new.spoilage_pct := (f->>'spoilage_pct')::numeric;
  new.model_source := f->>'source';
  return new;
end;
$$;
drop trigger if exists milk_collections_model1 on public.milk_collections;
create trigger milk_collections_model1 before insert on public.milk_collections
  for each row execute function public.collection_model_fields();
revoke all on function public.collection_model_fields() from public, anon, authenticated;

-- ---------- 6. milk sells for 2 days from collection, whatever the shelf life ----------
create or replace function public.shelf_hours(p_ai_hours numeric)
returns numeric language sql immutable as $$ select 48::numeric $$;

-- ---------- 7. listings ----------
-- the grade a listing shows is the lowest grade of the fresh milk in stock, so better milk is never claimed
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
           greatest(public.shelf_hours(b.freshness_hours) - extract(epoch from now() - b.t) / 3600, 0) as h
    from b, stock
  )
  select min(quality) from shelf where l > 0.05 and h > 0 and quality is not null;
$$;

-- what model 1 found in the milk a listing sells: the lowest class, litre-weighted freshness, the highest
-- spoilage risk, and the model's shelf life left on the oldest batch, which sells first (negative once it passed)
create or replace function public.listing_model(p_center uuid, p_type milk_kind)
returns table (model_quality text, freshness_score integer, spoilage_pct numeric, shelf_left_h numeric, tested_at timestamptz)
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.freshness_score, m.spoilage_pct, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(m.model_quality, case m.quality when 'premium' then 'Good' when 'fresh' then 'Acceptable' when 'standard' then 'Poor' end) as q,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  shelf as (
    select b.*, least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l
    from b, stock
    where public.shelf_hours(b.freshness_hours) - extract(epoch from now() - b.t) / 3600 > 0
  ),
  s as (select * from shelf where l > 0.05)
  select (select q from s where q is not null order by case q when 'Good' then 3 when 'Acceptable' then 2 when 'Poor' then 1 else 0 end limit 1),
         round(sum(l * freshness_score) filter (where freshness_score is not null)
               / nullif(sum(l) filter (where freshness_score is not null), 0))::int,
         max(spoilage_pct),
         (select round((extract(epoch from o.t + o.freshness_hours * interval '1 hour' - now()) / 3600)::numeric, 1)
            from s o where o.freshness_hours is not null order by o.t limit 1),
         min(t)
  from s;
$$;
-- the public listings view calls it, and visitors who are not signed in may read that view
revoke all on function public.listing_model(uuid, milk_kind) from public;
grant execute on function public.listing_model(uuid, milk_kind) to anon, authenticated;

-- the freshness a listing shows is model 1's freshness score of that milk
create or replace function public.listing_freshness(p_center uuid, p_type milk_kind)
returns table (freshness_score integer, hours_left numeric, oldest_hours numeric)
language sql stable security definer set search_path = public
as $$
  select case when s.sellable_l > 0 then coalesce(lm.freshness_score, round(least(100, coalesce(s.fresh_hours, 0) / 36 * 100))::int) else 0 end,
         s.fresh_hours, s.oldest_hours
  from public.milk_shelf(p_center, p_type) s
  left join lateral public.listing_model(p_center, p_type) lm on true;
$$;

-- customers see the model's findings next to each listing
create or replace view public.public_listings as
 select pr.id,
    pr.area_manager_id as shop_id,
    sh.center_name as shop_name,
    sh.city,
    sh.rating,
    sh.review_count,
    sh.cover_path,
    pr.name,
    pr.milk_type,
    listing_grade(pr.area_manager_id, pr.milk_type) as quality,
    pr.description,
    pr.price as list_price,
    pr.discount_pct,
    round(((pr.price * ((100 - pr.discount_pct))::numeric) / 100.0)) as price_per_l,
    greatest((0)::numeric, round((floor((least(coalesce(pr.listed_l, st.sellable_l), st.sellable_l) * (2)::numeric)) / (2)::numeric), 1)) as available_l,
    ps.order_min_l as min_order_l,
    ps.order_max_l as max_order_l,
    f.freshness_score,
    f.hours_left,
    f.oldest_hours,
    pr.created_at,
    pr.milk_expires_at as expires_at,
    lm.model_quality,
    lm.spoilage_pct,
    lm.shelf_left_h as model_shelf_left_h,
    lm.tested_at
   from ((((products pr
     join public_shops sh on ((sh.id = pr.area_manager_id)))
     cross join platform_settings ps)
     cross join lateral ( select milk_sellable(pr.area_manager_id, pr.milk_type) as sellable_l) st)
     cross join lateral listing_freshness(pr.area_manager_id, pr.milk_type) f(freshness_score, hours_left, oldest_hours))
     cross join lateral listing_model(pr.area_manager_id, pr.milk_type) lm
  where pr.category = 'milk' and pr.is_available and pr.expired_at is null
    and (pr.milk_expires_at is null or pr.milk_expires_at > now());

-- ---------- 8. admin: how many tests model 1 answered ----------
drop function if exists public.device_activity();
create function public.device_activity()
returns table (serial text, last_test timestamptz, tests_7d bigint, failed_7d bigint, model_7d bigint, last_model_error text)
language sql stable security definer set search_path = public
as $$
  select d.serial, max(r.received_at), count(r.id) filter (where r.received_at > now() - interval '7 days'),
         count(r.id) filter (where r.received_at > now() - interval '7 days' and r.status <> 'ok'),
         count(r.id) filter (where r.received_at > now() - interval '7 days' and r.m1_quality is not null),
         (select x.m1_error from device_readings x where x.device_serial = d.serial and x.status = 'ok' order by x.received_at desc limit 1)
  from iot_devices d left join device_readings r on r.device_serial = d.serial
  where public.is_admin()
  group by d.serial;
$$;
revoke all on function public.device_activity() from public, anon;
grant execute on function public.device_activity() to authenticated;

-- ---------- 9. milk already in stock: the class that matches its grade, and a spoilage risk from its test ----------
update public.milk_collections m
   set model_quality = case m.quality when 'premium' then 'Good' when 'fresh' then 'Acceptable' else 'Poor' end,
       spoilage_pct = (x.f->>'spoilage_pct')::numeric, model_source = 'before model 1'
  from (select c.id, public.ai_freshness(coalesce(r.temperature_c, c.temperature_c), coalesce(r.ph, c.ph), coalesce(r.ec_ms, c.ec_ms),
                                         coalesce(r.reading_at, c.reading_at, c.collected_at)) as f
          from public.milk_collections c left join public.device_readings r on r.id = c.device_reading_id
         where c.model_quality is null and c.status = 'accepted' and c.quality is not null
           and c.collected_at > now() - interval '10 days' and coalesce(r.temperature_c, c.temperature_c) is not null) x
 where x.id = m.id;

-- ---------- 10. listings on sale now take the 2-day expiry of their milk ----------
update public.products p
   set milk_expires_at = public.oldest_fresh_expiry(p.area_manager_id, p.milk_type),
       milk_from = public.oldest_fresh_from(p.area_manager_id, p.milk_type)
 where p.category = 'milk' and p.expired_at is null and p.milk_expires_at is not null and p.milk_expires_at > now()
   and public.oldest_fresh_expiry(p.area_manager_id, p.milk_type) is not null;
