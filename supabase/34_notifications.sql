-- 34: notifications
-- run after 33_rejected_reapply.sql (safe to run again).
--
-- one inbox for every account (portal bell now, the mobile app later).
-- the database writes them; users only read their own and mark them read.
-- important ones are also emailed: they wait in the table with email = true until the send-email function
-- sends them (kind "outbox"), which the portal triggers whenever someone is signed in.

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  kind       text not null,
  title      text not null check (char_length(title) <= 140),
  body       text check (body is null or char_length(body) <= 1000),
  link       text,                                   -- a portal path, e.g. /manager/farmers?tab=requests
  email      boolean not null default false,         -- also send by email
  emailed_at timestamptz,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user on public.notifications (user_id, created_at desc);
create index if not exists notifications_outbox on public.notifications (created_at) where email and emailed_at is null;

alter table public.notifications enable row level security;
drop policy if exists "notifications: own read" on public.notifications;
create policy "notifications: own read" on public.notifications for select to authenticated using (user_id = auth.uid());

-- used by the other database functions only
create or replace function public.notify(p_user uuid, p_kind text, p_title text, p_body text default null,
                                         p_link text default null, p_email boolean default false)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user is null then return; end if;
  insert into notifications (user_id, kind, title, body, link, email)
  values (p_user, p_kind, left(p_title, 140), left(p_body, 1000), p_link, p_email);
end;
$$;
revoke all on function public.notify(uuid, text, text, text, text, boolean) from public, anon, authenticated;

-- every admin at once
create or replace function public.notify_admins(p_kind text, p_title text, p_body text default null, p_link text default null)
returns void
language sql security definer set search_path = public
as $$
  insert into notifications (user_id, kind, title, body, link)
  select id, p_kind, left(p_title, 140), left(p_body, 1000), p_link from profiles where role = 'super_admin' and status = 'active';
$$;
revoke all on function public.notify_admins(text, text, text, text) from public, anon, authenticated;

-- mark some (or all) of my notifications read
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns void
language sql security definer set search_path = public
as $$
  update notifications set read_at = now()
   where user_id = auth.uid() and read_at is null and (p_ids is null or id = any(p_ids));
$$;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

-- ---------- bulk market events ----------
-- a new bid: tell the business
create or replace function public.notify_new_bid()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_center text; r bulk_requirements;
begin
  select * into r from bulk_requirements where id = new.requirement_id;
  select b.user_id into v_owner from business_profiles b where b.id = r.business_id;
  select center_name into v_center from area_managers where id = new.area_manager_id;
  perform public.notify(v_owner, 'new_bid', v_center || ' sent an offer',
    'Rs ' || public.fmt_qty(new.price_per_l) || ' for ' || public.fmt_qty(new.quantity_l) || case when r.unit = 'kg' then ' kg' else ' L' end || '.',
    '/business/requirements/' || r.id);
  return new;
end;
$$;
drop trigger if exists bids_notify_new on public.bids;
create trigger bids_notify_new after insert on public.bids for each row execute function public.notify_new_bid();

-- an order: tell the seller their bid was accepted; a cancellation: tell the other side
create or replace function public.notify_bulk_order()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_seller uuid; v_buyer uuid; v_buyer_name text; v_seller_name text; v_qty text;
begin
  select user_id, center_name into v_seller, v_seller_name from area_managers where id = new.area_manager_id;
  select user_id, business_name into v_buyer, v_buyer_name from business_profiles where id = new.business_id;
  v_qty := public.fmt_qty(new.quantity_l) || (select case when unit = 'kg' then ' kg' else ' L' end from bulk_requirements where id = new.requirement_id);
  if tg_op = 'INSERT' then
    perform public.notify(v_seller, 'bid_accepted', v_buyer_name || ' accepted your bid',
      v_qty || ' at Rs ' || public.fmt_qty(new.price_per_l) || ', to deliver on ' || to_char(new.delivery_date, 'DD Mon') || '.', '/manager/bulk-orders');
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    if new.cancelled_by = 'center' then
      perform public.notify(v_buyer, 'order_cancelled', v_seller_name || ' cancelled an order', v_qty || ' due on ' || to_char(new.delivery_date, 'DD Mon') || '.', '/business/orders');
    else
      perform public.notify(v_seller, 'order_cancelled', v_buyer_name || ' cancelled an order', v_qty || ' due on ' || to_char(new.delivery_date, 'DD Mon') || '.', '/manager/bulk-orders');
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bulk_orders_notify on public.bulk_orders;
create trigger bulk_orders_notify after insert or update of status on public.bulk_orders for each row execute function public.notify_bulk_order();

-- account approved / rejected / suspended (the approval and rejection emails are already sent by the admin page)
create or replace function public.notify_account_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.role in ('area_manager', 'business', 'farmer') then
    if new.status = 'suspended' then
      perform public.notify(new.id, 'account', 'Your account is suspended', 'Contact ApnaDairy to restore it.', null, true);
    elsif new.status = 'active' and old.status = 'suspended' then
      perform public.notify(new.id, 'account', 'Your account is active again', 'Welcome back. Everything works as before.', null, true);
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_notify_status on public.profiles;
create trigger profiles_notify_status after update of status on public.profiles for each row execute function public.notify_account_status();

-- ---------- email outbox ----------
-- the send-email function (kind "outbox") takes up to 20 waiting emails at a time; two callers never get the same one
create or replace function public.claim_email_outbox()
returns table (id uuid, email text, full_name text, title text, body text, link text)
language sql security definer set search_path = public
as $$
  update notifications n set emailed_at = now()
    from profiles p
   where p.id = n.user_id
     and n.id in (select x.id from notifications x where x.email and x.emailed_at is null
                   order by x.created_at limit 20 for update skip locked)
  returning n.id, p.email, p.full_name, n.title, n.body, n.link;
$$;
revoke all on function public.claim_email_outbox() from public, anon, authenticated;
grant execute on function public.claim_email_outbox() to service_role;
