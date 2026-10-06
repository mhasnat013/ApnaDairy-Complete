-- 13: one-minute device tests
-- run after 12_iot_integration.sql (safe to run again).
--
-- sensors sometimes misread, so a test is not one reading. "take reading" opens a session; for about
-- a minute the edge function reads the device's /Result every few seconds and stores each sample.
-- at the end the server averages them (impossible values and spikes dropped) and only that final
-- reading goes to the ai models.

create table if not exists public.reading_sessions (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  device_serial   text not null references public.iot_devices(serial),
  seconds         integer not null default 60 check (seconds between 10 and 300),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  reading_id      uuid references public.device_readings(id)
);
create index if not exists reading_sessions_center on public.reading_sessions (area_manager_id, started_at desc);

create table if not exists public.device_samples (
  id            bigserial primary key,
  session_id    uuid not null references public.reading_sessions(id) on delete cascade,
  raw           jsonb not null,
  temperature_c numeric(5,2),
  ph            numeric(5,2),
  tds_ppm       numeric(8,1),
  valid         boolean not null,
  problem       text,
  taken_at      timestamptz not null default now()
);
create index if not exists device_samples_session on public.device_samples (session_id, taken_at);

-- the final reading remembers how it was made
alter table public.device_readings
  add column if not exists session_id    uuid unique references public.reading_sessions(id),
  add column if not exists samples_total integer,
  add column if not exists samples_used  integer,
  add column if not exists spread        jsonb,
  add column if not exists notes         text[] not null default '{}';

alter table public.reading_sessions enable row level security;
alter table public.device_samples enable row level security;
drop policy if exists "sessions: own center or admin reads" on public.reading_sessions;
create policy "sessions: own center or admin reads" on public.reading_sessions
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
drop policy if exists "samples: own center or admin reads" on public.device_samples;
create policy "samples: own center or admin reads" on public.device_samples
  for select using (exists (select 1 from public.reading_sessions s where s.id = session_id
    and (s.area_manager_id = public.my_milk_center_id() or public.is_admin())));
-- no insert policies: only the edge function (service role) writes sessions, samples and readings
