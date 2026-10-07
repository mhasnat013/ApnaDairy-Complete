-- kept for later: run this only when model 1 is plugged in (and use iot-reading_with_model1.ts as the edge function).
-- 26: the trained ai model 1 (quality, freshness, shelf life, spoilage risk) in every milk test
-- run after 25_retest_discount.sql (safe to run again).
--
-- model 1 is a python service (ai/model1/app/main.py, fastapi) using the team's trained .joblib files:
--   quality: svm   freshness score, shelf life, spoilage risk: random forests
-- the iot-reading edge function sends each averaged test (temperature, ph, ec) to it and stores the answer here.
-- if the service cannot be reached, the old rules are used for that test and the portal says so.
--
-- grades: the model's classes are shown as they are. inside the database they keep the old names:
--   Good = 'premium', Acceptable = 'fresh', Poor = 'standard', Spoiled = rejected (not bought)

-- ---------- 1. devices read the Result folder; ec setting per device ----------
update public.iot_devices set path = 'Result' where lower(path) = 'demo';
alter table public.iot_devices alter column path set default 'Result';
-- true when the device's tds sensor already corrects to 25 °C. then ec at the milk's own temperature
-- (what the model expects) is worked back from it. false: ec = tds / 640 is used as it is (team formula).
alter table public.iot_devices add column if not exists tds_at_25c boolean not null default false;

-- ---------- 2. model answers ----------
alter table public.device_readings add column if not exists m1_quality text;
alter table public.device_readings add column if not exists m1_freshness numeric;
alter table public.device_readings add column if not exists m1_shelf_life_h numeric;
alter table public.device_readings add column if not exists m1_spoilage_pct numeric;
alter table public.device_readings add column if not exists m1_warnings jsonb;
alter table public.device_readings add column if not exists m1_error text;

-- every answer the model gave, by input, so the same test is never sent twice
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

alter table public.milk_collections add column if not exists model_quality text;
alter table public.milk_collections add column if not exists spoilage_pct numeric;
-- the model predicts up to 120 hours of shelf life
alter table public.milk_collections drop constraint if exists milk_collections_freshness_hours_check;
alter table public.milk_collections add constraint milk_collections_freshness_hours_check check (freshness_hours >= 0 and freshness_hours <= 120);

create or replace function public.model1_lookup(p_temperature numeric, p_ph numeric, p_ec numeric)
returns public.model1_predictions
language sql stable security definer set search_path = public
as $$
  select * from model1_predictions
   where temperature_c = round(p_temperature, 2) and ph = round(p_ph, 2) and ec_ms = round(p_ec, 3);
$$;

-- ---------- 3. freshness: the model's answer, or the old rules when it is missing ----------
do $$
begin
  -- keep the old rule-based version as the backup, once
  if not exists (select 1 from pg_proc where proname = 'ai_freshness_rules' and pronamespace = 'public'::regnamespace) then
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
  v_notes text[] := '{}';
  v_risk  risk_level;
begin
  if m.quality is null then
    return public.ai_freshness_rules(p_temperature, p_ph, p_ec, p_reading_at)
           || jsonb_build_object('source', 'rules', 'model', 'backup rules (model 1 not reached)');
  end if;
  v_risk := case when m.spoilage_pct >= 60 then 'high' when m.spoilage_pct >= 40 then 'medium' else 'low' end;
  if m.quality = 'Spoiled' then v_notes := v_notes || 'The AI model rates this milk as spoiled'::text;
  elsif m.quality = 'Poor' then v_notes := v_notes || 'The AI model rates this milk as poor quality'::text;
  end if;
  if m.spoilage_pct >= 60 then v_notes := v_notes || format('Spoilage risk is high (%s%%)', round(m.spoilage_pct));
  elsif m.spoilage_pct >= 40 then v_notes := v_notes || format('Spoilage risk is moderate (%s%%), sell this milk first', round(m.spoilage_pct));
  end if;
  if m.quality <> 'Spoiled' and m.shelf_life_h < 12 then
    v_notes := v_notes || format('About %s hours of shelf life left', greatest(round(m.shelf_life_h), 1));
  end if;
  if jsonb_array_length(m.warnings) > 0 then
    v_notes := v_notes || 'Some values are outside what the model was trained on. Check the probes if this looks wrong'::text;
  end if;
  return jsonb_build_object('source', 'model', 'model', 'ApnaDairy Model 1 (SVM + random forests)',
    'model_quality', m.quality, 'freshness_score', round(m.freshness_score)::int, 'freshness_hours', round(m.shelf_life_h)::int,
    'shelf_life_h', round(m.shelf_life_h, 1), 'spoilage_pct', round(m.spoilage_pct, 1), 'spoilage_risk', v_risk,
    'anomaly', m.quality = 'Spoiled', 'warnings', m.warnings, 'notes', to_jsonb(v_notes));
end;
$$;

-- adulteration (model 2 comes later) works on ec at 25 °C, which is tds / 640
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.ai_adulteration(numeric, numeric, numeric, numeric)'::regprocedure);
  if v_def not like '%ec at 25%' then
    v_def := replace(v_def, $r$begin
  if p_ec < 3.6 then$r$, $r$begin
  -- ec at 25 °C: from tds when there is one, so cold milk is not mistaken for watered milk
  p_ec := coalesce(nullif(p_tds, 0) / 640, p_ec);
  v_ratio := case when p_ec > 0 then p_tds / (p_ec * 1000) else null end;
  if p_ec < 3.6 then$r$);
    if v_def not like '%ec at 25%' then raise exception 'ai_adulteration did not match, nothing changed'; end if;
    execute v_def;
  end if;
end $$;

-- ---------- 4. the assessment used by recording, dispatch and retests ----------
create or replace function public.assess_milk(p_milk_type milk_kind, p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
                                              p_reading_at timestamptz default now())
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  m1       jsonb := public.ai_freshness(p_temperature, p_ph, p_ec, p_reading_at);
  m2       jsonb := public.ai_adulteration(p_temperature, p_ph, p_ec, p_tds);
  v_model  boolean := (m1->>'source') = 'model';
  v_rate   numeric;
  v_score  integer;
  v_accept boolean;
  v_grade  quality_grade;
  v_market numeric;
  v_notes  text[];
begin
  select * into s from platform_settings;
  -- the market rate is set by apnadairy for the center's city, never by the center itself
  v_rate := public.market_rate_for(public.my_milk_center_id(), p_milk_type);

  if v_model then
    -- model 1 decides the grade; spoiled milk, or milk that looks adulterated, is not bought
    v_score := (m1->>'freshness_score')::int;
    v_accept := (m1->>'model_quality') <> 'Spoiled' and (m2->>'adulteration_risk') <> 'high';
    v_grade := case m1->>'model_quality' when 'Good' then 'premium' when 'Acceptable' then 'fresh' else 'standard' end;
  else
    -- backup rules while the model cannot be reached
    v_score := least(100, greatest(0, round(
        0.45 * (m1->>'freshness_score')::int + 0.55 * (100 - (m2->>'adulteration_score')::int)
      - abs(p_ph - 6.70) * 60 - greatest(0, p_ec - 4.9) * 6)));
    v_accept := (m1->>'spoilage_risk') <> 'high' and (m2->>'adulteration_risk') <> 'high';
    v_grade := case when v_score >= 88 then 'premium' when v_score >= 82 then 'fresh' else 'standard' end;
  end if;

  if v_accept then
    v_market := round(v_rate
      * case v_grade when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end
      * case (m2->>'adulteration_risk') when 'medium' then 0.95 else 1 end);
  end if;

  v_notes := array(select jsonb_array_elements_text(m1->'notes')) || array(select jsonb_array_elements_text(m2->'notes'));
  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_grade, 'score', v_score, 'base_rate', v_rate,
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

-- a collection keeps the model's own class and spoilage risk from its test
create or replace function public.collection_model_fields()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare m public.model1_predictions;
begin
  if new.temperature_c is not null and new.ph is not null and new.ec_ms is not null then
    m := public.model1_lookup(new.temperature_c, new.ph, new.ec_ms);
    if m.quality is not null then
      new.model_quality := m.quality;
      new.spoilage_pct := round(m.spoilage_pct, 1);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists milk_collections_model1 on public.milk_collections;
create trigger milk_collections_model1 before insert on public.milk_collections
  for each row execute function public.collection_model_fields();

revoke all on function public.model1_lookup(numeric, numeric, numeric) from public, anon;
revoke all on function public.collection_model_fields() from public, anon, authenticated;
grant execute on function public.model1_lookup(numeric, numeric, numeric) to authenticated;
