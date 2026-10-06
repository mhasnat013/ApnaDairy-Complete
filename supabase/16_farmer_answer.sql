-- 16: the farmer answers the offer at the center, not in the app
-- run after 15_business.sql (safe to run again).
-- the area manager shows the farmer the test result and the price, then records the farmer's answer.

create or replace function public.record_farmer_answer(p_id uuid, p_accept boolean)
returns text
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from milk_collections m
                 where m.id = p_id and m.area_manager_id = public.my_milk_center_id() and m.status = 'offered') then
    raise exception 'this offer is no longer waiting for an answer';
  end if;
  return public.accept_offer_internal(p_id, p_accept, case when p_accept then null else 'Farmer refused the price' end);
end;
$$;

revoke execute on function public.record_farmer_answer(uuid, boolean) from public, anon;
grant execute on function public.record_farmer_answer(uuid, boolean) to authenticated;
