-- 39: the admin watches the bulk market and can remove a request or a bid
-- run after 38_payment_warnings.sql (safe to run again).
--
-- removing is soft: nothing is deleted. a removed request is cancelled, a removed bid is withdrawn, and both keep
-- who removed it, when and why, so the history stays. the people affected are told (by email too) what was removed and why.
-- a removed bid cannot be sent again on the same request.

alter table public.bulk_requirements
  add column if not exists removed_at     timestamptz,
  add column if not exists removed_by     uuid references public.profiles(id) on delete set null,
  add column if not exists removed_reason text;
alter table public.bids
  add column if not exists removed_at     timestamptz,
  add column if not exists removed_by     uuid references public.profiles(id) on delete set null,
  add column if not exists removed_reason text;

-- "500 L buffalo milk", "20 kg ghee", "12 packs butter"
create or replace function public.req_text(r public.bulk_requirements)
returns text language sql stable as $$
  select public.qty_text(r.quantity_l, r.unit) || ' '
         || case when r.product = 'milk' then r.milk_type::text || ' milk' else r.product::text end;
$$;

-- a removed bid stays removed
create or replace function public.guard_removed_bid()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.removed_at is not null and new.status = 'submitted' then
    raise exception 'ApnaDairy removed your bid on this request (%), so you cannot bid on it again', coalesce(old.removed_reason, 'no reason given');
  end if;
  return new;
end;
$$;
drop trigger if exists bids_guard_removed on public.bids;
create trigger bids_guard_removed before update on public.bids for each row execute function public.guard_removed_bid();

-- ---------- remove a request ----------
create or replace function public.admin_remove_requirement(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r      public.bulk_requirements;
  v_biz  record;
  b      record;
  v_what text;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  p_reason := nullif(trim(p_reason), '');
  if coalesce(char_length(p_reason), 0) < 10 then raise exception 'write the reason (at least 10 characters). the business will see it'; end if;
  if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;

  select * into r from bulk_requirements where id = p_id for update;
  if r.id is null then raise exception 'request not found'; end if;
  if r.removed_at is not null then raise exception 'this request is already removed'; end if;
  if exists (select 1 from bulk_orders where requirement_id = p_id and status in ('confirmed', 'dispatched')) then
    raise exception 'this request has orders in progress. they must be delivered or cancelled before it can be removed';
  end if;
  select bp.user_id, bp.business_name into v_biz from business_profiles bp where bp.id = r.business_id;
  v_what := public.req_text(r);

  update bulk_requirements set status = 'cancelled', removed_at = now(), removed_by = auth.uid(), removed_reason = p_reason where id = p_id;

  -- open bids on it close, and their centers are told
  for b in
    update bids x set status = 'withdrawn', removed_at = now(), removed_by = auth.uid(),
           removed_reason = 'The request was removed by ApnaDairy.', updated_at = now()
     where x.requirement_id = p_id and x.status = 'submitted' and x.removed_at is null
    returning x.area_manager_id, x.price_per_l
  loop
    perform public.notify((select user_id from area_managers where id = b.area_manager_id), 'bid_removed',
      'A request you bid on was removed',
      v_biz.business_name || '''s request for ' || v_what || ', needed on ' || to_char(r.required_date, 'FMDD Mon') || ', was removed by ApnaDairy, so your bid of Rs '
        || public.fmt_qty(b.price_per_l) || ' is closed.',
      '/manager/bulk-requests?tab=mine', true);
  end loop;

  perform public.notify(v_biz.user_id, 'request_removed', 'ApnaDairy removed your request',
    'Your request for ' || v_what || ', needed on ' || to_char(r.required_date, 'FMDD Mon YYYY') || ', was removed. Reason: '
      || rtrim(p_reason, '. ') || '. Bids on it are closed. Contact ApnaDairy if you think this is a mistake.',
    '/business/requirements/' || p_id, true);
end;
$$;
revoke all on function public.admin_remove_requirement(uuid, text) from public, anon;
grant execute on function public.admin_remove_requirement(uuid, text) to authenticated;

-- ---------- remove a bid ----------
create or replace function public.admin_remove_bid(p_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  x       public.bids;
  r       public.bulk_requirements;
  v_biz   record;
  v_owner uuid;
  v_center text;
  v_what  text;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  p_reason := nullif(trim(p_reason), '');
  if coalesce(char_length(p_reason), 0) < 10 then raise exception 'write the reason (at least 10 characters). the center will see it'; end if;
  if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;

  select * into x from bids where id = p_id for update;
  if x.id is null then raise exception 'bid not found'; end if;
  if x.removed_at is not null then raise exception 'this bid is already removed'; end if;
  if x.status = 'accepted' then raise exception 'this bid was accepted and is an order now, so it cannot be removed'; end if;
  if x.status <> 'submitted' then raise exception 'only a bid that is waiting for the buyer can be removed'; end if;
  select * into r from bulk_requirements where id = x.requirement_id;
  select bp.user_id, bp.business_name into v_biz from business_profiles bp where bp.id = r.business_id;
  select user_id, center_name into v_owner, v_center from area_managers where id = x.area_manager_id;
  v_what := public.req_text(r);

  update bids set status = 'withdrawn', removed_at = now(), removed_by = auth.uid(), removed_reason = p_reason, updated_at = now() where id = p_id;

  perform public.notify(v_owner, 'bid_removed', 'ApnaDairy removed your bid',
    'Your bid of Rs ' || public.fmt_qty(x.price_per_l) || ' for ' || public.qty_text(x.quantity_l, r.unit)
      || case when x.offered_quality is not null then ' of ' || x.offered_quality || ' milk' else '' end
      || ' on ' || v_biz.business_name || '''s request for ' || v_what || ' was removed. Reason: ' || rtrim(p_reason, '. ') || '.',
    '/manager/bulk-requests?tab=mine', true);
  perform public.notify(v_biz.user_id, 'bid_removed', 'An offer on your request was removed',
    v_center || '''s offer of Rs ' || public.fmt_qty(x.price_per_l) || ' for ' || public.qty_text(x.quantity_l, r.unit)
      || ' on your ' || v_what || ' request was removed by ApnaDairy.',
    '/business/requirements/' || r.id);
end;
$$;
revoke all on function public.admin_remove_bid(uuid, text) from public, anon;
grant execute on function public.admin_remove_bid(uuid, text) to authenticated;

-- ---------- what the admin sees: every request with its bids and orders ----------
create or replace function public.admin_bulk_market()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb) into v
  from (
    select r.id, r.created_at, r.status, r.product, r.milk_type, r.unit, r.quantity_l, r.quality, r.required_date,
           r.delivery_city, r.target_price, r.bid_deadline, r.notes,
           r.removed_at, r.removed_reason, (select full_name from profiles where id = r.removed_by) as removed_by_name,
           bp.business_name, bp.business_type, bp.city as business_city,
           public.requirement_covered(r.id) as covered_l,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', x.id, 'center_name', a.center_name, 'center_city', a.city, 'center_type', a.type,
                     'price_per_l', x.price_per_l, 'quantity_l', x.quantity_l, 'delivery_date', x.delivery_date,
                     'offered_quality', case when r.product = 'milk' then coalesce(x.offered_quality, r.quality) end,
                     'status', x.status, 'created_at', x.created_at, 'updated_at', x.updated_at, 'notes', x.notes,
                     'removed_at', x.removed_at, 'removed_reason', x.removed_reason,
                     'removed_by_name', (select full_name from profiles where id = x.removed_by))
                   order by (x.status = 'submitted') desc, x.price_per_l), '[]'::jsonb)
              from bids x join area_managers a on a.id = x.area_manager_id where x.requirement_id = r.id) as bids,
           (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', o.id, 'center_name', a.center_name, 'quantity_l', o.quantity_l, 'price_per_l', o.price_per_l,
                     'total_amount', o.total_amount, 'status', o.status, 'quality', o.quality) order by o.created_at), '[]'::jsonb)
              from bulk_orders o join area_managers a on a.id = o.area_manager_id where o.requirement_id = r.id) as orders
      from bulk_requirements r join business_profiles bp on bp.id = r.business_id
     order by r.created_at desc
     limit 300
  ) t;
  return v;
end;
$$;
revoke all on function public.admin_bulk_market() from public, anon;
grant execute on function public.admin_bulk_market() to authenticated;
