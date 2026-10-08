-- 45: farmers who signed up in the app, and what they do in it
-- run after 44_model2.sql (safe to run again). then load the farmers with supabase/seed/farmers_from_app.sql.
--
-- 1. a farmer's identity card number (cnic) is part of the details the admin checks.
-- 2. until the mobile app is connected, the farmers loaded by the seed file act the way the app would make them act:
--    - once the admin approves them, they ask a milk center in their own city to take their milk
--    - when a new milk center opens in their city, the ones without a center ask it
--    - when a center declines them, they ask another center in their city
--    - they confirm the payments a center sends them, and rate a center after selling to it a few times
--    the website shows all of this exactly as it shows a real app farmer. these farmers get no emails.

-- ---------- 1. identity card ----------
alter table public.farmer_profiles add column if not exists cnic text;
do $$
begin
  alter table public.farmer_profiles add constraint farmer_profiles_cnic_check check (cnic is null or cnic ~ '^[0-9]{5}-[0-9]{7}-[0-9]$');
exception when duplicate_object then null;
end $$;
alter table public.farmer_profiles add column if not exists app_managed boolean not null default false;

-- the admin list, now with the cnic
drop function if exists public.farmer_applications(text);
create function public.farmer_applications(p_status text default 'pending')
returns table (user_id uuid, full_name text, email text, phone text, status text, photo_path text, city text, village text,
               address text, latitude double precision, longitude double precision, farm_name text, milk_type text,
               cattle_count integer, daily_litres numeric, notes text, submitted_at timestamptz, registered_at timestamptz,
               rejection_reason text, verified_at timestamptz, center_name text, cnic text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.phone, p.status::text, fp.photo_path, fp.city, fp.village, fp.address, fp.latitude, fp.longitude,
         fp.farm_name, fp.milk_type::text, fp.cattle_count, fp.daily_litres, fp.notes, fp.submitted_at, p.created_at,
         fp.rejection_reason, fp.verified_at,
         (select a.center_name from farmer_requests r join area_managers a on a.id = r.area_manager_id
           where r.farmer_id = p.id and r.status = 'accepted' limit 1),
         fp.cnic
  from profiles p left join farmer_profiles fp on fp.user_id = p.id
  where public.is_admin() and p.role = 'farmer' and p.status::text = p_status
  order by coalesce(fp.submitted_at, p.created_at) desc;
$$;
revoke all on function public.farmer_applications(text) from public, anon;
grant execute on function public.farmer_applications(text) to authenticated;

-- the center's list of farmers asking to join, now with the cnic
drop function if exists public.my_farmer_requests();
create function public.my_farmer_requests()
returns table (id uuid, farmer_id uuid, status text, note text, reason text, created_at timestamptz, answered_at timestamptz,
               full_name text, phone text, email text, photo_path text, city text, village text, address text, farm_name text,
               milk_type text, cattle_count integer, daily_litres numeric, notes text, approved_at timestamptz, cnic text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.farmer_id, r.status, r.note, r.reason, r.created_at, r.answered_at,
         p.full_name, p.phone, p.email, fp.photo_path, fp.city, fp.village, fp.address, fp.farm_name, fp.milk_type::text,
         fp.cattle_count, fp.daily_litres, fp.notes, fp.verified_at, fp.cnic
  from farmer_requests r
  join profiles p on p.id = r.farmer_id
  left join farmer_profiles fp on fp.user_id = r.farmer_id
  where r.area_manager_id = public.my_milk_center_id()
  order by (r.status = 'pending') desc, r.created_at desc
  limit 200;
$$;
revoke all on function public.my_farmer_requests() from public, anon;
grant execute on function public.my_farmer_requests() to authenticated;

-- ---------- 2. what the farmers do in the app ----------
-- no emails to these farmers (their notifications stay in the app)
create or replace function public.app_farmer_no_email()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.email and exists (select 1 from farmer_profiles where user_id = new.user_id and app_managed) then
    new.email := false;
  end if;
  return new;
end;
$$;
drop trigger if exists notifications_app_farmer on public.notifications;
create trigger notifications_app_farmer before insert on public.notifications
  for each row execute function public.app_farmer_no_email();

-- an approved farmer with no center asks one in their city: the one they have not asked yet with the fewest waiting requests
create or replace function public.app_farmer_ask_center(p_farmer uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  p  public.profiles;
  fp public.farmer_profiles;
  a  public.area_managers;
  v_id uuid;
  v_kind text;
  v_note text;
begin
  select * into p from profiles where id = p_farmer and role = 'farmer' and status = 'active';
  select * into fp from farmer_profiles where user_id = p_farmer and app_managed;
  if p.id is null or fp.user_id is null then return null; end if;
  if exists (select 1 from farmer_requests where farmer_id = p_farmer and status in ('pending', 'accepted')) then return null; end if;

  select c.* into a from area_managers c join profiles op on op.id = c.user_id and op.status = 'active'
   where c.type = 'milk_center' and c.verification_status = 'active' and lower(trim(c.city)) = lower(trim(fp.city))
     and not exists (select 1 from farmer_requests r where r.farmer_id = p_farmer and r.area_manager_id = c.id)
   order by (select count(*) from farmer_requests r where r.area_manager_id = c.id and r.status = 'pending'), random()
   limit 1;
  if a.id is null then return null; end if;

  v_kind := case fp.milk_type when 'buffalo' then 'buffaloes' when 'cow' then 'cows' else 'cows and buffaloes' end;
  v_note := (array[
    format('Assalam o Alaikum. I have %s %s and can bring about %s litres every day.', fp.cattle_count, v_kind, round(coalesce(fp.daily_litres, fp.cattle_count * 6))),
    format('I keep %s %s in %s. Fresh milk every morning, about %s litres.', fp.cattle_count, v_kind, coalesce(fp.village, fp.city), round(coalesce(fp.daily_litres, fp.cattle_count * 6))),
    format('Salam. Looking for a center that tests the milk and pays on time. %s litres a day from my %s.', round(coalesce(fp.daily_litres, fp.cattle_count * 6)), v_kind),
    format('I can bring my milk to %s before 7 am. %s %s, about %s litres a day.', a.center_name, fp.cattle_count, v_kind, round(coalesce(fp.daily_litres, fp.cattle_count * 6)))
  ])[1 + floor(random() * 4)::int];

  insert into farmer_requests (farmer_id, area_manager_id, note) values (p_farmer, a.id, v_note) returning id into v_id;
  perform public.notify(a.user_id, 'farmer_request', p.full_name || ' wants to sell milk to you',
    'Open Farmers to see their details and accept or decline.', '/manager/farmers?tab=requests');
  return v_id;
end;
$$;
revoke all on function public.app_farmer_ask_center(uuid) from public, anon, authenticated;

-- every approved farmer in a city without a center asks (when a center opens there)
create or replace function public.app_farmers_in_city_ask(p_city text)
returns integer
language plpgsql security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in select fp.user_id from farmer_profiles fp join profiles p on p.id = fp.user_id
            where fp.app_managed and p.status = 'active' and lower(trim(fp.city)) = lower(trim(p_city))
              and not exists (select 1 from farmer_requests q where q.farmer_id = fp.user_id and q.status in ('pending', 'accepted'))
            order by fp.verified_at nulls last
  loop
    if public.app_farmer_ask_center(r.user_id) is not null then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.app_farmers_in_city_ask(text) from public, anon, authenticated;

-- the admin approves a farmer: they choose a center right away
create or replace function public.app_farmer_approved()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.role = 'farmer' and new.status = 'active' and old.status is distinct from 'active' then
    perform public.app_farmer_ask_center(new.id);
  elsif new.role = 'area_manager' and new.status = 'active' and old.status is distinct from 'active' then
    perform public.app_farmers_in_city_ask(a.city) from area_managers a
     where a.user_id = new.id and a.type = 'milk_center' and a.verification_status = 'active';
  end if;
  return null;
end;
$$;
drop trigger if exists profiles_app_farmer on public.profiles;
create trigger profiles_app_farmer after update of status on public.profiles
  for each row execute function public.app_farmer_approved();

-- a milk center is approved (or opens again): farmers in its city without a center ask it
create or replace function public.app_center_opened()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.type = 'milk_center' and new.verification_status = 'active'
     and (tg_op = 'INSERT' or old.verification_status is distinct from 'active' or lower(trim(old.city)) <> lower(trim(new.city))) then
    perform public.app_farmers_in_city_ask(new.city);
  end if;
  return null;
end;
$$;
drop trigger if exists area_managers_app_farmers on public.area_managers;
create trigger area_managers_app_farmers after insert or update of verification_status, city on public.area_managers
  for each row execute function public.app_center_opened();

-- a center declines (or later removes) a farmer: they try another center in their city
create or replace function public.app_farmer_try_next()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('rejected', 'ended') and old.status is distinct from new.status then
    perform public.app_farmer_ask_center(new.farmer_id);
  end if;
  return null;
end;
$$;
drop trigger if exists farmer_requests_app_farmer on public.farmer_requests;
create trigger farmer_requests_app_farmer after update of status on public.farmer_requests
  for each row execute function public.app_farmer_try_next();

-- a center sends money: the farmer confirms it in the app (within a minute or two when pg_cron runs, otherwise at once)
create or replace function public.app_farmers_answer_payouts(p_min_age interval default interval '1 minute')
returns integer
language plpgsql security definer set search_path = public
as $$
declare r record; n integer := 0;
begin
  for r in select fpo.id from farmer_payouts fpo join farmers f on f.id = fpo.farmer_id
             join farmer_profiles fp on fp.user_id = f.profile_id and fp.app_managed
            where fpo.status = 'sent' and fpo.created_at <= now() - p_min_age
  loop
    perform public.answer_payout_internal(r.id, true, null);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.app_farmers_answer_payouts(interval) from public, anon, authenticated;

create or replace function public.app_farmer_payout_sent()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from farmers f join farmer_profiles fp on fp.user_id = f.profile_id and fp.app_managed where f.id = new.farmer_id) then
    perform public.answer_payout_internal(new.id, true, null);
  end if;
  return null;
end;
$$;
drop trigger if exists farmer_payouts_app_farmer on public.farmer_payouts;
create trigger farmer_payouts_app_farmer after insert on public.farmer_payouts
  for each row execute function public.app_farmer_payout_sent();

do $$
begin
  perform cron.schedule('apnadairy-app-farmers', '* * * * *', 'select public.app_farmers_answer_payouts()');
exception when others then
  raise notice 'pg_cron is not available, so these farmers confirm payments at once: %', sqlerrm;
end $$;

-- after selling to a center three times, the farmer rates it (once)
create or replace function public.app_farmer_rates_center()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_profile uuid; v_n integer; v_r integer;
begin
  if new.status <> 'accepted' or old.status = 'accepted' then return null; end if;
  select f.profile_id into v_profile from farmers f join farmer_profiles fp on fp.user_id = f.profile_id and fp.app_managed
   where f.id = new.farmer_id;
  if v_profile is null or exists (select 1 from center_reviews where area_manager_id = new.area_manager_id and farmer_id = v_profile) then
    return null;
  end if;
  select count(*) into v_n from milk_collections m where m.farmer_id = new.farmer_id and m.area_manager_id = new.area_manager_id and m.status = 'accepted';
  if v_n < 3 then return null; end if;
  v_r := case when random() < 0.7 then 5 else 4 end;
  insert into center_reviews (area_manager_id, farmer_id, rating, comment)
  values (new.area_manager_id, v_profile, v_r, (array[
    'Milk is tested in front of us and the price is fair.',
    'Payment comes on time. Staff is respectful.',
    'Good center, the test result is shown on the screen.',
    'Fair rate for buffalo milk. Better than the local gawala.',
    'Quick testing in the morning, no long waiting.',
    null])[1 + floor(random() * 6)::int])
  on conflict (area_manager_id, farmer_id) do nothing;
  return null;
end;
$$;
drop trigger if exists milk_collections_app_farmer on public.milk_collections;
create trigger milk_collections_app_farmer after update of status on public.milk_collections
  for each row execute function public.app_farmer_rates_center();

revoke all on function public.app_farmer_no_email(), public.app_farmer_approved(), public.app_center_opened(),
  public.app_farmer_try_next(), public.app_farmer_payout_sent(), public.app_farmer_rates_center() from public, anon, authenticated;
