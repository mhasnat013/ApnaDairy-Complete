-- reset for testing: removes every user and all data, keeps one super admin and the platform settings.
-- this cannot be undone. take a backup first if you may need the data (database → backups).
--
-- before running, put two values on the two set_config lines below (do not commit them):
--   1. the email of the super admin to keep
--   2. the new password for that admin (at least 12 characters, with upper and lower case letters, a number and a symbol)
--
-- kept:    that admin's login and profile, platform settings, billing tiers, market rates, iot devices (unassigned)
-- removed: every other login and profile, centers, farmers, businesses, sellers, milk tests, collections, stock,
--          listings, shop and bulk orders, bids, bills, payouts, reviews, notifications, support tickets, ai answers
-- uploaded photos stay in storage: empty the buckets in storage (farmer-photos, shop-photos, documents) by hand.

select set_config('reset.keep_email', 'PUT-ADMIN-EMAIL-HERE', false);
select set_config('reset.password', 'PUT-NEW-PASSWORD-HERE', false);

do $$
declare
  v_email text := lower(trim(current_setting('reset.keep_email')));
  v_pw    text := current_setting('reset.password');
  v_keep  uuid;
  v_tabs  text;
begin
  -- checks first: nothing is removed if one fails
  select p.id into v_keep from public.profiles p join auth.users u on u.id = p.id
   where lower(u.email) = v_email and p.role = 'super_admin';
  if v_keep is null then
    raise exception 'no super admin with the email %. put the right email on the first set_config line', v_email;
  end if;
  if length(v_pw) < 12 or v_pw !~ '[a-z]' or v_pw !~ '[A-Z]' or v_pw !~ '[0-9]' or v_pw !~ '[^a-zA-Z0-9]' then
    raise exception 'the password must have at least 12 characters, upper and lower case letters, a number and a symbol';
  end if;

  -- 1. all data tables at once (settings, devices, centers and profiles are handled below)
  select string_agg(format('public.%I', c.relname), ', ') into v_tabs
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname not in ('profiles', 'area_managers', 'iot_devices', 'platform_settings', 'billing_tiers', 'market_rates');
  execute 'truncate ' || v_tabs || ' restart identity';

  -- 2. devices stay, but belong to no center
  update public.iot_devices set area_manager_id = null;

  -- 3. centers and sellers, then every profile and login except the admin
  delete from public.area_managers;
  delete from public.profiles where id <> v_keep;
  delete from auth.users where id <> v_keep;

  -- 4. the admin: active, with the new password, signed out everywhere
  update public.profiles set status = 'active' where id = v_keep;
  update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = now()
   where id = v_keep;
  delete from auth.refresh_tokens;
  delete from auth.sessions;

  raise notice 'done: only % is left', v_email;
end $$;

-- forget the password typed above for the rest of this session
select set_config('reset.password', '', false);

-- what is left (should be one profile and one login)
select (select count(*) from public.profiles) as profiles, (select count(*) from auth.users) as logins,
       (select count(*) from public.iot_devices) as devices, (select count(*) from public.market_rates) as market_rates;
