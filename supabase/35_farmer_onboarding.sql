-- 35: farmers join through the app
-- run after 34_notifications.sql (safe to run again).
--
-- 1. a farmer signs up in the app and sends their details and picture; the account waits for the admin
-- 2. the admin approves or rejects (with a reason; a rejected farmer can fix the details and send them again)
-- 3. an approved farmer sees the milk centers in their city (picture, rating, farmers, rates) and asks to join one
-- 4. the center accepts or rejects (with a reason, e.g. too many farmers); on accept they are connected
-- 5. a farmer can leave a center and pick another; farmers rate the centers they sold to
-- the admin never assigns farmers, and centers can no longer add farmers by hand.

-- ---------- farmer details ----------
create table if not exists public.farmer_profiles (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  photo_path       text,                         -- farmer-photos bucket: <user_id>/<file>
  city             text not null check (char_length(trim(city)) between 2 and 40),
  village          text check (village is null or char_length(village) <= 80),
  address          text check (address is null or char_length(address) <= 200),
  latitude         double precision,
  longitude        double precision,
  farm_name        text check (farm_name is null or char_length(farm_name) <= 80),
  milk_type        milk_kind not null default 'mixed',
  cattle_count     integer not null default 1 check (cattle_count between 0 and 500),
  daily_litres     numeric(8,1) check (daily_litres is null or daily_litres between 0 and 5000),
  notes            text check (notes is null or char_length(notes) <= 300),
  submitted_at     timestamptz,
  rejection_reason text,
  verified_by      uuid references public.profiles(id) on delete set null,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- ---------- a farmer asks a center ----------
create table if not exists public.farmer_requests (
  id              uuid primary key default gen_random_uuid(),
  farmer_id       uuid not null references public.profiles(id) on delete cascade,
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  note            text check (note is null or char_length(note) <= 300),
  status          text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'ended')),
  reason          text check (reason is null or char_length(reason) <= 300),
  created_at      timestamptz not null default now(),
  answered_at     timestamptz,
  ended_at        timestamptz
);
create index if not exists farmer_requests_center on public.farmer_requests (area_manager_id, status, created_at desc);
create unique index if not exists farmer_requests_one_open on public.farmer_requests (farmer_id) where status in ('pending', 'accepted');

-- ---------- farmers rate centers ----------
create table if not exists public.center_reviews (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  farmer_id       uuid not null references public.profiles(id) on delete cascade,
  rating          integer not null check (rating between 1 and 5),
  comment         text check (comment is null or char_length(comment) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (area_manager_id, farmer_id)
);

-- the center a farmer is connected to right now
create or replace function public.my_center_for_farmer()
returns uuid
language sql stable security definer set search_path = public
as $$
  select area_manager_id from farmer_requests where farmer_id = auth.uid() and status = 'accepted' limit 1;
$$;
revoke all on function public.my_center_for_farmer() from public, anon;
grant execute on function public.my_center_for_farmer() to authenticated;

alter table public.farmer_profiles enable row level security;
alter table public.farmer_requests enable row level security;
alter table public.center_reviews enable row level security;
drop policy if exists "farmer profiles: own, admin or a center they asked" on public.farmer_profiles;
create policy "farmer profiles: own, admin or a center they asked" on public.farmer_profiles for select to authenticated
  using (user_id = auth.uid() or public.is_admin()
         or exists (select 1 from farmer_requests r where r.farmer_id = farmer_profiles.user_id and r.area_manager_id = public.my_milk_center_id()));
drop policy if exists "farmer requests: farmer, center or admin" on public.farmer_requests;
create policy "farmer requests: farmer, center or admin" on public.farmer_requests for select to authenticated
  using (farmer_id = auth.uid() or area_manager_id = public.my_milk_center_id() or public.is_admin());
drop policy if exists "center reviews: anyone signed in reads" on public.center_reviews;
create policy "center reviews: anyone signed in reads" on public.center_reviews for select to authenticated using (true);
-- all writes go through the functions below

-- ---------- farmer pictures (private) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('farmer-photos', 'farmer-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "farmer photos: farmer uploads own" on storage.objects;
create policy "farmer photos: farmer uploads own" on storage.objects for insert to authenticated
  with check (bucket_id = 'farmer-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "farmer photos: farmer replaces own" on storage.objects;
create policy "farmer photos: farmer replaces own" on storage.objects for update to authenticated
  using (bucket_id = 'farmer-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "farmer photos: farmer removes own" on storage.objects;
create policy "farmer photos: farmer removes own" on storage.objects for delete to authenticated
  using (bucket_id = 'farmer-photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "farmer photos: farmer, admin or a center they asked" on storage.objects;
create policy "farmer photos: farmer, admin or a center they asked" on storage.objects for select to authenticated
  using (bucket_id = 'farmer-photos' and (
    (storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
    or exists (select 1 from public.farmer_requests r
               where r.farmer_id::text = (storage.foldername(name))[1] and r.area_manager_id = public.my_milk_center_id())));

-- ---------- sign-up: a farmer waits for the admin like everyone else ----------
do $$
declare d text;
begin
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into d;
  if position('''business'', ''farmer'') then ''pending''' in d) = 0 then
    d := replace(d, 'case when v_role in (''area_manager'', ''business'') then ''pending''',
                    'case when v_role in (''area_manager'', ''business'', ''farmer'') then ''pending''');
    if position('''business'', ''farmer'') then ''pending''' in d) = 0 then raise exception 'could not update handle_new_user'; end if;
    execute d;
  end if;
end $$;

-- the center rows keep the farmer's account when the connection is made here
create or replace function public.link_farmer_profile()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(current_setting('apnadairy.farmer_link', true), '') = 'on' then return new; end if;
  if tg_op = 'INSERT' then
    new.profile_id := null;
  elsif new.profile_id is distinct from old.profile_id then
    new.profile_id := old.profile_id;
  end if;
  return new;
end;
$$;

-- centers can no longer add farmers by hand
drop policy if exists "farmers: center adds" on public.farmers;

-- ---------- the farmer sends (or fixes) their details ----------
create or replace function public.submit_farmer_profile(
  p_full_name text, p_phone text, p_city text, p_village text default null, p_address text default null,
  p_farm_name text default null, p_milk_type text default 'mixed', p_cattle_count integer default 1,
  p_daily_litres numeric default null, p_notes text default null, p_photo_path text default null,
  p_latitude double precision default null, p_longitude double precision default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  v_new boolean;
begin
  select * into me from profiles where id = auth.uid() for update;
  if me.id is null then raise exception 'sign in again'; end if;
  -- a plain account (e.g. google sign-in in the app) can become a farmer, if it is not used for anything else
  if me.role = 'customer' then
    if me.status <> 'active' or exists (select 1 from shop_orders where customer_id = me.id)
       or exists (select 1 from area_managers where user_id = me.id) or exists (select 1 from business_profiles where user_id = me.id) then
      raise exception 'this account is already used for something else. sign up again as a farmer';
    end if;
  elsif me.role <> 'farmer' then
    raise exception 'only farmers can send farm details';
  end if;
  if me.status = 'suspended' then raise exception 'your account is suspended. contact ApnaDairy'; end if;

  if char_length(trim(coalesce(p_full_name, ''))) not between 2 and 80 then raise exception 'enter your full name'; end if;
  if coalesce(trim(p_phone), '') = '' or not public.is_pk_mobile(p_phone) then raise exception 'phone must be a mobile number like 0300 1234567'; end if;
  if char_length(trim(coalesce(p_city, ''))) not between 2 and 40 then raise exception 'enter your city'; end if;
  if p_milk_type not in ('cow', 'buffalo', 'mixed') then raise exception 'choose cow, buffalo or mixed milk'; end if;
  if coalesce(p_cattle_count, -1) not between 0 and 500 then raise exception 'cattle must be between 0 and 500'; end if;
  if p_daily_litres is not null and p_daily_litres not between 0 and 5000 then raise exception 'daily milk must be between 0 and 5000 litres'; end if;
  if coalesce(p_photo_path, '') = '' or split_part(p_photo_path, '/', 1) <> me.id::text then
    raise exception 'add your picture';
  end if;
  if (p_latitude is null) <> (p_longitude is null) or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    raise exception 'the location is not valid';
  end if;

  v_new := not exists (select 1 from farmer_profiles where user_id = me.id and submitted_at is not null);
  insert into farmer_profiles (user_id, photo_path, city, village, address, latitude, longitude, farm_name, milk_type,
                               cattle_count, daily_litres, notes, submitted_at, updated_at)
  values (me.id, p_photo_path, initcap(trim(p_city)), nullif(trim(p_village), ''), nullif(trim(p_address), ''), p_latitude, p_longitude,
          nullif(trim(p_farm_name), ''), p_milk_type::milk_kind, p_cattle_count, p_daily_litres, nullif(trim(p_notes), ''), now(), now())
  on conflict (user_id) do update set
    photo_path = excluded.photo_path, city = excluded.city, village = excluded.village, address = excluded.address,
    latitude = excluded.latitude, longitude = excluded.longitude, farm_name = excluded.farm_name, milk_type = excluded.milk_type,
    cattle_count = excluded.cattle_count, daily_litres = excluded.daily_litres, notes = excluded.notes,
    submitted_at = now(), updated_at = now(),
    rejection_reason = case when me.status = 'rejected' then null else farmer_profiles.rejection_reason end;

  update profiles set role = 'farmer', full_name = trim(p_full_name), phone = trim(p_phone),
         status = case when status = 'active' and role = 'farmer' then 'active' else 'pending' end::account_status, updated_at = now()
   where id = me.id;

  if v_new or me.status = 'rejected' then
    perform public.notify_admins('farmer_signup', trim(p_full_name) || ' wants to join as a farmer',
      initcap(trim(p_city)) || coalesce(', ' || nullif(trim(p_village), ''), '') || ' · ' || p_cattle_count || ' cattle', '/admin/approvals?tab=farmer');
  end if;
end;
$$;
revoke all on function public.submit_farmer_profile(text, text, text, text, text, text, text, integer, numeric, text, text, double precision, double precision) from public, anon;
grant execute on function public.submit_farmer_profile(text, text, text, text, text, text, text, integer, numeric, text, text, double precision, double precision) to authenticated;

-- ---------- the admin decides ----------
create or replace function public.set_farmer_status(p_farmer uuid, p_status text, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare p public.profiles; fp public.farmer_profiles;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  select * into p from profiles where id = p_farmer for update;
  select * into fp from farmer_profiles where user_id = p_farmer;
  if p.id is null or p.role <> 'farmer' then raise exception 'farmer not found'; end if;
  p_reason := nullif(trim(p_reason), '');
  if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;

  if p_status = 'active' then
    if fp.submitted_at is null or fp.photo_path is null then raise exception 'cannot approve: the farmer has not sent their details and picture yet'; end if;
    update farmer_profiles set rejection_reason = null, verified_by = auth.uid(), verified_at = now() where user_id = p_farmer;
    update profiles set status = 'active', updated_at = now() where id = p_farmer;
    if p.status <> 'suspended' then
      perform public.notify(p_farmer, 'farmer_approved', 'Your farmer account is approved',
        'Open the ApnaDairy app and choose a milk center near you.', null, true);
    end if;
  elsif p_status = 'rejected' then
    if coalesce(char_length(p_reason), 0) < 10 then raise exception 'write the reason for rejecting (at least 10 characters). the farmer will see it'; end if;
    update farmer_profiles set rejection_reason = p_reason, verified_by = auth.uid(), verified_at = now() where user_id = p_farmer;
    update profiles set status = 'rejected', updated_at = now() where id = p_farmer;
    perform public.notify(p_farmer, 'farmer_rejected', 'Your farmer account was not approved',
      'Reason: ' || p_reason || E'\nFix your details in the ApnaDairy app and send them again.', null, true);
  elsif p_status = 'suspended' then
    update profiles set status = 'suspended', updated_at = now() where id = p_farmer;
  else
    raise exception 'unknown status';
  end if;
end;
$$;
revoke all on function public.set_farmer_status(uuid, text, text) from public, anon;
grant execute on function public.set_farmer_status(uuid, text, text) to authenticated;

-- the admin list (with the farmer's account details, which the admin can read)
create or replace function public.farmer_applications(p_status text default 'pending')
returns table (user_id uuid, full_name text, email text, phone text, status text, photo_path text, city text, village text,
               address text, latitude double precision, longitude double precision, farm_name text, milk_type text,
               cattle_count integer, daily_litres numeric, notes text, submitted_at timestamptz, registered_at timestamptz,
               rejection_reason text, verified_at timestamptz, center_name text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email, p.phone, p.status::text, fp.photo_path, fp.city, fp.village, fp.address, fp.latitude, fp.longitude,
         fp.farm_name, fp.milk_type::text, fp.cattle_count, fp.daily_litres, fp.notes, fp.submitted_at, p.created_at,
         fp.rejection_reason, fp.verified_at,
         (select a.center_name from farmer_requests r join area_managers a on a.id = r.area_manager_id
           where r.farmer_id = p.id and r.status = 'accepted' limit 1)
  from profiles p left join farmer_profiles fp on fp.user_id = p.id
  where public.is_admin() and p.role = 'farmer' and p.status::text = p_status
  order by coalesce(fp.submitted_at, p.created_at) desc;
$$;
revoke all on function public.farmer_applications(text) from public, anon;
grant execute on function public.farmer_applications(text) to authenticated;

-- ---------- an approved farmer picks a center ----------
-- milk collection centers in the farmer's city, best rated first
create or replace function public.centers_for_farmer()
returns table (id uuid, center_name text, city text, address text, cover_path text, tagline text, phone text, opening_hours text,
               rating numeric, reviews integer, farmers integer, buffalo_rate numeric, cow_rate numeric, mixed_rate numeric,
               since date, my_request text, my_reason text)
language plpgsql stable security definer set search_path = public
as $$
declare v_city text;
begin
  if not exists (select 1 from profiles pr where pr.id = auth.uid() and pr.role = 'farmer' and pr.status = 'active') then
    raise exception 'your farmer account is not approved yet';
  end if;
  select lower(trim(x.city)) into v_city from farmer_profiles x where x.user_id = auth.uid();
  return query
  select a.id, a.center_name, a.city, a.address,
         (select ph.path from shop_photos ph where ph.area_manager_id = a.id order by ph.sort, ph.created_at limit 1),
         sp.tagline, sp.phone, sp.opening_hours,
         round((select avg(r.rating) from center_reviews r where r.area_manager_id = a.id), 1),
         (select count(*) from center_reviews r where r.area_manager_id = a.id)::int,
         (select count(*) from farmers f where f.area_manager_id = a.id and f.is_active and f.profile_id is not null)::int,
         coalesce(cs.buffalo_rate, (select m.rate from market_rates m where lower(m.city) = lower(a.city) and m.milk_type = 'buffalo')),
         coalesce(cs.cow_rate, (select m.rate from market_rates m where lower(m.city) = lower(a.city) and m.milk_type = 'cow')),
         coalesce(cs.mixed_rate, (select m.rate from market_rates m where lower(m.city) = lower(a.city) and m.milk_type = 'mixed')),
         a.created_at::date,
         (select r.status from farmer_requests r where r.farmer_id = auth.uid() and r.area_manager_id = a.id order by r.created_at desc limit 1),
         (select r.reason from farmer_requests r where r.farmer_id = auth.uid() and r.area_manager_id = a.id order by r.created_at desc limit 1)
  from area_managers a
  join profiles op on op.id = a.user_id and op.status = 'active'
  left join shop_profiles sp on sp.area_manager_id = a.id
  left join center_settings cs on cs.area_manager_id = a.id
  where a.type = 'milk_center' and a.verification_status = 'active' and lower(trim(a.city)) = v_city
  order by 9 desc nulls last, 10 desc, a.center_name;
end;
$$;
revoke all on function public.centers_for_farmer() from public, anon;
grant execute on function public.centers_for_farmer() to authenticated;

create or replace function public.request_center(p_center uuid, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_name text; a public.area_managers;
begin
  select full_name into v_name from profiles where id = auth.uid() and role = 'farmer' and status = 'active';
  if v_name is null then raise exception 'your farmer account is not approved yet'; end if;
  select * into a from area_managers where id = p_center and type = 'milk_center' and verification_status = 'active';
  if a.id is null then raise exception 'this center is not taking farmers'; end if;
  if lower(trim(a.city)) <> (select lower(trim(city)) from farmer_profiles where user_id = auth.uid()) then
    raise exception 'you can join a center in your own city';
  end if;
  if exists (select 1 from farmer_requests where farmer_id = auth.uid() and status = 'accepted') then
    raise exception 'you already sell to a center. leave it first to choose another';
  end if;
  if exists (select 1 from farmer_requests where farmer_id = auth.uid() and status = 'pending') then
    raise exception 'you already asked a center. wait for its answer or cancel that request';
  end if;
  if (select count(*) from farmer_requests where farmer_id = auth.uid() and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'you have asked 5 centers today. try again tomorrow';
  end if;
  if char_length(p_note) > 300 then raise exception 'the note is too long (300 characters at most)'; end if;

  insert into farmer_requests (farmer_id, area_manager_id, note) values (auth.uid(), p_center, nullif(trim(p_note), '')) returning id into v_id;
  perform public.notify(a.user_id, 'farmer_request', v_name || ' wants to sell milk to you',
    'Open Farmers to see their details and accept or decline.', '/manager/farmers?tab=requests');
  return v_id;
end;
$$;
revoke all on function public.request_center(uuid, text) from public, anon;
grant execute on function public.request_center(uuid, text) to authenticated;

create or replace function public.cancel_center_request()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update farmer_requests set status = 'cancelled', answered_at = now() where farmer_id = auth.uid() and status = 'pending';
  if not found then raise exception 'you have no request waiting'; end if;
end;
$$;
revoke all on function public.cancel_center_request() from public, anon;
grant execute on function public.cancel_center_request() to authenticated;

-- the center answers. accepting connects them: the farmer appears in the center's farmers and can sell milk there.
create or replace function public.answer_farmer_request(p_request uuid, p_accept boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare r public.farmer_requests; fp public.farmer_profiles; p public.profiles; v_center text; v_row uuid;
begin
  select * into r from farmer_requests where id = p_request for update;
  if r.id is null or r.area_manager_id is distinct from public.my_milk_center_id() then raise exception 'request not found'; end if;
  if r.status <> 'pending' then raise exception 'this request was already answered or cancelled'; end if;
  select * into p from profiles where id = r.farmer_id;
  select * into fp from farmer_profiles where user_id = r.farmer_id;
  select center_name into v_center from area_managers where id = r.area_manager_id;
  p_reason := nullif(trim(p_reason), '');

  if not p_accept then
    if coalesce(char_length(p_reason), 0) < 3 then raise exception 'say why, e.g. you have too many farmers right now'; end if;
    if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;
    update farmer_requests set status = 'rejected', reason = p_reason, answered_at = now() where id = r.id;
    perform public.notify(r.farmer_id, 'center_declined', v_center || ' cannot take you right now',
      'Reason: ' || p_reason || E'\nYou can choose another center in your city.', null, true);
    return;
  end if;

  if p.status <> 'active' then raise exception 'this farmer''s account is not active'; end if;
  update farmer_requests set status = 'accepted', reason = null, answered_at = now() where id = r.id;
  perform set_config('apnadairy.farmer_link', 'on', true);
  select id into v_row from farmers where area_manager_id = r.area_manager_id and profile_id = r.farmer_id;
  if v_row is not null then
    update farmers set is_active = true, full_name = p.full_name, phone = p.phone, village = coalesce(fp.village, fp.city),
           milk_type = fp.milk_type, cattle_count = fp.cattle_count where id = v_row;
  else
    insert into farmers (area_manager_id, profile_id, full_name, phone, village, milk_type, cattle_count)
    values (r.area_manager_id, r.farmer_id, p.full_name, p.phone, coalesce(fp.village, fp.city), fp.milk_type, fp.cattle_count);
  end if;
  perform set_config('apnadairy.farmer_link', 'off', true);
  perform public.notify(r.farmer_id, 'center_accepted', v_center || ' accepted you',
    'You can now bring your milk to ' || v_center || '. Each can is tested and priced in front of you.', null, true);
end;
$$;
revoke all on function public.answer_farmer_request(uuid, boolean, text) from public, anon;
grant execute on function public.answer_farmer_request(uuid, boolean, text) to authenticated;

-- the farmer leaves their center (milk already sold stays in the records)
create or replace function public.leave_center(p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare r public.farmer_requests; v_name text; v_owner uuid;
begin
  select * into r from farmer_requests where farmer_id = auth.uid() and status = 'accepted' for update;
  if r.id is null then raise exception 'you are not connected to a center'; end if;
  if exists (select 1 from milk_collections m join farmers f on f.id = m.farmer_id
             where f.profile_id = auth.uid() and f.area_manager_id = r.area_manager_id and m.status = 'offered') then
    raise exception 'answer the price offer waiting at your center first';
  end if;
  update farmer_requests set status = 'ended', ended_at = now(), reason = nullif(trim(p_reason), '') where id = r.id;
  update farmers set is_active = false where area_manager_id = r.area_manager_id and profile_id = auth.uid();
  select full_name into v_name from profiles where id = auth.uid();
  select user_id into v_owner from area_managers where id = r.area_manager_id;
  perform public.notify(v_owner, 'farmer_left', v_name || ' stopped selling to you',
    coalesce('Reason: ' || nullif(trim(p_reason), ''), 'No reason given.'), '/manager/farmers');
end;
$$;
revoke all on function public.leave_center(text) from public, anon;
grant execute on function public.leave_center(text) to authenticated;

-- a farmer rates a center they sold to (one review each, can be changed)
create or replace function public.rate_center(p_center uuid, p_rating integer, p_comment text default null)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from farmer_requests where farmer_id = auth.uid() and area_manager_id = p_center and status in ('accepted', 'ended')) then
    raise exception 'you can rate a center after it accepts you';
  end if;
  if p_rating not between 1 and 5 then raise exception 'give 1 to 5 stars'; end if;
  if char_length(p_comment) > 300 then raise exception 'the comment is too long (300 characters at most)'; end if;
  insert into center_reviews (area_manager_id, farmer_id, rating, comment)
  values (p_center, auth.uid(), p_rating, nullif(trim(p_comment), ''))
  on conflict (area_manager_id, farmer_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = now();
end;
$$;
revoke all on function public.rate_center(uuid, integer, text) from public, anon;
grant execute on function public.rate_center(uuid, integer, text) to authenticated;

-- ---------- the center's side ----------
-- requests with the farmer's details (the center can read them only because the farmer asked)
create or replace function public.my_farmer_requests()
returns table (id uuid, farmer_id uuid, status text, note text, reason text, created_at timestamptz, answered_at timestamptz,
               full_name text, phone text, email text, photo_path text, city text, village text, address text, farm_name text,
               milk_type text, cattle_count integer, daily_litres numeric, notes text, approved_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select r.id, r.farmer_id, r.status, r.note, r.reason, r.created_at, r.answered_at,
         p.full_name, p.phone, p.email, fp.photo_path, fp.city, fp.village, fp.address, fp.farm_name, fp.milk_type::text,
         fp.cattle_count, fp.daily_litres, fp.notes, fp.verified_at
  from farmer_requests r
  join profiles p on p.id = r.farmer_id
  left join farmer_profiles fp on fp.user_id = r.farmer_id
  where r.area_manager_id = public.my_milk_center_id()
  order by (r.status = 'pending') desc, r.created_at desc
  limit 200;
$$;
revoke all on function public.my_farmer_requests() from public, anon;
grant execute on function public.my_farmer_requests() to authenticated;

-- one call for the app's farmer home screen
create or replace function public.farmer_home()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'status', p.status,
    'profile', (select to_jsonb(fp) from farmer_profiles fp where fp.user_id = p.id),
    'center', (select jsonb_build_object('id', a.id, 'center_name', a.center_name, 'city', a.city, 'address', a.address,
                                         'since', r.answered_at, 'farmer_row', f.id)
                 from farmer_requests r join area_managers a on a.id = r.area_manager_id
                 left join farmers f on f.area_manager_id = a.id and f.profile_id = p.id
                where r.farmer_id = p.id and r.status = 'accepted' limit 1),
    'request', (select jsonb_build_object('id', r.id, 'center_id', r.area_manager_id, 'center_name', a.center_name, 'created_at', r.created_at)
                  from farmer_requests r join area_managers a on a.id = r.area_manager_id
                 where r.farmer_id = p.id and r.status = 'pending' limit 1))
  from profiles p where p.id = auth.uid() and p.role = 'farmer';
$$;
revoke all on function public.farmer_home() from public, anon;
grant execute on function public.farmer_home() to authenticated;

-- farmers already linked to a center before this file keep that connection
insert into farmer_requests (farmer_id, area_manager_id, status, created_at, answered_at)
select distinct on (f.profile_id) f.profile_id, f.area_manager_id, 'accepted', f.created_at, f.created_at
from farmers f join profiles p on p.id = f.profile_id and p.role = 'farmer'
where f.profile_id is not null and f.is_active
  and not exists (select 1 from farmer_requests r where r.farmer_id = f.profile_id and r.status in ('pending', 'accepted'))
order by f.profile_id, f.created_at desc;
