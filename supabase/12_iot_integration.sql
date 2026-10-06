-- 12: the real iot device
-- run after 11_stock_orders.sql, once (it is safe to run again).
--
-- the esp32 writes its latest reading to firebase realtime database at /Result
-- ({ TEMP, PH, TDS, EC, EC25 } as text, overwritten each time). when the area manager presses
-- "take reading", the edge function iot-reading fetches it, works out ec from tds, checks it and
-- stores it in device_readings. record_collection then uses that stored reading, never numbers
-- typed in the browser, and the ai models run on it.

-- ---------- devices, one per center ----------
create table if not exists public.iot_devices (
  serial          text primary key,                          -- printed on the device, e.g. AD-IOT-0001
  area_manager_id uuid unique references public.area_managers(id) on delete set null,
  db_url          text not null,                             -- firebase realtime database url
  path            text not null default 'Result',            -- where the device writes its latest reading
  label           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.iot_devices enable row level security;
drop policy if exists "devices: own center or admin reads" on public.iot_devices;
create policy "devices: own center or admin reads" on public.iot_devices
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
drop policy if exists "devices: admin manages" on public.iot_devices;
create policy "devices: admin manages" on public.iot_devices
  for all using (public.is_admin()) with check (public.is_admin());

-- the team's device (firebase project milk123), not yet given to a center
insert into public.iot_devices (serial, db_url, path, label)
values ('AD-IOT-0001', 'https://milk123-3b7d4-default-rtdb.firebaseio.com', 'Result', 'ESP32 tester: temperature, pH, TDS')
on conflict (serial) do nothing;

-- admin: give a device to a center (null takes it back)
create or replace function public.assign_device(p_serial text, p_center uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  update iot_devices set area_manager_id = null where area_manager_id = p_center and serial <> p_serial;
  update iot_devices set area_manager_id = p_center where serial = p_serial;
  if not found then raise exception 'device not found'; end if;
  if p_center is not null then
    update center_settings set device_serial = p_serial where area_manager_id = p_center;
  end if;
end;
$$;

-- ---------- every reading fetched from a device ----------
create table if not exists public.device_readings (
  id              uuid primary key default gen_random_uuid(),
  device_serial   text not null references public.iot_devices(serial),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  temperature_c   numeric(5,2),
  ph              numeric(5,2),
  tds_ppm         numeric(8,1),
  ec_ms           numeric(7,3),       -- worked out from tds: ec (mS/cm) = tds / 640
  ec25_ms         numeric(7,3),       -- ec at 25 °C: ec / (1 + 0.02 (t - 25)), what the ai uses
  raw             jsonb not null,     -- exactly what firebase returned
  status          text not null check (status in ('ok', 'check')),
  problems        text[] not null default '{}',
  reading_at      timestamptz not null default now(),
  received_at     timestamptz not null default now(),
  collection_id   uuid unique references public.milk_collections(id) on delete set null
);
create index if not exists device_readings_center on public.device_readings (area_manager_id, received_at desc);
alter table public.device_readings enable row level security;
drop policy if exists "readings: own center or admin reads" on public.device_readings;
create policy "readings: own center or admin reads" on public.device_readings
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
-- no insert policy: only the edge function (service role) writes readings

alter table public.milk_collections add column if not exists device_reading_id uuid references public.device_readings(id);

-- ---------- record a collection from a stored device reading ----------
drop function if exists public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text);
create or replace function public.record_collection(
  p_farmer uuid, p_quantity numeric, p_shift milk_shift,
  p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric,
  p_source text default 'simulated', p_price numeric default null, p_manual_reason text default null,
  p_reading uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  v_farmer public.farmers;
  v_r      public.device_readings;
  v_ai     jsonb;
  v_ok     boolean;
  v_price  numeric;
  v_id     uuid;
  v_at     timestamptz := now();
  v_serial text := (select device_serial from center_settings where area_manager_id = v_center);
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
  -- simulated readings are for demo accounts only; real centers use the device or type them in
  if p_source = 'simulated' and not exists (select 1 from area_managers where id = v_center and is_demo) then
    raise exception 'take the reading with your IoT device';
  end if;

  -- a device reading is taken from what the device sent, never from the browser
  if p_source = 'device' then
    select * into v_r from device_readings where id = p_reading for update;
    if v_r.id is null or v_r.area_manager_id <> v_center then raise exception 'take a reading with the device first'; end if;
    if v_r.status <> 'ok' then raise exception 'this reading failed the sensor check. take it again'; end if;
    if v_r.collection_id is not null then raise exception 'this reading is already used for another collection. take a new one'; end if;
    if v_r.received_at < now() - interval '15 minutes' then raise exception 'this reading is more than 15 minutes old. take a new one'; end if;
    -- the ai gets ec worked out from tds. the tds sensor code usually corrects to 25 °C already,
    -- so correcting again (ec25) would count the temperature twice and flag cold milk as salted.
    -- if the firmware's tds is not temperature corrected, use v_r.ec25_ms here instead.
    p_temperature := v_r.temperature_c; p_ph := v_r.ph; p_ec := v_r.ec_ms; p_tds := v_r.tds_ppm;
    v_at := v_r.reading_at; v_serial := v_r.device_serial;
  end if;

  select * into v_farmer from farmers where id = p_farmer and area_manager_id = v_center;
  if v_farmer.id is null then raise exception 'this farmer is not registered with your center'; end if;
  if not v_farmer.is_active then raise exception 'this farmer is marked inactive'; end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 2000 then raise exception 'enter the litres'; end if;

  v_ai := public.assess_milk(v_farmer.milk_type, p_temperature, p_ph, p_ec, p_tds, v_at);
  v_ok := (v_ai->>'accept')::boolean;
  if v_ok then
    v_price := coalesce(p_price, (v_ai->>'offer_price')::numeric);
    if v_price < (v_ai->>'min_price')::numeric then
      raise exception 'farmers must get at least % of the market rate: Rs % per litre or more', rtrim(rtrim(v_ai->>'farmer_min_pct', '0'), '.') || '%', v_ai->>'min_price';
    end if;
  end if;

  insert into milk_collections (
    area_manager_id, farmer_id, milk_type, shift, quantity_l,
    temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, manual_reason, device_serial, device_reading_id,
    quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
    ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason
  ) values (
    v_center, p_farmer, v_farmer.milk_type, p_shift, p_quantity,
    p_temperature, p_ph, p_ec, p_tds, v_at, p_source, nullif(trim(p_manual_reason), ''), v_serial, v_r.id,
    case when v_ok then (v_ai->>'quality')::quality_grade end,
    (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
    (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
    (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
    v_price,
    case when v_ok then 'offered'::collection_status else 'rejected'::collection_status end,
    case when v_ok then null else now() end,
    case when v_ok then null else 'Failed the quality test' end
  ) returning id into v_id;

  if v_r.id is not null then update device_readings set collection_id = v_id where id = v_r.id; end if;
  return v_id;
end;
$$;

revoke execute on function public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text, uuid) from public, anon;
grant execute on function public.record_collection(uuid, numeric, milk_shift, numeric, numeric, numeric, numeric, text, numeric, text, uuid) to authenticated;
revoke execute on function public.assign_device(text, uuid) from public, anon;
grant execute on function public.assign_device(text, uuid) to authenticated;

-- ---------- the adulteration model, matched to the device ----------
-- the device has no separate ec sensor: ec = tds / 640, so normal milk is ec 3.9 to 5.5 mS/cm,
-- tds about 2,500 to 3,500 ppm. the tds and ec cross-check only fires when the two disagree,
-- which happens only if a separate ec sensor is fitted later.
create or replace function public.ai_adulteration(p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric)
returns jsonb
language plpgsql stable set search_path = public
as $$
declare
  v_score   integer := 0;
  v_notes   text[] := '{}';
  v_sus     text := null;
  v_risk    risk_level;
  v_ratio   numeric := case when p_ec > 0 then p_tds / (p_ec * 1000) else null end;   -- 0.64 when ec comes from tds
begin
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

-- sample data follows the device too: tds = ec × 640
update public.milk_collections set tds_ppm = round(ec_ms * 640) where is_sample and ec_ms is not null;
do $$
declare d text;
begin
  select pg_get_functiondef('public.seed_sample_data()'::regprocedure) into d;
  d := replace(d, '(v_ec * 1000 * (0.49 + random() * 0.03))', '(v_ec * 640 * (0.98 + random() * 0.04))');
  execute d;
end $$;
