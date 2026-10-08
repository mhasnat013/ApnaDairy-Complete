-- 44: ai model 2 (added water) on every milk test
-- run after 43_dynamic_pricing.sql (safe to run again). then redeploy the iot-reading edge function.
--
-- model 2 (ai/model2, the team's trained model: calibrated boosted trees) reads temperature, ph, ec and tds and
-- says whether water was added, with a confidence. it runs inside the iot-reading edge function, like model 1,
-- and its answers are saved in model2_predictions; the tests read them from there.
--   shown:  added water detected or not, the confidence, and the chance of added water, on the test, the iot
--           readings, the try-it page and (as "no added water") on the marketplace
--   price:  shown only. it never refuses milk and never changes the price.

-- ---------- 1. the model's answers ----------
alter table public.device_readings
  add column if not exists m2_water boolean,
  add column if not exists m2_confidence numeric,
  add column if not exists m2_water_pct numeric,
  add column if not exists m2_warnings jsonb,
  add column if not exists m2_error text;

-- every answer the model gave, by input
create table if not exists public.model2_predictions (
  temperature_c     numeric(6,2) not null,
  ph                numeric(5,2) not null,
  ec_ms             numeric(7,3) not null,
  tds_ppm           numeric(8,1) not null,
  water_detected    boolean not null,
  confidence        numeric not null,      -- % for the class it chose
  water_probability numeric not null,      -- % chance of added water
  warnings          jsonb not null default '[]',
  created_at        timestamptz not null default now(),
  primary key (temperature_c, ph, ec_ms, tds_ppm)
);
alter table public.model2_predictions enable row level security;   -- written by the edge function only

create or replace function public.model2_lookup(p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric)
returns public.model2_predictions
language sql stable security definer set search_path = public
as $$
  select * from model2_predictions
   where temperature_c = round(p_temperature, 2) and ph = round(p_ph, 2) and ec_ms = round(p_ec, 3) and tds_ppm = round(p_tds, 1);
$$;
revoke all on function public.model2_lookup(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- ---------- 2. adulteration: the model's answer ----------
create or replace function public.ai_adulteration(p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  m       public.model2_predictions;
  v_src   text := 'model';
  v_water boolean;
  v_pct   numeric;
  v_conf  numeric;
  v_ec25  numeric;
  v_warn  text[] := '{}';
  v_notes text[] := '{}';
  v_risk  risk_level;
begin
  if p_tds is not null and p_ec is not null and p_temperature is not null and p_ph is not null then
    m := public.model2_lookup(p_temperature, p_ph, p_ec, p_tds);
  end if;
  if m.water_detected is not null then
    v_water := m.water_detected; v_pct := m.water_probability; v_conf := m.confidence;
  else
    -- no saved answer for these values: the same outputs from dissolved solids at 25 °C
    v_src := 'rules';
    v_ec25 := coalesce(nullif(p_tds, 0) / 640, p_ec / (1 + 0.022 * (coalesce(p_temperature, 25) - 25)));
    v_pct := round(100 / (1 + exp(least(50, greatest(-50, (coalesce(v_ec25, 4.75) - 3.8) * 5)))), 2);
    v_water := v_pct > 50;
    v_conf := round(greatest(v_pct, 100 - v_pct), 1);
  end if;

  -- the values the model was trained on (ai/model2 training ranges)
  if p_temperature < 2.38 or p_temperature > 40.44 then v_warn := v_warn || format('temperature %s °C', p_temperature); end if;
  if p_ph < 6.27 or p_ph > 7.29 then v_warn := v_warn || format('pH %s', p_ph); end if;
  if p_ec < 1.0 or p_ec > 12.083 then v_warn := v_warn || format('EC %s mS/cm', p_ec); end if;
  if p_tds < 853 or p_tds > 5486 then v_warn := v_warn || format('TDS %s ppm', p_tds); end if;

  -- the chance of added water: 80% and over high, 50 to 80% medium (the model's answer is uncertain), under 50% low
  v_risk := case when v_pct >= 80 then 'high' when v_pct >= 50 then 'medium' else 'low' end;
  if v_pct >= 80 then v_notes := v_notes || format('AI Model 2 found added water (%s%% confidence)', round(v_conf));
  elsif v_pct >= 50 then v_notes := v_notes || format('AI Model 2 suspects added water (%s%% confidence, uncertain)', round(v_conf));
  end if;
  if cardinality(v_warn) > 0 and v_pct >= 50 then
    v_notes := v_notes || ('Outside what Model 2 was trained on: ' || array_to_string(v_warn, ', ') || '. Check the probes if this looks wrong');
  end if;

  return jsonb_build_object('source', v_src, 'model', 'ApnaDairy Model 2',
    'water_detected', v_water, 'adulteration_type', case when v_water then 'Water' else 'None' end,
    'confidence', round(v_conf, 1), 'water_pct', round(v_pct, 1),
    'adulteration_risk', v_risk, 'adulteration_score', round(v_pct)::int, 'suspected', case when v_water then 'water' end,
    'warnings', to_jsonb(v_warn), 'notes', to_jsonb(v_notes));
end;
$$;

-- ---------- 3. the assessment: model 2 is shown, it never refuses milk or changes the price ----------
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

  -- model 1 decides the grade; spoiled milk is not bought
  v_accept := (m1->>'model_quality') <> 'Spoiled';
  v_grade := case m1->>'model_quality' when 'Good' then 'premium' when 'Acceptable' then 'fresh' else 'standard' end;

  if v_accept then
    v_market := round(v_rate * case v_grade when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end);
  end if;

  v_notes := array(select jsonb_array_elements_text(m1->'notes')) || array(select jsonb_array_elements_text(m2->'notes'));
  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_grade, 'score', (m1->>'freshness_score')::int, 'base_rate', v_rate,
    'source', m1->>'source', 'model_quality', m1->>'model_quality', 'spoilage_pct', m1->'spoilage_pct', 'shelf_life_h', m1->'shelf_life_h',
    'freshness', m1, 'adulteration', m2,
    'freshness_hours', m1->'freshness_hours', 'spoilage_risk', m1->'spoilage_risk',
    'adulteration_risk', m2->'adulteration_risk', 'adulteration_score', m2->'adulteration_score', 'suspected', m2->'suspected',
    'water_detected', m2->'water_detected', 'water_confidence', m2->'confidence', 'water_pct', m2->'water_pct',
    'market_price', v_market,
    'offer_price', case when v_accept then round(v_market * s.farmer_default_pct / 100.0) end,
    'min_price', case when v_accept then ceil(v_market * s.farmer_min_pct / 100.0) end,
    'farmer_default_pct', s.farmer_default_pct, 'farmer_min_pct', s.farmer_min_pct,
    'notes', to_jsonb(v_notes)
  );
end;
$$;

-- ---------- 4. listings: did the milk on sale pass the water check ----------
-- 'clear' when every fresh batch a listing sells was under 50% chance of added water, 'suspected' otherwise
create or replace function public.listing_water(p_center uuid, p_type milk_kind)
returns text
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.adulteration_score, m.suspected, m.freshness_hours, coalesce(m.reading_at, m.collected_at) as t,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  ),
  s as (
    select b.*, least(b.quantity_l, greatest(stock.left_l - b.before_l, 0)) as l
    from b, stock
    where public.shelf_hours(b.freshness_hours) - extract(epoch from now() - b.t) / 3600 > 0
  )
  select case when count(*) = 0 then null
              when bool_or(coalesce(adulteration_score, 0) >= 50 or suspected = 'water') then 'suspected'
              else 'clear' end
  from s where l > 0.05;
$$;
revoke all on function public.listing_water(uuid, milk_kind) from public;
grant execute on function public.listing_water(uuid, milk_kind) to anon, authenticated;

create or replace view public.marketplace_milk as
 select l.id, l.shop_id, l.shop_name, l.city, l.rating, l.review_count, l.cover_path,
        l.name, l.milk_type, l.quality, l.description, l.list_price, l.discount_pct, l.price_per_l, l.available_l,
        l.freshness_score, l.model_quality, l.spoilage_pct, l.model_shelf_left_h, l.tested_at, l.expires_at,
        coalesce(p.listed_at, p.created_at) as listed_at,
        t.ph as test_ph, t.temperature_c as test_temperature_c,
        l.pricing_mode, l.price_stage, l.next_drop_at,
        listing_water(l.shop_id, l.milk_type) as water_check
   from public_listings l
   join products p on p.id = l.id
   cross join lateral listing_tests(l.shop_id, l.milk_type) t
  where l.available_l > 0;

grant select on public.marketplace_milk to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger on public.marketplace_milk from anon, authenticated;
