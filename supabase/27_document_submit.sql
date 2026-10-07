-- 27: sign-up documents are submitted once, when all of them are uploaded
-- run after 26_model1.sql (safe to run again).
--
-- area managers: cnic front and back, business registration, utility bill, photo of the center, bank statement
-- businesses:    cnic front and back, business registration, ntn certificate ("other" stays optional)
-- after submitting, the documents are locked and the admin can approve.

alter table public.area_managers add column if not exists docs_submitted_at timestamptz;
alter table public.business_profiles add column if not exists docs_submitted_at timestamptz;

create or replace function public.required_doc_types(p_role user_role)
returns text[]
language sql immutable
as $$
  select case p_role
    when 'area_manager' then array['cnic_front', 'cnic_back', 'business_registration', 'utility_bill', 'shop_photo', 'bank_statement']
    when 'business' then array['cnic_front', 'cnic_back', 'business_registration', 'ntn_certificate']
    else array[]::text[] end;
$$;

-- every required document is uploaded (and the file really is in storage)
create or replace function public.has_required_docs(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (
    select 1 from unnest(public.required_doc_types((select role from profiles where id = p_user))) t(doc_type)
     where not exists (
       select 1 from verification_documents v
        where v.user_id = p_user and v.doc_type::text = t.doc_type and split_part(v.file_path, '/', 1) = p_user::text
          and exists (select 1 from storage.objects o where o.bucket_id = 'verification-docs' and o.name = v.file_path)));
$$;

create or replace function public.submit_documents()
returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare
  v_role user_role;
  v_status account_status;
  v_at timestamptz := now();
begin
  select role, status into v_role, v_status from profiles where id = auth.uid();
  if v_role not in ('area_manager', 'business') then raise exception 'only area managers and businesses send documents'; end if;
  if v_status <> 'pending' then raise exception 'your account is not waiting for approval'; end if;
  if not public.has_required_docs(auth.uid()) then raise exception 'upload every required document first'; end if;
  if v_role = 'area_manager' then
    update area_managers set docs_submitted_at = coalesce(docs_submitted_at, v_at) where user_id = auth.uid() returning docs_submitted_at into v_at;
  else
    update business_profiles set docs_submitted_at = coalesce(docs_submitted_at, v_at) where user_id = auth.uid() returning docs_submitted_at into v_at;
  end if;
  return v_at;
end;
$$;

-- once submitted, documents cannot be added or removed
create or replace function public.docs_open(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select not exists (select 1 from area_managers where user_id = p_user and docs_submitted_at is not null)
     and not exists (select 1 from business_profiles where user_id = p_user and docs_submitted_at is not null);
$$;
drop policy if exists "docs: insert own" on public.verification_documents;
create policy "docs: insert own" on public.verification_documents for insert
  with check (user_id = auth.uid() and split_part(file_path, '/', 1) = auth.uid()::text and public.docs_open(auth.uid()));
drop policy if exists "docs: delete own while pending" on public.verification_documents;
create policy "docs: delete own while pending" on public.verification_documents for delete
  using (user_id = auth.uid() and public.docs_open(auth.uid())
         and exists (select 1 from profiles p where p.id = auth.uid() and p.status <> 'active'));

-- the admin approves only after the documents are submitted
create or replace function public.set_verification(p_kind text, p_id uuid, p_status account_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_sent timestamptz;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;

  if p_kind = 'area_manager' then
    select user_id, docs_submitted_at into v_user, v_sent from public.area_managers where id = p_id;
  elsif p_kind = 'business' then
    select user_id, docs_submitted_at into v_user, v_sent from public.business_profiles where id = p_id;
  else
    raise exception 'unknown kind %', p_kind;
  end if;
  if v_user is null then raise exception 'record not found'; end if;

  if p_status = 'active' and (v_sent is null or not public.has_required_docs(v_user)) then
    raise exception 'cannot approve: the documents are not submitted yet';
  end if;

  if p_kind = 'area_manager' then
    update public.area_managers set verification_status = p_status, verified_by = auth.uid(), verified_at = now(), rejection_reason = p_reason where id = p_id;
  else
    update public.business_profiles set verification_status = p_status, verified_by = auth.uid(), verified_at = now(), rejection_reason = p_reason where id = p_id;
  end if;
  update public.profiles set status = p_status, updated_at = now() where id = v_user;
end;
$$;

-- accounts approved before this step count as submitted
update public.area_managers set docs_submitted_at = coalesce(verified_at, created_at) where docs_submitted_at is null and verification_status <> 'pending';
update public.business_profiles set docs_submitted_at = coalesce(verified_at, created_at) where docs_submitted_at is null and verification_status <> 'pending';

revoke all on function public.submit_documents(), public.docs_open(uuid) from public, anon;
grant execute on function public.submit_documents(), public.docs_open(uuid), public.required_doc_types(user_role) to authenticated;
