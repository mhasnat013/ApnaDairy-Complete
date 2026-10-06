-- 18: super admins are created on their own page, never by promoting another account
-- run after 17_security.sql (safe to run again).
-- new admins are created by the edge function "admin-users" (it needs the service role to create a login).

-- the edge function calls this after creating the login; only the service role can run it
create or replace function public.make_new_admin(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update profiles set role = 'super_admin', status = 'active', updated_at = now() where id = p_user;
  if not found then raise exception 'account not found'; end if;
end;
$$;
revoke execute on function public.make_new_admin(uuid) from public, anon, authenticated;

-- removing an admin switches the account off; area managers, businesses and farmers are never made admin
create or replace function public.set_admin(p_user uuid, p_make_admin boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  if p_make_admin then raise exception 'create new admins on the Admins page'; end if;
  if p_user = auth.uid() then raise exception 'you cannot remove your own admin access'; end if;
  if not exists (select 1 from profiles where id = p_user and role = 'super_admin') then raise exception 'this account is not an admin'; end if;
  if (select count(*) from profiles where role = 'super_admin' and status = 'active' and id <> p_user) < 1 then
    raise exception 'there must always be at least one admin';
  end if;
  update profiles set role = 'customer', status = 'suspended', updated_at = now() where id = p_user;
end;
$$;
revoke execute on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
