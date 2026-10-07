-- 33: a rejected applicant can sign up again with the same email
-- run after 32_fixes.sql (safe to run again).
--
-- after the admin rejects an application and the rejection email is sent, the login is removed so the email is free
-- for a new sign-up. the admin keeps a record of every rejection in rejected_applications.
-- accounts that are already rejected are moved to that record now, and their logins removed.

create table if not exists public.rejected_applications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,                       -- the removed login
  kind        text not null check (kind in ('area_manager', 'business')),
  email       text,
  full_name   text,
  phone       text,
  place_name  text,                       -- center or business name
  place_type  text,
  city        text,
  reason      text,
  documents   integer not null default 0,
  applied_at  timestamptz,
  rejected_at timestamptz not null default now(),
  rejected_by uuid references public.profiles(id) on delete set null
);
create index if not exists rejected_applications_kind on public.rejected_applications (kind, rejected_at desc);
alter table public.rejected_applications enable row level security;
drop policy if exists "rejected applications: admins read" on public.rejected_applications;
create policy "rejected applications: admins read" on public.rejected_applications for select to authenticated using (public.is_admin());

-- the work, without the admin check (used by the admin function below and by the one-time move at the end)
create or replace function public.remove_rejected_internal(p_user uuid, p_by uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  p public.profiles;
  a public.area_managers;
  b public.business_profiles;
  v_docs integer;
begin
  select * into p from profiles where id = p_user;
  if p.id is null then raise exception 'account not found'; end if;
  if p.status <> 'rejected' or p.role not in ('area_manager', 'business') then
    raise exception 'only a rejected application can be removed';
  end if;
  select * into a from area_managers where user_id = p_user;
  select * into b from business_profiles where user_id = p_user;
  select count(*) into v_docs from verification_documents where user_id = p_user;

  insert into rejected_applications (user_id, kind, email, full_name, phone, place_name, place_type, city, reason, documents,
                                     applied_at, rejected_at, rejected_by)
  values (p.id, p.role::text, p.email, p.full_name, p.phone,
          coalesce(a.center_name, b.business_name), coalesce(a.type::text, b.business_type::text), coalesce(a.city, b.city),
          coalesce(a.rejection_reason, b.rejection_reason), v_docs,
          coalesce(a.created_at, b.created_at), coalesce(a.verified_at, b.verified_at, now()), coalesce(p_by, a.verified_by, b.verified_by));

  -- their uploaded documents (if storage allows removing them from sql; otherwise the files just stay unused)
  begin
    delete from storage.objects where bucket_id = 'verification-docs' and (storage.foldername(name))[1] = p_user::text;
  exception when others then null;
  end;

  delete from auth.users where id = p_user;   -- profile, application and document rows go with it
end;
$$;
revoke all on function public.remove_rejected_internal(uuid, uuid) from public, anon, authenticated;

-- the admin calls this right after the rejection email is sent
create or replace function public.remove_rejected_account(p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  perform public.remove_rejected_internal(p_user, auth.uid());
end;
$$;
revoke all on function public.remove_rejected_account(uuid) from public, anon;
grant execute on function public.remove_rejected_account(uuid) to authenticated;

-- one time: accounts rejected before this file free their emails now
do $$
declare r record;
begin
  for r in select id from profiles where status = 'rejected' and role in ('area_manager', 'business') loop
    perform public.remove_rejected_internal(r.id, null);
  end loop;
end $$;
