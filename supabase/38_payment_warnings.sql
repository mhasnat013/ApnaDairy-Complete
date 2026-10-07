-- 38: payment tracking, monthly warnings and suspension
-- run after 37_bid_grades.sql (safe to run again).
--
-- every seller (milk center or product seller) pays the iot device once and the platform fee every month.
-- this month's bill is created automatically on the 1st. while a bill is overdue, bidding (and testing) stay paused,
-- and the seller gets a warning every 30 days, by email too. once a bill is unpaid for the number of months the
-- admin sets (3 by default), the seller is "eligible for suspension" and the admins are told. the admin decides:
-- suspend or restore from the billing page. warnings, suspensions and restores are kept as a history.
-- the checks run every day (pg_cron) and whenever the seller or the admin opens billing.

alter table public.platform_settings
  add column if not exists suspend_after_months integer not null default 3;
do $$
begin
  alter table public.platform_settings add constraint suspend_after_range check (suspend_after_months between 1 and 12);
exception when duplicate_object then null;
end $$;

-- ---------- history: warnings, suspensions, restores ----------
create table if not exists public.billing_notices (
  id              uuid primary key default gen_random_uuid(),
  area_manager_id uuid not null references public.area_managers(id) on delete cascade,
  kind            text not null check (kind in ('warning', 'suspended', 'restored')),
  level           integer,                        -- warning number (1 = first month overdue)
  invoice_id      uuid references public.center_invoices(id) on delete set null,   -- the oldest unpaid bill
  amount          numeric(12,2) not null default 0, -- overdue amount at that time
  overdue_days    integer,
  title           text not null,
  note            text,
  created_by      uuid references public.profiles(id) on delete set null,          -- the admin (suspend / restore)
  created_at      timestamptz not null default now()
);
create index if not exists billing_notices_center on public.billing_notices (area_manager_id, created_at desc);
create unique index if not exists billing_notices_one_level on public.billing_notices (area_manager_id, invoice_id, level) where kind = 'warning';

alter table public.billing_notices enable row level security;
drop policy if exists "billing notices: own or admin" on public.billing_notices;
create policy "billing notices: own or admin" on public.billing_notices for select to authenticated
  using (public.is_admin() or exists (select 1 from public.area_managers a where a.id = area_manager_id and a.user_id = auth.uid()));

create or replace function public.fmt_rs(p numeric)
returns text language sql immutable as $$ select 'Rs ' || to_char(round(coalesce(p, 0)), 'FM999,999,999,990') $$;

-- ---------- what a seller owes ----------
create or replace function public.seller_dues(p_center uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  with t as (select (now() at time zone 'Asia/Karachi')::date as d, (select suspend_after_months from platform_settings) as n),
  i as (select * from center_invoices where area_manager_id = p_center and status <> 'void'),
  o as (select min(i.due_date) as oldest, sum(i.amount) as amt, count(*) as bills from i, t where i.status = 'due' and i.due_date < t.d)
  select jsonb_build_object(
    'billed',          coalesce((select sum(amount) from i), 0),
    'paid',            coalesce((select sum(amount) from i where status = 'paid'), 0),
    'outstanding',     coalesce((select sum(amount) from i where status = 'due'), 0),
    'due_bills',       (select count(*) from i where status = 'due'),
    'next_due',        (select min(due_date) from i where status = 'due'),
    'overdue_amount',  coalesce(o.amt, 0),
    'overdue_bills',   o.bills,
    'overdue_since',   o.oldest,
    'overdue_days',    t.d - o.oldest,
    'overdue_months',  (t.d - o.oldest) / 30,
    'suspend_after',   t.n,
    'suspend_from',    o.oldest + t.n * 30,
    'eligible',        coalesce((t.d - o.oldest) >= t.n * 30, false),
    'payment_sent',    exists (select 1 from i where status = 'due' and submitted_at is not null),
    'warnings',        (select count(*) from billing_notices b where b.area_manager_id = p_center and b.kind = 'warning'),
    'last_warning_at', (select max(created_at) from billing_notices b where b.area_manager_id = p_center and b.kind = 'warning'),
    'device_paid',     exists (select 1 from i where kind = 'device' and status = 'paid'),
    'last_paid_at',    (select max(paid_at) from i where status = 'paid')
  )
  from t, o;
$$;
revoke all on function public.seller_dues(uuid) from public, anon, authenticated;

-- the seller's own (also while suspended, so they can see what to pay)
create or replace function public.my_dues()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.seller_dues(a.id) || jsonb_build_object('account_status', p.status, 'reason', a.rejection_reason, 'type', a.type)
    from area_managers a join profiles p on p.id = a.user_id
   where a.user_id = auth.uid() and a.verification_status in ('active', 'suspended');
$$;
revoke all on function public.my_dues() from public, anon;
grant execute on function public.my_dues() to authenticated;

-- a suspended seller cannot open the portal, but still sees and pays its unpaid bills
create or replace function public.my_unpaid_bills()
returns setof public.center_invoices
language sql stable security definer set search_path = public
as $$
  select i.* from center_invoices i join area_managers a on a.id = i.area_manager_id
   where a.user_id = auth.uid() and i.status = 'due' order by i.due_date, i.issued_at;
$$;
revoke all on function public.my_unpaid_bills() from public, anon;
grant execute on function public.my_unpaid_bills() to authenticated;

do $$
declare d text;
begin
  select pg_get_functiondef('public.pay_invoice(uuid,text,text)'::regprocedure) into d;
  if position('elsif v.area_manager_id = public.my_seller_id() then' in d) > 0 then
    d := replace(d, 'elsif v.area_manager_id = public.my_seller_id() then',
      'elsif exists (select 1 from area_managers a where a.id = v.area_manager_id and a.user_id = auth.uid() and a.verification_status in (''active'', ''suspended'')) then');
    execute d;
  end if;
end $$;

-- ---------- monthly warnings ----------
-- one warning per 30 days overdue: warning n of the limit, then a final warning, then "can be suspended" (admins told once)
create or replace function public.billing_warn(p_center uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
  v_n      integer;
  v_inv    public.center_invoices;
  v_amt    numeric;
  v_days   integer;
  v_level  integer;
  v_owner  uuid;
  v_name   text;
  v_type   text;
  v_paused text;
  v_title  text;
  v_body   text;
  v_until  date;
begin
  select suspend_after_months into v_n from platform_settings;
  select a.user_id, a.center_name, a.type into v_owner, v_name, v_type
    from area_managers a join profiles p on p.id = a.user_id
   where a.id = p_center and a.verification_status = 'active' and p.status = 'active';
  if v_owner is null then return false; end if;

  -- the oldest overdue bill the seller has not already sent a payment for
  select * into v_inv from center_invoices
   where area_manager_id = p_center and status = 'due' and due_date < v_today and submitted_at is null
   order by due_date, issued_at limit 1;
  if v_inv.id is null then return false; end if;
  select sum(amount) into v_amt from center_invoices
   where area_manager_id = p_center and status = 'due' and due_date < v_today and submitted_at is null;

  v_days  := v_today - v_inv.due_date;
  v_level := v_days / 30 + 1;
  v_until := v_inv.due_date + v_n * 30;
  if exists (select 1 from billing_notices where area_manager_id = p_center and invoice_id = v_inv.id and kind = 'warning' and level = v_level) then
    return false;
  end if;
  -- after an older bill is paid, do not send a second warning the same month
  if exists (select 1 from billing_notices where area_manager_id = p_center and kind = 'warning' and level >= v_level
               and created_at > now() - interval '25 days') then
    return false;
  end if;

  v_paused := case when v_type = 'milk_center' then 'Bidding and milk testing are paused' else 'Bidding is paused' end || ' until it is paid.';
  if v_level < v_n then
    v_title := 'Payment overdue: ' || public.fmt_rs(v_amt);
    v_body  := 'Your bill was due on ' || to_char(v_inv.due_date, 'FMDD Mon YYYY') || '. ' || v_paused
               || ' Warning ' || v_level || ' of ' || v_n || ': if it is still unpaid on ' || to_char(v_until, 'FMDD Mon YYYY')
               || ', your account can be suspended.';
  elsif v_level = v_n then
    v_title := 'Final warning: ' || public.fmt_rs(v_amt) || ' overdue';
    v_body  := 'Pay before ' || to_char(v_until, 'FMDD Mon YYYY') || ', or your account can be suspended. ' || v_paused;
  else
    v_title := 'Your account can be suspended';
    v_body  := public.fmt_rs(v_amt) || ' has been unpaid since ' || to_char(v_inv.due_date, 'FMDD Mon YYYY')
               || ' (' || (v_days / 30) || ' months). ApnaDairy can suspend your account now. Pay and send the transaction ID from Billing.';
  end if;

  insert into billing_notices (area_manager_id, kind, level, invoice_id, amount, overdue_days, title, note)
  values (p_center, 'warning', v_level, v_inv.id, v_amt, v_days, v_title, v_body);
  perform public.notify(v_owner, 'billing_warning', v_title, v_body, '/manager/billing', true);
  if v_level = v_n + 1 then
    perform public.notify_admins('billing_suspend', v_name || ' can be suspended',
      public.fmt_rs(v_amt) || ' unpaid for ' || (v_days / 30) || ' months. Review it in Billing.', '/admin/billing?tab=sellers');
  end if;
  return true;
end;
$$;
revoke all on function public.billing_warn(uuid) from public, anon, authenticated;

-- the daily job: this month's bills, then warnings
create or replace function public.billing_job()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Karachi')::date;
  v_month date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date;
  r record;
  n integer := 0;
begin
  for r in select a.id, a.is_demo from area_managers a join profiles p on p.id = a.user_id
            where a.verification_status = 'active' and p.status = 'active' loop
    if not exists (select 1 from center_invoices where area_manager_id = r.id and kind = 'monthly' and period_month = v_month and status <> 'void') then
      perform public.bill_center_month(r.id, v_month, coalesce(r.is_demo, false));
    end if;
  end loop;
  for r in select distinct area_manager_id as id from center_invoices where status = 'due' and due_date < v_today loop
    if public.billing_warn(r.id) then n := n + 1; end if;
  end loop;
  return n;
end;
$$;
revoke all on function public.billing_job() from public, anon, authenticated;

-- the seller's billing page calls this when it opens
create or replace function public.run_my_billing()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_center uuid := public.my_seller_id();
  v_month  date := date_trunc('month', (now() at time zone 'Asia/Karachi'))::date;
begin
  if v_center is null then return; end if;
  if not exists (select 1 from center_invoices where area_manager_id = v_center and kind = 'monthly' and period_month = v_month and status <> 'void') then
    perform public.bill_center_month(v_center, v_month, coalesce((select is_demo from area_managers where id = v_center), false));
  end if;
  perform public.billing_warn(v_center);
end;
$$;
revoke all on function public.run_my_billing() from public, anon;
grant execute on function public.run_my_billing() to authenticated;

-- the admin's billing page calls this when it opens
create or replace function public.run_billing_checks()
returns integer
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  return public.billing_job();
end;
$$;
revoke all on function public.run_billing_checks() from public, anon;
grant execute on function public.run_billing_checks() to authenticated;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('apnadairy-billing', '17 4 * * *', 'select public.billing_job()');   -- 09:17 pakistan time
exception when others then
  raise notice 'pg_cron is not available, so billing checks run when billing pages open: %', sqlerrm;
end $$;

-- ---------- admin: every seller's account ----------
create or replace function public.admin_billing_accounts()
returns table (center_id uuid, user_id uuid, center_name text, type text, city text, owner_name text, phone text, email text,
               account_status text, reason text, is_demo boolean, dues jsonb)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  return query
    select a.id, a.user_id, a.center_name, a.type::text, a.city, p.full_name, p.phone, p.email,
           p.status::text, case when p.status = 'suspended' then a.rejection_reason end, coalesce(a.is_demo, false),
           public.seller_dues(a.id)
      from area_managers a join profiles p on p.id = a.user_id
     where a.verification_status in ('active', 'suspended')
     order by a.center_name;
end;
$$;
revoke all on function public.admin_billing_accounts() from public, anon;
grant execute on function public.admin_billing_accounts() to authenticated;

-- suspend or restore a seller from billing; the seller is told (by email too) with the reason
create or replace function public.billing_set_status(p_center uuid, p_suspend boolean, p_reason text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  a public.area_managers;
  v_status account_status;
  v_dues jsonb;
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  p_reason := nullif(trim(p_reason), '');
  select * into a from area_managers where id = p_center for update;
  if a.id is null then raise exception 'seller not found'; end if;
  select status into v_status from profiles where id = a.user_id;
  v_dues := public.seller_dues(p_center);

  if p_suspend then
    if v_status <> 'active' or a.verification_status <> 'active' then raise exception 'only an active seller can be suspended'; end if;
    if coalesce(char_length(p_reason), 0) < 5 then raise exception 'write the reason (at least 5 characters). the seller will see it'; end if;
    if char_length(p_reason) > 300 then raise exception 'the reason is too long (300 characters at most)'; end if;
    update area_managers set verification_status = 'suspended', rejection_reason = p_reason, verified_by = auth.uid(), verified_at = now() where id = p_center;
    update profiles set status = 'suspended', updated_at = now() where id = a.user_id;
    insert into billing_notices (area_manager_id, kind, amount, overdue_days, title, note, created_by, invoice_id)
    values (p_center, 'suspended', (v_dues->>'overdue_amount')::numeric, (v_dues->>'overdue_days')::integer, 'Account suspended', p_reason, auth.uid(),
            (select id from center_invoices where area_manager_id = p_center and status = 'due' order by due_date limit 1));
  else
    if v_status <> 'suspended' then raise exception 'this seller is not suspended'; end if;
    if char_length(p_reason) > 300 then raise exception 'the note is too long (300 characters at most)'; end if;
    update area_managers set verification_status = 'active', rejection_reason = null, verified_by = auth.uid(), verified_at = now() where id = p_center;
    update profiles set status = 'active', updated_at = now() where id = a.user_id;
    insert into billing_notices (area_manager_id, kind, amount, overdue_days, title, note, created_by)
    values (p_center, 'restored', (v_dues->>'overdue_amount')::numeric, (v_dues->>'overdue_days')::integer, 'Account restored', p_reason, auth.uid());
  end if;
end;
$$;
revoke all on function public.billing_set_status(uuid, boolean, text) from public, anon;
grant execute on function public.billing_set_status(uuid, boolean, text) to authenticated;

-- the suspension message carries the reason the admin gave
create or replace function public.notify_account_status()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_reason text;
begin
  if new.status is distinct from old.status and new.role in ('area_manager', 'business', 'farmer') then
    if new.status = 'suspended' then
      select coalesce((select rejection_reason from area_managers where user_id = new.id),
                      (select rejection_reason from business_profiles where user_id = new.id),
                      (select rejection_reason from farmer_profiles where user_id = new.id)) into v_reason;
      perform public.notify(new.id, 'account', 'Your account is suspended',
        case when v_reason is not null then 'Reason: ' || rtrim(v_reason, '. ') || '. ' else '' end || 'Contact ApnaDairy to restore it.', null, true);
    elsif new.status = 'active' and old.status = 'suspended' then
      perform public.notify(new.id, 'account', 'Your account is active again', 'Welcome back. Everything works as before.', null, true);
    end if;
  end if;
  return new;
end;
$$;

-- ---------- bill events ----------
create or replace function public.notify_invoice()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_owner uuid; v_name text;
begin
  select user_id, center_name into v_owner, v_name from area_managers where id = new.area_manager_id;
  if tg_op = 'INSERT' then
    if new.status = 'due' then
      perform public.notify(v_owner, 'bill', 'New bill: ' || new.description,
        public.fmt_rs(new.amount) || ', due ' || to_char(new.due_date, 'FMDD Mon YYYY') || '. Pay it and send the transaction ID from Billing.', '/manager/billing', true);
    end if;
  elsif new.status = 'paid' and old.status <> 'paid' then
    perform public.notify(v_owner, 'bill_paid', 'Payment received: ' || public.fmt_rs(new.amount), new.description || ' is paid. Thank you.', '/manager/billing', true);
  elsif new.status = 'void' and old.status = 'due' then
    perform public.notify(v_owner, 'bill', 'Bill cancelled: ' || new.description, 'You do not need to pay it.', '/manager/billing');
  elsif new.status = 'due' and new.submitted_at is not null and new.submitted_at is distinct from old.submitted_at then
    perform public.notify_admins('bill_payment', v_name || ' sent a payment',
      public.fmt_rs(new.amount) || ' for ' || new.description || ' by ' || case new.payment_method when 'jazzcash' then 'JazzCash' when 'easypaisa' then 'EasyPaisa' when 'bank' then 'bank transfer' else coalesce(new.payment_method, 'transfer') end || ', transaction ID ' || coalesce(new.payment_ref, '-') || '. Check it arrived, then confirm it.',
      '/admin/billing?tab=bills');
  end if;
  return new;
end;
$$;
drop trigger if exists center_invoices_notify on public.center_invoices;
create trigger center_invoices_notify after insert or update of status, submitted_at on public.center_invoices
  for each row execute function public.notify_invoice();
