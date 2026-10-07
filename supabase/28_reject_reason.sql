-- 28: a rejection always has a reason (it is shown to the applicant and emailed by the send-email function)
-- run after 27_document_submit.sql (safe to run again).

create or replace function public.set_verification(p_kind text, p_id uuid, p_status account_status, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid;
  v_sent timestamptz;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  p_reason := nullif(trim(p_reason), '');
  if p_status = 'rejected' and coalesce(char_length(p_reason), 0) < 10 then
    raise exception 'write the reason for rejecting (at least 10 characters). the applicant will see it';
  end if;
  if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;

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
    update public.area_managers set verification_status = p_status, verified_by = auth.uid(), verified_at = now(),
           rejection_reason = case when p_status = 'active' then null else p_reason end where id = p_id;
  else
    update public.business_profiles set verification_status = p_status, verified_by = auth.uid(), verified_at = now(),
           rejection_reason = case when p_status = 'active' then null else p_reason end where id = p_id;
  end if;
  update public.profiles set status = p_status, updated_at = now() where id = v_user;
end;
$$;
