-- remove one user and everything that belongs to them (their center or shop, farmers, milk, stock, listings,
-- orders, bids, bills, reviews, notifications). cannot be undone. put the email on the set_config line.
select set_config('reset.remove_email', '233171@students.au.edu.pk', false);

do $$
declare
  v_email text := lower(trim(current_setting('reset.remove_email')));
  v_user  uuid;
  v_role  text;
begin
  select u.id, p.role into v_user, v_role from auth.users u left join public.profiles p on p.id = u.id where lower(u.email) = v_email;
  if v_user is null then raise exception 'no user with the email %', v_email; end if;
  if v_role = 'super_admin' then raise exception 'this is a super admin. remove admins from the admins page instead'; end if;

  -- the rows that would block the delete: bulk orders of their center, and audit lines they made
  delete from public.bulk_orders where area_manager_id in (select id from public.area_managers where user_id = v_user);
  delete from public.collection_audit where actor = v_user;
  delete from public.usage_audit where actor = v_user;

  -- the login; the profile, center or shop and their data go with it
  delete from auth.users where id = v_user;
  raise notice 'removed % (%)', v_email, v_role;
end $$;

select count(*) as left_with_that_email from auth.users where lower(email) = lower(current_setting('reset.remove_email'));
