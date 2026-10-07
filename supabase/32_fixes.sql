-- 32: fixes from the full check
-- run after 31_support.sql (safe to run again).
--
-- 1. dairy product sellers can add shop photos and a shop profile (the row was tied to milk centers only)
-- 2. apnadairy settles a farmer's payment dispute: either the farmer was paid (the payment counts again)
--    or not (the milk stays unpaid and the center has to pay it)

-- ---------- 1. shop photos and profile for every approved seller ----------
alter table public.shop_photos alter column area_manager_id set default public.my_seller_id();
alter table public.shop_profiles alter column area_manager_id set default public.my_seller_id();

-- ---------- 2. payment disputes ----------
alter table public.farmer_payouts
  add column if not exists disputed_collections uuid[],                 -- the milk that payment covered
  add column if not exists settled_outcome text check (settled_outcome in ('paid', 'not_paid')),
  add column if not exists settled_note text check (settled_note is null or char_length(settled_note) <= 500),
  add column if not exists settled_at timestamptz,
  add column if not exists settled_by uuid references public.profiles(id) on delete set null;

-- the farmer answers: on a dispute, remember which milk the payment covered before it goes back to unpaid
create or replace function public.answer_payout_internal(p_id uuid, p_confirm boolean, p_note text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v public.farmer_payouts;
begin
  select * into v from farmer_payouts where id = p_id for update;
  if v.id is null then raise exception 'payment not found'; end if;
  if v.status <> 'sent' then raise exception 'this payment has already been answered'; end if;
  if p_confirm then
    update farmer_payouts set status = 'confirmed', answered_at = now(), farmer_note = nullif(trim(p_note), ''),
           receipt_no = 'AD-P-' || lpad(nextval('payout_receipt_seq')::text, 6, '0')
     where id = p_id;
    update milk_collections set payment = 'paid', paid_at = now() where payout_id = p_id;
  else
    update farmer_payouts set status = 'disputed', answered_at = now(),
           farmer_note = coalesce(nullif(trim(p_note), ''), 'Farmer says the money was not received'),
           disputed_collections = (select array_agg(id) from milk_collections where payout_id = p_id)
     where id = p_id;
    update milk_collections set payout_id = null where payout_id = p_id;   -- back to unpaid, can be sent again
  end if;
end;
$$;
revoke execute on function public.answer_payout_internal(uuid, boolean, text) from public, anon, authenticated;

-- apnadairy checks the proof (wallet or bank reference, a call to both sides) and decides
create or replace function public.settle_payout_dispute(p_id uuid, p_paid boolean, p_note text)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v public.farmer_payouts;
  v_ids uuid[];
  v_total numeric;
  v_n integer;
begin
  if not public.is_admin() then raise exception 'only apnadairy can settle a dispute'; end if;
  select * into v from farmer_payouts where id = p_id for update;
  if v.id is null then raise exception 'payment not found'; end if;
  if v.status <> 'disputed' or v.settled_at is not null then raise exception 'this dispute is already settled'; end if;
  if char_length(trim(coalesce(p_note, ''))) < 5 then raise exception 'write what you checked (at least 5 letters)'; end if;

  if not p_paid then
    update farmer_payouts set settled_outcome = 'not_paid', settled_note = trim(p_note), settled_at = now(), settled_by = auth.uid() where id = p_id;
    return 'not_paid';
  end if;

  -- the farmer was paid: the same milk counts as paid again, if the center has not paid it a second time
  if v.disputed_collections is null then
    raise exception 'this dispute is older than this check, so it is not known which milk it covered. settle it as not paid and write what you found';
  end if;
  perform 1 from milk_collections where id = any(v.disputed_collections) for update;   -- no new payment can take this milk meanwhile
  select array_agg(m.id), coalesce(sum(m.total_amount), 0) into v_ids, v_total
    from milk_collections m
   where m.id = any(v.disputed_collections) and m.status = 'accepted' and m.payment = 'unpaid' and m.payout_id is null;
  if v_ids is null or array_length(v_ids, 1) <> array_length(v.disputed_collections, 1) then
    raise exception 'some of this milk was paid again or cancelled since. settle it as not paid and write what you found';
  end if;
  if round(v_total, 2) <> round(v.amount, 2) then
    raise exception 'this milk was corrected since (it now comes to Rs %, the payment was Rs %). settle it as not paid and write what you found', round(v_total), round(v.amount);
  end if;
  update milk_collections set payout_id = v.id, payment = 'paid', paid_at = now()
   where id = any(v_ids) and payment = 'unpaid' and payout_id is null;
  get diagnostics v_n = row_count;
  if v_n <> array_length(v_ids, 1) then raise exception 'this milk changed while saving. try again'; end if;
  update farmer_payouts set status = 'confirmed', settled_outcome = 'paid', settled_note = trim(p_note), settled_at = now(), settled_by = auth.uid(),
         receipt_no = coalesce(receipt_no, 'AD-P-' || lpad(nextval('payout_receipt_seq')::text, 6, '0'))
   where id = p_id;
  return 'paid';
end;
$$;
revoke all on function public.settle_payout_dispute(uuid, boolean, text) from public, anon;
grant execute on function public.settle_payout_dispute(uuid, boolean, text) to authenticated;
