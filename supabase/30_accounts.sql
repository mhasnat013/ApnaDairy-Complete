-- 30: account opening and admins
-- run after 29_result_folder.sql (safe to run again).
--
-- 1. a google sign-up becomes an area manager or business with the same details and checks as the email sign-up
-- 2. new admins are invited by email; the account becomes an admin only after the person opens the link
--    (that confirms the email), never before
-- 3. users can change their own name and phone (the phone is only for records, no sms)

-- ---------- 1. google sign-up: finish the portal sign-up ----------
-- a google login starts as a plain account (no role was chosen). this turns it into a pending
-- area manager or business, exactly like the email sign-up form, before any documents are sent.
create or replace function public.complete_portal_signup(
  p_role text, p_full_name text, p_phone text, p_city text, p_address text default null,
  p_manager_type text default 'milk_center', p_center_name text default null,
  p_business_name text default null, p_business_type text default 'other')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'sign in again'; end if;
  if me.role <> 'customer' then raise exception 'this account is already set up'; end if;
  if exists (select 1 from shop_orders where customer_id = me.id) then
    raise exception 'this account is used in the customer app. sign up with another google account or email';
  end if;
  if p_role not in ('area_manager', 'business') then raise exception 'choose area manager or business'; end if;
  if char_length(trim(coalesce(p_full_name, ''))) not between 2 and 80 then raise exception 'enter your full name'; end if;
  if coalesce(trim(p_phone), '') = '' or not public.is_pk_mobile(p_phone) then raise exception 'phone must be a mobile number like 0300 1234567'; end if;
  if char_length(trim(coalesce(p_city, ''))) not between 2 and 40 then raise exception 'enter your city'; end if;

  if p_role = 'area_manager' then
    if char_length(trim(coalesce(p_center_name, ''))) not between 2 and 80 then raise exception 'enter the center or shop name'; end if;
    if p_manager_type not in ('milk_center', 'byproduct') then raise exception 'choose what you operate'; end if;
    insert into area_managers (user_id, type, center_name, city, address)
    values (me.id, p_manager_type::area_manager_type, trim(p_center_name), initcap(trim(p_city)), nullif(trim(p_address), ''));
  else
    if char_length(trim(coalesce(p_business_name, ''))) not between 2 and 80 then raise exception 'enter the business name'; end if;
    insert into business_profiles (user_id, business_name, business_type, city, address)
    values (me.id, trim(p_business_name), p_business_type::business_type, initcap(trim(p_city)), nullif(trim(p_address), ''));
  end if;

  update profiles set role = p_role::user_role, status = 'pending', full_name = trim(p_full_name),
         phone = trim(p_phone), updated_at = now() where id = me.id;
end;
$$;
revoke all on function public.complete_portal_signup(text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.complete_portal_signup(text, text, text, text, text, text, text, text, text) to authenticated;

-- ---------- 2. admin invites ----------
create table if not exists public.admin_invites (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text not null,
  invited_by  uuid references public.profiles(id),
  invited_at  timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.admin_invites enable row level security;
drop policy if exists "admin invites: admins read" on public.admin_invites;
create policy "admin invites: admins read" on public.admin_invites for select to authenticated using (public.is_admin());

-- opening the invite link confirms the email; only then does the account become an admin
create or replace function public.accept_admin_invite()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.email_confirmed_at is null and new.email_confirmed_at is not null
     and exists (select 1 from admin_invites where user_id = new.id and accepted_at is null) then
    update profiles set role = 'super_admin', status = 'active', updated_at = now() where id = new.id;
    update admin_invites set accepted_at = now() where user_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_admin_invite_accepted on auth.users;
create trigger on_admin_invite_accepted after update of email_confirmed_at on auth.users
  for each row execute function public.accept_admin_invite();
revoke all on function public.accept_admin_invite() from public, anon, authenticated;

-- the old way (instant admin with a password) is closed
revoke execute on function public.make_new_admin(uuid) from public, anon, authenticated, service_role;
