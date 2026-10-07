-- 31: complaints and support
-- run after 30_accounts.sql (safe to run again).
--
-- anyone signed in (business, area manager, and later the app's customers and farmers) can open a ticket.
-- a ticket about an order also goes to the seller of that order, who can reply to it.
-- only apnadairy or the person who opened a ticket can mark it resolved, so a seller cannot close a complaint about itself.
-- tickets and messages are only written through the functions below.

create table if not exists public.support_tickets (
  id            uuid primary key default gen_random_uuid(),
  ticket_no     bigint generated always as identity unique,
  opened_by     uuid not null references public.profiles(id) on delete cascade,
  topic         text not null check (topic in ('order', 'quality', 'payment', 'billing', 'account', 'app', 'other')),
  subject       text not null check (char_length(trim(subject)) between 3 and 120),
  bulk_order_id uuid references public.bulk_orders(id) on delete set null,
  shop_order_id uuid references public.shop_orders(id) on delete set null,
  center_id     uuid references public.area_managers(id) on delete set null,   -- the seller the complaint is about
  status        text not null default 'open' check (status in ('open', 'answered', 'resolved')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles(id) on delete set null
);
create index if not exists support_tickets_opened_by on public.support_tickets (opened_by, updated_at desc);
create index if not exists support_tickets_center on public.support_tickets (center_id, updated_at desc);
create index if not exists support_tickets_status on public.support_tickets (status, updated_at desc);

create table if not exists public.support_messages (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.support_tickets(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  side       text not null check (side in ('user', 'seller', 'admin')),
  body       text not null check (char_length(trim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists support_messages_ticket on public.support_messages (ticket_id, created_at);

-- who can see a ticket: the person who opened it, the seller it is about, and admins
create or replace function public.can_see_ticket(p_ticket uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from support_tickets t where t.id = p_ticket and (
    t.opened_by = auth.uid() or public.is_admin()
    or (t.center_id is not null and t.center_id = public.my_seller_id())));
$$;
revoke all on function public.can_see_ticket(uuid) from public, anon;
grant execute on function public.can_see_ticket(uuid) to authenticated;

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
drop policy if exists "tickets: people on the ticket read" on public.support_tickets;
create policy "tickets: people on the ticket read" on public.support_tickets for select to authenticated using (public.can_see_ticket(id));
drop policy if exists "ticket messages: people on the ticket read" on public.support_messages;
create policy "ticket messages: people on the ticket read" on public.support_messages for select to authenticated using (public.can_see_ticket(ticket_id));

-- ---------- open a ticket ----------
create or replace function public.open_ticket(
  p_topic text, p_subject text, p_body text,
  p_bulk_order_id uuid default null, p_shop_order_id uuid default null, p_center_id uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  me public.profiles;
  v_center uuid;
  v_id uuid;
  bo public.bulk_orders;
  so public.shop_orders;
begin
  select * into me from profiles where id = auth.uid();
  if me.id is null then raise exception 'sign in again'; end if;
  if me.status <> 'active' then raise exception 'your account is not active yet'; end if;
  if public.is_admin() then raise exception 'admins answer tickets, they do not open them'; end if;
  if p_topic not in ('order', 'quality', 'payment', 'billing', 'account', 'app', 'other') then raise exception 'choose what it is about'; end if;
  if char_length(trim(coalesce(p_subject, ''))) not between 3 and 120 then raise exception 'write a short subject (3 to 120 letters)'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 10 and 2000 then raise exception 'describe the problem (10 to 2000 letters)'; end if;
  if (p_bulk_order_id is not null)::int + (p_shop_order_id is not null)::int + (p_center_id is not null)::int > 1 then
    raise exception 'a ticket can be about one order only';
  end if;
  -- no flooding: 5 new tickets a day
  if (select count(*) from support_tickets where opened_by = me.id and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'you have opened 5 tickets today. add to an open ticket instead, or try again tomorrow';
  end if;

  if p_bulk_order_id is not null then
    select * into bo from bulk_orders where id = p_bulk_order_id;
    if bo.id is null then raise exception 'order not found'; end if;
    if bo.business_id is not distinct from public.my_business_id() then v_center := bo.area_manager_id;   -- buyer: the seller sees it too
    elsif bo.area_manager_id is not distinct from public.my_seller_id() then v_center := null;          -- seller: only apnadairy
    else raise exception 'this is not your order'; end if;
  elsif p_shop_order_id is not null then
    select * into so from shop_orders where id = p_shop_order_id;
    if so.id is null then raise exception 'order not found'; end if;
    if so.customer_id = me.id then v_center := so.area_manager_id;
    elsif so.area_manager_id is not distinct from public.my_seller_id() then v_center := null;
    else raise exception 'this is not your order'; end if;
  elsif p_center_id is not null then
    -- a farmer about the center they sell to
    if not exists (select 1 from farmers f where f.profile_id = me.id and f.area_manager_id = p_center_id) then
      raise exception 'you can only complain about a center you sell milk to';
    end if;
    v_center := p_center_id;
  end if;

  insert into support_tickets (opened_by, topic, subject, bulk_order_id, shop_order_id, center_id)
  values (me.id, p_topic, trim(p_subject), p_bulk_order_id, p_shop_order_id, v_center)
  returning id into v_id;
  insert into support_messages (ticket_id, author_id, side, body) values (v_id, me.id, 'user', trim(p_body));
  return v_id;
end;
$$;
revoke all on function public.open_ticket(text, text, text, uuid, uuid, uuid) from public, anon;
grant execute on function public.open_ticket(text, text, text, uuid, uuid, uuid) to authenticated;

-- ---------- reply ----------
-- the person who opened it: back to "open" (also reopens a resolved ticket)
-- apnadairy or the seller: "answered"
create or replace function public.reply_ticket(p_ticket uuid, p_body text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.support_tickets;
  v_side text;
begin
  select * into t from support_tickets where id = p_ticket for update;
  if t.id is null then raise exception 'ticket not found'; end if;
  if t.opened_by = auth.uid() then v_side := 'user';
  elsif public.is_admin() then v_side := 'admin';
  elsif t.center_id is not null and t.center_id = public.my_seller_id() then v_side := 'seller';
  else raise exception 'you cannot reply to this ticket'; end if;
  if char_length(trim(coalesce(p_body, ''))) not between 1 and 2000 then raise exception 'write a message (up to 2000 letters)'; end if;
  if v_side = 'seller' and t.status = 'resolved' then raise exception 'this ticket is resolved'; end if;
  if (select count(*) from support_messages where author_id = auth.uid() and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many messages. try again in a while';
  end if;

  insert into support_messages (ticket_id, author_id, side, body) values (t.id, auth.uid(), v_side, trim(p_body));
  update support_tickets
     set status = case when v_side = 'user' then 'open' else 'answered' end,
         resolved_at = null, resolved_by = null, updated_at = now()
   where id = t.id;
end;
$$;
revoke all on function public.reply_ticket(uuid, text) from public, anon;
grant execute on function public.reply_ticket(uuid, text) to authenticated;

-- ---------- resolve / reopen ----------
create or replace function public.set_ticket_status(p_ticket uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  t public.support_tickets;
begin
  select * into t from support_tickets where id = p_ticket for update;
  if t.id is null then raise exception 'ticket not found'; end if;
  if not (t.opened_by = auth.uid() or public.is_admin()) then
    raise exception 'only apnadairy or the person who opened the ticket can change it';
  end if;
  if p_status = 'resolved' then
    update support_tickets set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), updated_at = now() where id = t.id;
  elsif p_status = 'open' then
    update support_tickets set status = 'open', resolved_at = null, resolved_by = null, updated_at = now() where id = t.id;
  else
    raise exception 'unknown status';
  end if;
end;
$$;
revoke all on function public.set_ticket_status(uuid, text) from public, anon;
grant execute on function public.set_ticket_status(uuid, text) to authenticated;

-- ---------- lists for the portal ----------
-- every ticket the caller can see, with names and the order it is about
create or replace function public.support_inbox()
returns table (
  id uuid, ticket_no bigint, topic text, subject text, status text, created_at timestamptz, updated_at timestamptz,
  resolved_at timestamptz, opened_by uuid, opener_name text, opener_role text, opener_org text,
  opener_email text, opener_phone text, center_id uuid, center_name text,
  bulk_order_id uuid, shop_order_id uuid, order_info jsonb,
  messages integer, last_side text, last_body text, last_at timestamptz, mine boolean, about_me boolean)
language sql stable security definer set search_path = public
as $$
  select t.id, t.ticket_no, t.topic, t.subject, t.status, t.created_at, t.updated_at, t.resolved_at,
         t.opened_by, p.full_name, p.role::text,
         coalesce(bp.business_name, oam.center_name),
         case when public.is_admin() then p.email end,
         case when public.is_admin() then p.phone end,
         t.center_id, c.center_name,
         t.bulk_order_id, t.shop_order_id,
         case
           when bo.id is not null then jsonb_build_object('kind', 'bulk', 'quantity', bo.quantity_l, 'unit', coalesce(r.unit, 'litre'),
             'product', coalesce(r.product, 'milk'), 'milk_type', r.milk_type, 'date', bo.delivery_date, 'status', bo.status,
             'price', bo.price_per_l, 'buyer', bb.business_name, 'seller', sc.center_name)
           when so.id is not null then jsonb_build_object('kind', 'shop', 'total', so.total_amount, 'date', so.created_at,
             'status', so.status, 'buyer', so.customer_name, 'seller', ssc.center_name)
         end,
         m.n, m.last_side, m.last_body, m.last_at,
         t.opened_by = auth.uid(),
         coalesce(t.center_id = public.my_seller_id(), false)
  from support_tickets t
  join profiles p on p.id = t.opened_by
  left join business_profiles bp on bp.user_id = t.opened_by
  left join area_managers oam on oam.user_id = t.opened_by
  left join area_managers c on c.id = t.center_id
  left join bulk_orders bo on bo.id = t.bulk_order_id
  left join bulk_requirements r on r.id = bo.requirement_id
  left join business_profiles bb on bb.id = bo.business_id
  left join area_managers sc on sc.id = bo.area_manager_id
  left join shop_orders so on so.id = t.shop_order_id
  left join area_managers ssc on ssc.id = so.area_manager_id
  cross join lateral (
    select count(*)::int as n,
           (array_agg(x.side order by x.created_at desc))[1] as last_side,
           (array_agg(x.body order by x.created_at desc))[1] as last_body,
           max(x.created_at) as last_at
    from support_messages x where x.ticket_id = t.id) m
  where t.opened_by = auth.uid() or public.is_admin()
     or (t.center_id is not null and t.center_id = public.my_seller_id())
  order by t.updated_at desc;
$$;
revoke all on function public.support_inbox() from public, anon;
grant execute on function public.support_inbox() to authenticated;

-- one ticket with its messages. admins see who wrote each reply; others see "ApnaDairy support".
create or replace function public.support_thread(p_ticket uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_ticket jsonb;
  v_admin boolean := public.is_admin();
begin
  if not public.can_see_ticket(p_ticket) then raise exception 'ticket not found'; end if;
  select to_jsonb(i) into v_ticket from public.support_inbox() i where i.id = p_ticket;
  return jsonb_build_object('ticket', v_ticket, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', x.id, 'side', x.side, 'body', x.body, 'created_at', x.created_at, 'mine', x.author_id = auth.uid(),
             'author', case
               when x.side = 'admin' then case when v_admin then coalesce(ap.full_name, 'ApnaDairy support') || ' (ApnaDairy)' else 'ApnaDairy support' end
               when x.side = 'seller' then coalesce(c.center_name, 'The seller')
               else coalesce(bp.business_name, ua.center_name, ap.full_name, 'Customer') end)
           order by x.created_at)
    from support_messages x
    join support_tickets t on t.id = x.ticket_id
    left join profiles ap on ap.id = x.author_id
    left join business_profiles bp on bp.user_id = x.author_id
    left join area_managers ua on ua.user_id = x.author_id
    left join area_managers c on c.id = t.center_id
    where x.ticket_id = p_ticket), '[]'::jsonb));
end;
$$;
revoke all on function public.support_thread(uuid) from public, anon;
grant execute on function public.support_thread(uuid) to authenticated;

-- the number on the menu: tickets waiting for this person
create or replace function public.support_waiting()
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int from support_tickets t
  where case
    when public.is_admin() then t.status = 'open'
    else (t.opened_by = auth.uid() and t.status = 'answered')
      or (t.center_id is not null and t.center_id = public.my_seller_id() and t.status = 'open'
          and (select x.side from support_messages x where x.ticket_id = t.id order by x.created_at desc limit 1) = 'user')
  end;
$$;
revoke all on function public.support_waiting() from public, anon;
grant execute on function public.support_waiting() to authenticated;
