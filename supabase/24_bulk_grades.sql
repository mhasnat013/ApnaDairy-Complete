-- 24: bulk milk grades come from the iot test
-- run after 23_validation.sql (safe to run again).
--
-- a business asks for standard, fresh or premium milk: the same grades the iot test gives.
-- 1. a center can offer only milk of that grade or better (fresh on the delivery day, plus its usual share of that grade)
-- 2. the dispatch test must show that grade or better, or the milk cannot be sent
-- 3. bids no longer say how old the milk will be; the dispatch test checks freshness instead

-- ---------- 1. graded stock and capacity ----------
drop function if exists public.milk_fresh_at(uuid, milk_kind, timestamptz);
create or replace function public.milk_fresh_at(p_center uuid, p_type milk_kind, p_at timestamptz, p_grade quality_grade default 'standard')
returns numeric
language sql stable security definer set search_path = public
as $$
  with stock as (select greatest(public.milk_in_stock(p_center, p_type), 0) as left_l),
  b as (
    select m.quantity_l, m.quality, coalesce(m.reading_at, m.collected_at) + coalesce(m.freshness_hours, 24) * interval '1 hour' as good_until,
           coalesce(sum(m.quantity_l) over (order by m.collected_at desc, m.id rows between unbounded preceding and 1 preceding), 0) as before_l
    from milk_collections m
    where m.area_manager_id = p_center and m.milk_type = p_type and m.status = 'accepted' and m.collected_at > now() - interval '10 days'
  )
  select coalesce(sum(least(b.quantity_l, greatest(stock.left_l - b.before_l, 0))) filter (where b.good_until > p_at and b.quality >= p_grade), 0)
  from b, stock;
$$;

-- share of the milk a center bought in the last 14 days that tested at this grade or better
create or replace function public.grade_share(p_center uuid, p_type milk_kind, p_grade quality_grade)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(sum(quantity_l) filter (where quality >= p_grade) / nullif(sum(quantity_l), 0), 0)
  from milk_collections
  where area_manager_id = p_center and status = 'accepted' and collected_at >= now() - interval '14 days'
    and (p_type = 'mixed' or milk_type = p_type);
$$;

drop function if exists public.bulk_capacity(uuid, milk_kind, date, uuid);
create or replace function public.bulk_capacity(p_center uuid, p_type milk_kind, p_delivery date, p_skip_requirement uuid default null,
                                                p_grade quality_grade default 'standard')
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Asia/Karachi')::date;
  v_days    integer := greatest(p_delivery - v_today, 0);
  -- delivered by midday on the delivery day
  v_when    timestamptz := greatest(now(), (p_delivery::timestamp + interval '12 hours') at time zone 'Asia/Karachi');
  v_daily   numeric := public.daily_collection(p_center, p_type);
  v_share   numeric := case when p_grade = 'standard' then 1 else public.grade_share(p_center, p_type, p_grade) end;
  v_all     numeric := 0;   -- all fresh milk on the delivery day
  v_stock   numeric := 0;   -- fresh milk of this grade or better
  v_bids    numeric;
  v_orders  numeric;
  v_bids_g  numeric;
  v_orders_g numeric;
  v_listed  numeric := 0;
  v_total   numeric;
  v_graded  numeric;
  t         milk_kind;
begin
  for t in select x from unnest(case when p_type = 'mixed' then array['buffalo', 'cow', 'mixed']::milk_kind[] else array[p_type] end) x loop
    v_all := v_all + public.milk_fresh_at(p_center, t, v_when);
    v_stock := v_stock + public.milk_fresh_at(p_center, t, v_when, p_grade);
  end loop;
  -- milk already promised around that day: all of it, and the part promised at this grade or better
  select coalesce(sum(b.quantity_l), 0), coalesce(sum(b.quantity_l) filter (where r.quality >= p_grade), 0) into v_bids, v_bids_g
    from bids b join bulk_requirements r on r.id = b.requirement_id
   where b.area_manager_id = p_center and b.status = 'submitted' and r.status = 'open' and r.product = 'milk'
     and b.requirement_id is distinct from p_skip_requirement
     and b.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  select coalesce(sum(o.quantity_l), 0), coalesce(sum(o.quantity_l) filter (where r.quality >= p_grade), 0) into v_orders, v_orders_g
    from bulk_orders o join bulk_requirements r on r.id = o.requirement_id
   where o.area_manager_id = p_center and o.status = 'confirmed' and r.product = 'milk'
     and o.delivery_date between p_delivery - 1 and p_delivery + 1
     and (p_type = 'mixed' or r.milk_type in (p_type, 'mixed'));
  if v_days < 2 then
    select coalesce(sum(listed_l), 0) into v_listed from products
     where area_manager_id = p_center and category = 'milk' and is_available and not is_sample
       and (p_type = 'mixed' or milk_type = p_type);
  end if;
  v_total  := v_all + v_daily * least(v_days, 2) - v_bids - v_orders - v_listed;
  v_graded := v_stock + v_daily * v_share * least(v_days, 2) - v_bids_g - v_orders_g;
  return jsonb_build_object('days', v_days, 'grade', p_grade, 'share', round(v_share, 2),
    'daily_l', round(v_daily * v_share, 1), 'stock_l', round(v_stock, 1), 'coming_l', round(v_daily * v_share * least(v_days, 2), 1),
    'promised_l', round(v_bids_g + v_orders_g, 1),
    -- when the center's other promises leave less milk in total than its graded milk
    'total_l', greatest(floor(v_total), 0),
    'max_l', greatest(floor(least(v_total, v_graded)), 0));
end;
$$;

drop function if exists public.my_bid_capacity(milk_kind, date, uuid);
create or replace function public.my_bid_capacity(p_type milk_kind, p_delivery date, p_requirement uuid default null, p_grade quality_grade default 'standard')
returns jsonb
language sql stable security definer set search_path = public
as $$
  select public.bulk_capacity(public.my_milk_center_id(), p_type, p_delivery, p_requirement, p_grade)
  where public.my_milk_center_id() is not null;
$$;

-- place_bid and accept_bid check capacity at the grade the buyer asked for
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.place_bid'::regproc);
  if v_def not like '%p_requirement, v_req.quality)%' then
    v_def := replace(v_def, 'public.bulk_capacity(v_center, v_req.milk_type, p_delivery_date, p_requirement)',
                            'public.bulk_capacity(v_center, v_req.milk_type, p_delivery_date, p_requirement, v_req.quality)');
    if v_def not like '%p_requirement, v_req.quality)%' then raise exception 'place_bid did not match, nothing changed'; end if;
    execute v_def;
  end if;
  v_def := pg_get_functiondef('public.accept_bid'::regproc);
  if v_def not like '%v_req.id, v_req.quality)%' then
    v_def := replace(v_def, 'public.bulk_capacity(v_bid.area_manager_id, v_req.milk_type, v_bid.delivery_date, v_req.id)',
                            'public.bulk_capacity(v_bid.area_manager_id, v_req.milk_type, v_bid.delivery_date, v_req.id, v_req.quality)');
    if v_def not like '%v_req.id, v_req.quality)%' then raise exception 'accept_bid did not match, nothing changed'; end if;
    execute v_def;
  end if;
end $$;

-- ---------- 2. the dispatch test must reach the grade the buyer asked for ----------
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.update_bulk_order(uuid, bulk_order_status, text, uuid)'::regprocedure);
  -- an earlier run of this file used a slightly different message
  v_def := replace(v_def, $r$raise exception 'this milk tested %, the buyer asked for % or better. test better milk or cancel the order', v_ai->>'quality', v_req.quality;$r$,
    $r$raise exception 'this milk tested %, the buyer asked for %. test better milk or cancel the order', v_ai->>'quality', v_req.quality || case when v_req.quality = 'premium' then '' else ' or better' end;$r$);
  if v_def like '%the buyer asked for%' then
    execute v_def;
  else
    v_def := replace(v_def,
      $r$it cannot be sent to the buyer', lower(coalesce(v_ai->'notes'->>0, 'not fresh'));
      end if;$r$,
      $r$it cannot be sent to the buyer', lower(coalesce(v_ai->'notes'->>0, 'not fresh'));
      end if;
      if (v_ai->>'quality')::quality_grade < v_req.quality then
        raise exception 'this milk tested %, the buyer asked for %. test better milk or cancel the order', v_ai->>'quality', v_req.quality || case when v_req.quality = 'premium' then '' else ' or better' end;
      end if;$r$);
    if v_def not like '%the buyer asked for%' then raise exception 'update_bulk_order did not match, nothing changed'; end if;
    execute v_def;
  end if;
end $$;

-- ---------- 3. no age promise on bids ----------
-- new bids leave it empty; the dispatch test checks the milk instead
update public.bids set max_age_hours = null where status = 'submitted' and max_age_hours is not null;

revoke all on function public.milk_fresh_at(uuid, milk_kind, timestamptz, quality_grade) from public, anon, authenticated;
revoke all on function public.grade_share(uuid, milk_kind, quality_grade) from public, anon, authenticated;
revoke all on function public.bulk_capacity(uuid, milk_kind, date, uuid, quality_grade) from public, anon, authenticated;
revoke all on function public.my_bid_capacity(milk_kind, date, uuid, quality_grade) from public, anon;
grant execute on function public.my_bid_capacity(milk_kind, date, uuid, quality_grade) to authenticated;
