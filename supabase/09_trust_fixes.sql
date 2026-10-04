-- =========================================================
-- apnadairy · trust fixes (step 1)
-- 1. internal functions can no longer be called through the api
--    (they leaked other centers' sales and let anyone create bills)
-- 2. market rates are set by the super admin per city; a center can no longer
--    lower its own "market rate" to pay farmers less
-- 3. sample data only for demo accounts, so it can never inflate real billing
-- 4. discount tiers count online orders only (app and bulk), which the platform
--    can verify, not counter sales a center types in itself
-- run in supabase sql editor (after 08_shop_listings_reviews.sql)
-- =========================================================

-- ---------- 1. lock down internal functions ----------
-- postgres lets everyone (public) execute new functions by default, so revoke from public too.
revoke execute on function public.bill_center_month(uuid, date, boolean) from public, anon, authenticated;
revoke execute on function public.tier_for(numeric)                      from public, anon, authenticated;
revoke execute on function public.center_month_sales(uuid, date)         from public, anon, authenticated;
revoke execute on function public.center_billing_ok(uuid)                from public, anon, authenticated;
revoke execute on function public.center_device_active(uuid)             from public, anon, authenticated;
revoke execute on function public.on_center_approved()                   from public, anon, authenticated;
revoke execute on function public.check_milk_markup()                    from public, anon, authenticated;
revoke execute on function public.check_center_product()                 from public, anon, authenticated;
revoke execute on function public.seed_sample_data()                     from public, anon;
revoke execute on function public.clear_sample_data()                    from public, anon;
revoke execute on function public.generate_monthly_invoices(date)        from public, anon;
revoke execute on function public.void_invoice(uuid)                     from public, anon;
revoke execute on function public.pay_invoice(uuid, text, text)          from public, anon;
revoke execute on function public.place_shop_order(jsonb, text, text)    from public, anon;
revoke execute on function public.add_review(uuid, integer, text)        from public, anon;
revoke execute on function public.reply_review(uuid, text)               from public, anon;
-- milk_in_stock and listing_freshness stay callable: the public listings view needs them,
-- and they only return stock and freshness that the listings already show publicly.

-- ---------- 2. market rates, set by the super admin ----------
create table public.market_rates (
  city       text not null,                 -- lower-case city, '*' = every other city
  milk_type  milk_kind not null,
  rate       numeric(8,2) not null check (rate > 0),
  updated_at timestamptz not null default now(),
  primary key (city, milk_type),
  constraint city_is_lower check (city = lower(trim(city)))
);
insert into public.market_rates (city, milk_type, rate) values
  ('*', 'cow', 170), ('*', 'buffalo', 200), ('*', 'mixed', 185);

alter table public.market_rates enable row level security;
create policy "market rates: everyone signed in reads" on public.market_rates for select to authenticated using (true);
create policy "market rates: admin manages" on public.market_rates for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.market_rate_for(p_center uuid, p_type milk_kind)
returns numeric
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select m.rate from market_rates m join area_managers a on m.city = lower(trim(a.city))
      where a.id = p_center and m.milk_type = p_type),
    (select rate from market_rates where city = '*' and milk_type = p_type),
    case p_type when 'cow' then 170 when 'buffalo' then 200 else 185 end);
$$;
revoke execute on function public.market_rate_for(uuid, milk_kind) from public, anon, authenticated;

-- the rates a center works with, for its own portal
create or replace function public.my_market_rates()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'city', (select city from area_managers where id = public.my_milk_center_id()),
    'own_city_rates', exists (select 1 from market_rates m join area_managers a on m.city = lower(trim(a.city)) where a.id = public.my_milk_center_id()),
    'cow', public.market_rate_for(public.my_milk_center_id(), 'cow'),
    'buffalo', public.market_rate_for(public.my_milk_center_id(), 'buffalo'),
    'mixed', public.market_rate_for(public.my_milk_center_id(), 'mixed'),
    'updated_at', (select max(updated_at) from market_rates));
$$;
revoke execute on function public.my_market_rates() from public, anon;

-- centers can read their settings but only the admin changes them
drop policy if exists "settings: own center" on public.center_settings;
create policy "center settings: read own or admin" on public.center_settings
  for select using (area_manager_id = public.my_milk_center_id() or public.is_admin());
create policy "center settings: admin writes" on public.center_settings
  for all using (public.is_admin()) with check (public.is_admin());

create or replace function public.assess_milk(
  p_milk_type milk_kind, p_temperature numeric, p_ph numeric, p_ec numeric, p_tds numeric, p_reading_at timestamptz default now()
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  m1       jsonb := public.ai_freshness(p_temperature, p_ph, p_ec, p_reading_at);
  m2       jsonb := public.ai_adulteration(p_temperature, p_ph, p_ec, p_tds);
  v_rate   numeric;
  v_score  integer;
  v_accept boolean;
  v_grade  quality_grade;
  v_market numeric;
  v_notes  text[];
begin
  select * into s from platform_settings;
  -- the market rate is set by apnadairy for the center's city, never by the center itself
  v_rate := public.market_rate_for(public.my_milk_center_id(), p_milk_type);

  -- quality score: freshness, purity and small drifts from the ideal
  v_score := round(
      0.45 * (m1->>'freshness_score')::int
    + 0.55 * (100 - (m2->>'adulteration_score')::int)
    - abs(p_ph - 6.70) * 60
    - greatest(0, p_ec - 4.9) * 6);
  v_score := least(100, greatest(0, v_score));
  v_accept := (m1->>'spoilage_risk') <> 'high' and (m2->>'adulteration_risk') <> 'high';
  v_grade := case when v_score >= 88 then 'premium' when v_score >= 82 then 'fresh' else 'standard' end;

  if v_accept then
    v_market := round(v_rate
      * case v_grade when 'premium' then 1.06 when 'fresh' then 1.0 else 0.92 end
      * case (m2->>'adulteration_risk') when 'medium' then 0.95 else 1 end);
  end if;

  v_notes := array(select jsonb_array_elements_text(m1->'notes')) || array(select jsonb_array_elements_text(m2->'notes'));
  if array_length(v_notes, 1) is null then v_notes := array['All readings are in the normal range']; end if;

  return jsonb_build_object(
    'accept', v_accept, 'quality', v_grade, 'score', v_score, 'base_rate', v_rate,
    'freshness', m1, 'adulteration', m2,
    'freshness_hours', m1->'freshness_hours', 'spoilage_risk', m1->'spoilage_risk',
    'adulteration_risk', m2->'adulteration_risk', 'adulteration_score', m2->'adulteration_score', 'suspected', m2->'suspected',
    'market_price', v_market,
    'offer_price', case when v_accept then round(v_market * s.farmer_default_pct / 100.0) end,
    'min_price', case when v_accept then ceil(v_market * s.farmer_min_pct / 100.0) end,
    'farmer_default_pct', s.farmer_default_pct, 'farmer_min_pct', s.farmer_min_pct,
    'notes', to_jsonb(v_notes)
  );
end;
$$;

-- ---------- 3. sample data only for demo accounts ----------
alter table public.area_managers add column is_demo boolean not null default false;
-- centers that already loaded sample data are demo accounts
update public.area_managers a set is_demo = true
 where exists (select 1 from public.farmers f where f.area_manager_id = a.id and f.is_sample);

-- admin marks a center (by its user) as a demo account, or back
create or replace function public.set_demo_center(p_user uuid, p_demo boolean)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'only super admin can do this'; end if;
  update area_managers set is_demo = p_demo where user_id = p_user;
  if not found then raise exception 'this user has no center'; end if;
end;
$$;
revoke execute on function public.set_demo_center(uuid, boolean) from public, anon;

create or replace function public.clear_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare v_center uuid := public.my_milk_center_id();
begin
  if v_center is null then raise exception 'only a verified milk center can do this'; end if;
  -- a sample farmer who has real milk on record becomes a real farmer, so real collections are never deleted
  update farmers f set is_sample = false
   where f.area_manager_id = v_center and f.is_sample
     and exists (select 1 from milk_collections m where m.farmer_id = f.id and not m.is_sample);
  delete from shop_reviews     where area_manager_id = v_center and is_sample;
  delete from center_invoices  where area_manager_id = v_center and is_sample;
  delete from shop_orders      where area_manager_id = v_center and is_sample;
  delete from milk_usage       where area_manager_id = v_center and is_sample;
  delete from milk_collections where area_manager_id = v_center and is_sample;
  delete from products         where area_manager_id = v_center and is_sample;
  delete from farmers          where area_manager_id = v_center and is_sample;
end;
$$;

create or replace function public.seed_sample_data()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_center  uuid := public.my_milk_center_id();
  names     text[] := array['Muhammad Aslam','Ghulam Rasool','Allah Ditta','Bashir Ahmed','Nazir Hussain','Rafiq Ahmed',
                            'Abdul Sattar','Manzoor Ali','Shaukat Ali','Zahid Iqbal','Rubina Bibi','Naseem Akhtar'];
  villages  text[] := array['Chak 41','Mauza Sarai','Dhok Kala','Basti Noor','Pind Ranjha','Kot Fateh'];
  types     milk_kind[] := array['buffalo','cow','buffalo','cow','mixed','buffalo','cow','buffalo','cow','mixed','cow','buffalo']::milk_kind[];
  base_l    numeric[] := array[18,12,22,9,14,16,11,20,8,13,7,15];
  buyers    text[] := array['Ayesha Khan','Bilal Ahmed','Sana Tariq','Usman Ali','Hira Malik','Fatima Noor','Hamza Sheikh',
                            'Zainab Raza','Ali Raza','Mariam Iqbal','Saad Qureshi','Noor Fatima','Imran Butt','Kiran Javed'];
  streets   text[] := array['House 12, Street 4, Gulshan Colony','Flat 3, Al-Noor Plaza','House 88, Block C, Model Town',
                            'House 5, Iqbal Road','House 21, Street 9, Satellite Town','House 140, Canal View'];
  v_farmers uuid[] := '{}';
  v_f       uuid;
  v_prod    record;
  p_cow     uuid; p_buf uuid; p_mix uuid;
  comments5 text[] := array['Doodh bilkul khalis tha, malai bohat achi aayi.','Always fresh and on time. Best milk shop in our area.','Rider was polite, milk was still cold. Highly recommended.','Buffalo milk is thick and pure, my family loves it.','Test report on the app gives real peace of mind.','Ordered at 7 am, delivered by 7:40. Great service.'];
  comments4 text[] := array['Good quality milk, delivery was a little late.','Fresh milk, price is fair for the quality.','Achi quality hai, bas packing behtar ho sakti hai.','Good taste, will keep ordering.'];
  comments3 text[] := array['Milk was fine but came an hour late.','Okay quality, a bit thin today.'];
  comments2 text[] := array['Milk tasted slightly sour this time.'];
  v_rating  integer;
  d         integer;
  i         integer;
  s         milk_shift;
  v_day     date;
  v_ts      timestamptz;
  v_qty     numeric; v_temp numeric; v_ph numeric; v_tds numeric; v_ec numeric; r numeric;
  v_ai      jsonb;
  v_ok      boolean;
  v_status  collection_status;
  v_reason  text;
  bought    numeric[]; carry numeric[] := array[0,0,0];  -- cow, buffalo, mixed
  target    numeric; sold numeric; k integer; v_type milk_kind; v_idx integer;
  v_order   uuid; v_total numeric; v_channel sale_channel; v_ostatus shop_order_status; v_amt numeric;
  v_keep    numeric;
  v_today   date := (now() at time zone 'Asia/Karachi')::date;   -- shop hours follow pakistan time
  v_hour    numeric := extract(hour from now() at time zone 'Asia/Karachi');
begin
  if v_center is null then raise exception 'only a verified milk center can load sample data'; end if;
  if not exists (select 1 from area_managers where id = v_center and is_demo) then
    raise exception 'sample data is only for demo accounts. ask the ApnaDairy admin to mark this center as a demo';
  end if;
  perform public.clear_sample_data();
  perform setseed(0.42);

  insert into center_settings (area_manager_id) values (v_center) on conflict (area_manager_id) do nothing;

  for i in 1..12 loop
    insert into farmers (area_manager_id, full_name, phone, village, milk_type, cattle_count, is_sample, created_at)
    values (v_center, names[i], '03' || (10 + floor(random() * 40))::int || lpad(floor(random() * 10000000)::text, 7, '0'),
            villages[1 + (i % 6)], types[i], 2 + floor(base_l[i] / 3)::int, true, now() - interval '60 days')
    returning id into v_f;
    v_farmers := v_farmers || v_f;
  end loop;

  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, is_sample)
    values (v_center, 'Fresh cow milk', 'milk', 'cow', 'litre', 205, null, 'Collected twice a day from farms near the city, tested on arrival.', true) returning id into p_cow;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, min_order_l, is_sample)
    values (v_center, 'Fresh buffalo milk', 'milk', 'buffalo', 'litre', 240, null, 'Thick, creamy buffalo milk. Great for chai and dahi.', 1, true) returning id into p_buf;
  insert into products (area_manager_id, name, category, milk_type, unit, price, stock_qty, description, min_order_l, is_sample)
    values (v_center, 'Fresh mixed milk', 'milk', 'mixed', 'litre', 210, null, 'Cow and buffalo milk, a lighter everyday choice.', 2, true) returning id into p_mix;

  -- a shop profile to start from (only if the center has not written its own)
  insert into shop_profiles (area_manager_id, tagline, description, phone, whatsapp, opening_hours, delivery_radius_km)
  values (v_center, 'Khalis doodh, tested every morning',
          'A family milk shop buying straight from farmers in nearby villages. Every can is tested with the ApnaDairy IoT tester before it reaches you.',
          '0321 4567890', '0321 4567890', 'Every day, 6:00 am to 10:00 pm', 5)
  on conflict (area_manager_id) do nothing;

  for d in reverse 29..0 loop
    v_day := v_today - d;
    bought := array[0,0,0];

    -- ---- collections: two shifts, every farmer, a few absences and problem samples ----
    foreach s in array array['morning','evening']::milk_shift[] loop
      for i in 1..12 loop
        v_ts := ((v_day + (case s when 'morning' then time '06:15' else time '17:30' end)) at time zone 'Asia/Karachi') + (i * 7 + floor(random() * 6)) * interval '1 minute';
        continue when v_ts > now();
        continue when random() < 0.07;   -- farmer did not come

        v_qty  := round((base_l[i] * (0.85 + random() * 0.3) * case s when 'morning' then 1.05 else 0.95 end)::numeric, 1);
        v_temp := round((33 + random() * 4)::numeric, 1);
        v_ph   := round((6.62 + random() * 0.16)::numeric, 2);
        v_ec   := round((case types[i] when 'buffalo' then 4.3 else 4.7 end + (random() - 0.5) * 0.8)::numeric, 2);
        r := random();
        if r < 0.035 then v_ec := round((3.0 + random() * 0.4)::numeric, 2);              -- water added
        elsif r < 0.055 then v_ph := round((6.30 + random() * 0.08)::numeric, 2);        -- souring
        elsif r < 0.07 then v_ec := round((6.7 + random() * 0.6)::numeric, 2);           -- salt
        elsif r < 0.075 then v_ph := round((6.95 + random() * 0.08)::numeric, 2);        -- soda
        elsif r < 0.12 then v_ph := round((6.47 + random() * 0.07)::numeric, 2);         -- slightly acidic
        end if;
        v_tds  := round((v_ec * 1000 * (0.49 + random() * 0.03))::numeric, 0);           -- tds sensor ≈ 0.5 × ec

        v_ai := public.assess_milk(types[i], v_temp, v_ph, v_ec, v_tds, v_ts);
        v_ok := (v_ai->>'accept')::boolean;
        v_reason := null;
        if not v_ok then v_status := 'rejected'; v_reason := 'Failed the quality test';
        elsif v_ts > now() - interval '50 minutes' then v_status := 'offered';
        elsif random() < 0.03 then v_status := 'rejected'; v_reason := 'Farmer refused the price';
        else v_status := 'accepted';
        end if;

        insert into milk_collections (
          area_manager_id, farmer_id, milk_type, shift, quantity_l, collected_at,
          temperature_c, ph, ec_ms, tds_ppm, reading_at, test_source, device_serial,
          quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected,
          ai_price_per_l, ai_notes, price_per_l, status, decided_at, reject_reason, payment, paid_at, is_sample
        ) values (
          v_center, v_farmers[i], types[i], s, v_qty, v_ts,
          v_temp, v_ph, v_ec, v_tds, v_ts, 'simulated', 'AD-IOT-0001',
          case when v_ok then (v_ai->>'quality')::quality_grade end,
          (v_ai->>'freshness_hours')::int, (v_ai->'freshness'->>'freshness_score')::int, (v_ai->>'spoilage_risk')::risk_level,
          (v_ai->>'adulteration_risk')::risk_level, (v_ai->>'adulteration_score')::int, v_ai->>'suspected',
          (v_ai->>'market_price')::numeric, array(select jsonb_array_elements_text(v_ai->'notes')),
          -- farmers get 95% of the market rate; now and then the manager pays a little more
          case when v_ok then (v_ai->>'offer_price')::numeric + case when random() < 0.12 then 1 + round(random() * 5) else 0 end end,
          v_status, case when v_status <> 'offered' then v_ts + interval '4 minutes' end, v_reason,
          case when v_status = 'accepted' and v_day < v_today - 6 then 'paid'::payment_status else 'unpaid'::payment_status end,
          case when v_status = 'accepted' and v_day < v_today - 6 then ((v_day + 7 + time '10:00') at time zone 'Asia/Karachi') end,
          true
        );
        if v_status = 'accepted' then
          v_idx := case types[i] when 'cow' then 1 when 'buffalo' then 2 else 3 end;
          bought[v_idx] := bought[v_idx] + v_qty;
        end if;
      end loop;
    end loop;

    -- ---- sales: a milk shop sells nearly all of the day's milk, the rest is sold first tomorrow ----
    for v_idx in 1..3 loop
      v_type := case v_idx when 1 then 'cow' when 2 then 'buffalo' else 'mixed' end::milk_kind;
      target := (carry[v_idx] + bought[v_idx]) * (0.86 + random() * 0.1);
      if d = 0 then target := target * least(1, v_hour / 21); end if;
      sold := 0;
      while sold < target loop
        v_qty := (1 + floor(random() * 4))::numeric;
        exit when sold + v_qty > target;
        v_channel := case when random() < 0.45 then 'app' else 'walk_in' end;
        v_ts := ((v_day + time '07:00') at time zone 'Asia/Karachi') + floor(random() * 14 * 60) * interval '1 minute';
        if v_ts > now() then v_ts := now() - floor(random() * 90) * interval '1 minute'; end if;
        v_ostatus := 'delivered';
        if v_channel = 'app' and d = 0 and v_ts > now() - interval '3 hours' then
          v_ostatus := (array['pending','preparing','out_for_delivery'])[1 + floor(random() * 3)::int]::shop_order_status;
        elsif v_channel = 'app' and random() < 0.03 then v_ostatus := 'cancelled';
        end if;

        insert into shop_orders (area_manager_id, customer_name, customer_phone, channel, delivery_address, status, created_at, delivered_at, is_sample)
        values (v_center,
                case when v_channel = 'app' then buyers[1 + floor(random() * 14)::int] else 'Walk-in customer' end,
                case when v_channel = 'app' then '03' || (10 + floor(random() * 40))::int || lpad(floor(random() * 10000000)::text, 7, '0') end,
                v_channel,
                case when v_channel = 'app' then streets[1 + floor(random() * 6)::int] end,
                v_ostatus, v_ts,
                case when v_ostatus = 'delivered' then v_ts + (case when v_channel = 'app' then interval '35 minutes' else interval '0' end) end,
                true)
        returning id into v_order;

        insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
        values (v_order, case v_idx when 1 then p_cow when 2 then p_buf else p_mix end,
                case v_idx when 1 then 'Fresh cow milk' when 2 then 'Fresh buffalo milk' else 'Fresh mixed milk' end,
                'milk', v_type, 'litre', v_qty, case v_idx when 1 then 205 when 2 then 240 else 210 end);
        v_total := v_qty * case v_idx when 1 then 205 when 2 then 240 else 210 end;

        update shop_orders set total_amount = v_total where id = v_order;
        if v_ostatus <> 'cancelled' then sold := sold + v_qty; end if;
      end loop;

      carry[v_idx] := carry[v_idx] + bought[v_idx] - sold;
    end loop;

    -- a little spoilage now and then
    if d > 0 and random() < 0.15 and carry[1] > 8 then
      insert into milk_usage (area_manager_id, milk_type, litres, reason, note, created_at, is_sample)
      values (v_center, 'cow', 5, 'spoiled', 'Turned sour overnight', ((v_day + time '22:00') at time zone 'Asia/Karachi'), true);
      carry[1] := carry[1] - 5;
    end if;
  end loop;

  -- billing: device paid when the center joined, last two months paid, this month due
  if not exists (select 1 from center_invoices where area_manager_id = v_center and kind = 'device' and status <> 'void') then
    insert into center_invoices (area_manager_id, kind, description, device_fee, amount, issued_at, due_date, status, paid_at, payment_method, payment_ref, is_sample)
    select v_center, 'device', 'ApnaDairy IoT milk tester (one-time)', device_price, device_price,
           now() - interval '75 days', v_today - 68, 'paid', now() - interval '72 days', 'jazzcash', 'JC' || floor(random() * 1e9)::text, true
    from platform_settings;
  end if;
  for k in reverse 2..1 loop
    if not exists (select 1 from center_invoices where area_manager_id = v_center and kind = 'monthly'
                   and period_month = (date_trunc('month', v_today) - k * interval '1 month')::date and status <> 'void') then
      insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                                   sales_basis, online_sales, commission_pct, commission, amount, issued_at, due_date, status, paid_at,
                                   payment_method, payment_ref, is_sample)
      select v_center, 'monthly', (date_trunc('month', v_today) - k * interval '1 month')::date,
             to_char(date_trunc('month', v_today) - k * interval '1 month', 'FMMonth YYYY') || ' platform fee and commission',
             monthly_fee, 'Standard', 0, 690000, 690000, commission_pct, round(690000 * commission_pct / 100.0),
             round(monthly_fee + 690000 * commission_pct / 100.0),
             date_trunc('month', v_today) - k * interval '1 month', (date_trunc('month', v_today) - k * interval '1 month')::date + 7,
             'paid', date_trunc('month', v_today) - k * interval '1 month' + interval '3 days',
             case k when 2 then 'easypaisa' else 'bank' end, 'TX' || floor(random() * 1e9)::text, true
      from platform_settings;
    end if;
  end loop;
  perform public.bill_center_month(v_center, v_today, true);

  -- customers review the shop after delivered app orders
  for v_order in select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app' and status = 'delivered'
                 order by random() limit 46 loop
    r := random();
    v_rating := case when r < 0.58 then 5 when r < 0.86 then 4 when r < 0.96 then 3 else 2 end;
    insert into shop_reviews (area_manager_id, order_id, reviewer_name, rating, comment, reply, replied_at, created_at, is_sample)
    select v_center, o.id,
           split_part(o.customer_name, ' ', 1) || ' ' || left(split_part(o.customer_name, ' ', 2), 1) || '.',
           v_rating,
           case v_rating when 5 then comments5[1 + floor(random() * 6)::int] when 4 then comments4[1 + floor(random() * 4)::int]
                         when 3 then comments3[1 + floor(random() * 2)::int] else comments2[1] end,
           case when v_rating <= 3 then 'Sorry about that. We have spoken to our rider and will do better.' end,
           case when v_rating <= 3 then o.delivered_at + interval '5 hours' end,
           o.delivered_at + interval '2 hours', true
    from shop_orders o where o.id = v_order;
  end loop;

  -- the newest app order of the day has just come in
  update shop_orders set status = 'pending', delivered_at = null
   where id = (select id from shop_orders where area_manager_id = v_center and is_sample and channel = 'app'
                 and status <> 'cancelled' and created_at > now() - interval '3 hours' order by created_at desc limit 1);
end;
$$;

-- ---------- 4. discount tiers by online orders ----------
create or replace function public.bill_center_month(p_center uuid, p_month date, p_sample boolean default false)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  s        public.platform_settings;
  t        public.billing_tiers;
  v_month  date := date_trunc('month', p_month)::date;
  v_prev   record;
  v_fee    numeric;
  v_comm   numeric;
  v_id     uuid;
begin
  select id into v_id from center_invoices where area_manager_id = p_center and kind = 'monthly' and period_month = v_month and status <> 'void';
  if v_id is not null then return v_id; end if;

  select * into s from platform_settings;
  select * into v_prev from public.center_month_sales(p_center, (v_month - interval '1 month')::date);
  t := public.tier_for(v_prev.online_sales);   -- only orders that came through apnadairy count
  v_fee  := round(s.monthly_fee * (100 - t.discount_pct) / 100.0);      -- whole rupees
  v_comm := round(v_prev.online_sales * s.commission_pct / 100.0);

  insert into center_invoices (area_manager_id, kind, period_month, description, subscription_fee, tier, discount_pct,
                               sales_basis, online_sales, commission_pct, commission, amount, due_date, is_sample)
  values (p_center, 'monthly', v_month,
          to_char(v_month, 'FMMonth YYYY') || ' platform fee' || case when v_prev.online_sales > 0 then ' and commission' else '' end,
          s.monthly_fee, t.name, t.discount_pct, v_prev.online_sales, v_prev.online_sales, s.commission_pct, v_comm,
          v_fee + v_comm, greatest(v_month, (now() at time zone 'Asia/Karachi')::date) + s.payment_days, p_sample)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.billing_overview()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_center uuid := public.my_milk_center_id();
  s        public.platform_settings;
  this_m   record;
  last_m   record;
  cur_t    public.billing_tiers;
  next_t   public.billing_tiers;
  v_today  date := (now() at time zone 'Asia/Karachi')::date;
begin
  if v_center is null then raise exception 'only a verified milk center has billing'; end if;
  select * into s from platform_settings;
  select * into this_m from public.center_month_sales(v_center, v_today);
  select * into last_m from public.center_month_sales(v_center, (date_trunc('month', v_today) - interval '1 month')::date);
  cur_t := public.tier_for(this_m.online_sales);
  select * into next_t from billing_tiers where min_monthly_sales > this_m.online_sales order by min_monthly_sales limit 1;
  return jsonb_build_object(
    'device_active', public.center_device_active(v_center),
    'billing_ok', public.center_billing_ok(v_center),
    'monthly_fee', s.monthly_fee, 'device_price', s.device_price, 'commission_pct', s.commission_pct,
    'this_month_sales', this_m.total_sales, 'this_month_online', this_m.online_sales,
    'commission_so_far', round(this_m.online_sales * s.commission_pct / 100.0),
    'last_month_sales', last_m.total_sales,
    'tier_now', cur_t.name, 'tier_now_discount', cur_t.discount_pct,
    'next_tier', next_t.name, 'next_tier_at', next_t.min_monthly_sales, 'next_tier_discount', next_t.discount_pct
  );
end;
$$;

revoke execute on function public.seed_sample_data(), public.clear_sample_data() from public, anon;
