-- demo data for presentations (optional)
-- run after all the numbered files (01 to 32). safe to run again: every run gives the demo accounts a fresh month
-- and sets their password to the one below. remove everything with demo/remove_demo.sql after the demo.
--
-- step 1: put your own demo password on the next line (at least 8 letters and numbers). it is not saved in this file
--         on github, so do not commit it. all six demo accounts sign in with it.
select set_config('demo.password', 'PUT-YOUR-DEMO-PASSWORD-HERE', false);
--
-- step 2: run the whole file in the supabase sql editor.
--
-- demo accounts
--   khalid@apnadairy.test   Imran Khalid, Khalid Milk Center (milk collection center, Rawalpindi)
--   taxila@apnadairy.test   Shahid Mehmood, Taxila Dairy Point (milk collection center, Taxila)
--   ghee@apnadairy.test     Bilal Ahmed, Bilal Desi Ghee House (dairy products seller, Rawalpindi)
--   grill@apnadairy.test    Ayesha Siddiqui, Margalla Grill (restaurant, Islamabad)
--   bakery@apnadairy.test   Farhan Qureshi, Golden Crust Bakery (bakery, Rawalpindi)
--   hotel@apnadairy.test    Kamran Javed, Pindi Point Hotel (waiting for approval, no documents yet)
--
-- what you get
--   both milk centers: 12 farmers, 30 days of tested milk, payouts, shop sales, reviews, paid bills
--   the ghee seller: 6 products and a month of shop orders
--   bulk market: delivered orders split between the two centers, reviews, one cancellation,
--     a 500 L request with bids from both centers waiting for the restaurant to split it,
--     a confirmed order waiting for dispatch, and open requests to bid on
--   support: a resolved complaint about an order, an open question, a billing ticket
-- the demo accounts' emails end in .test, so no email is ever sent to them.
-- they are real approved accounts on your project: they can see open requests and bid like any seller. remove them after the demo.
--
-- what a re-run resets: the demo accounts' own data, and the requests posted by the two demo businesses
-- (with any bids and orders on them). real accounts' tickets, shop orders and requests are left alone.

-- ---------- helpers for this script only (they disappear when the session ends) ----------
create or replace function pg_temp.demo_user(p_email text, p_meta jsonb)
returns uuid language plpgsql as $$
declare v_id uuid; v_demo boolean; v_pw text := current_setting('demo.password', true);
begin
  if v_pw is null or v_pw like 'PUT-YOUR-%' or char_length(v_pw) < 8 or v_pw !~ '[0-9]' or v_pw !~ '[A-Za-z]' then
    raise exception 'put your own demo password (at least 8 letters and numbers) on the set_config line at the top of this file';
  end if;
  select id, coalesce((raw_app_meta_data->>'demo')::boolean, false) into v_id, v_demo from auth.users where email = p_email;
  if v_id is not null then
    -- never take over an account someone else made with a demo email
    if not v_demo then raise exception '% exists but was not made by this script. remove it first', p_email; end if;
    update auth.users set encrypted_password = extensions.crypt(v_pw, extensions.gen_salt('bf')), updated_at = now() where id = v_id;
    return v_id;
  end if;
  v_id := gen_random_uuid();
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                          raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                          confirmation_token, email_change, email_change_token_new, recovery_token)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', p_email,
          extensions.crypt(v_pw, extensions.gen_salt('bf')), now() - interval '45 days',
          '{"provider": "email", "providers": ["email"], "demo": true}', p_meta, now() - interval '45 days', now(), '', '', '', '');
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', p_email, 'email_verified', true), 'email', now(), now(), now());
  return v_id;
end $$;

-- run something as a demo user (auth.uid() inside the app's functions)
create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_user::text, true);
end $$;

-- pakistan time on a day relative to today
create or replace function pg_temp.pk(p_days int, p_time time)
returns timestamptz language sql as $$
  select (((now() at time zone 'Asia/Karachi')::date + p_days) + p_time) at time zone 'Asia/Karachi';
$$;

-- a bulk requirement needed on today + p_day (past days are written as future first, then moved back,
-- because the app only accepts new requests for the future)
create or replace function pg_temp.demo_req(p_business uuid, p_product text, p_milk text, p_qty numeric, p_unit text, p_quality text,
                                            p_target numeric, p_city text, p_addr text, p_notes text, p_day int, p_status text)
returns uuid language plpgsql as $$
declare v_id uuid; v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  insert into bulk_requirements (business_id, product, milk_type, quantity_l, unit, quality, target_price, delivery_city, delivery_address,
                                 notes, required_date, bid_deadline, status, created_at)
  values (p_business, p_product::product_category, p_milk::milk_kind, p_qty, p_unit, p_quality::quality_grade, p_target, p_city, p_addr,
          p_notes, v_today + greatest(p_day, 2), now() + interval '20 hours', 'open', now())
  returning id into v_id;
  update bulk_requirements
     set required_date = v_today + p_day,
         bid_deadline = greatest(pg_temp.pk(p_day - 1, '18:00'), case when p_day > 0 then now() + interval '3 hours' else '-infinity' end),
         created_at = pg_temp.pk(p_day - 3, '10:30'),
         status = p_status::requirement_status
   where id = v_id;
  return v_id;
end $$;

create or replace function pg_temp.demo_bid(p_req uuid, p_center uuid, p_price numeric, p_qty numeric, p_status text, p_notes text default null)
returns uuid language plpgsql as $$
declare v_id uuid; r bulk_requirements;
begin
  select * into r from bulk_requirements where id = p_req;
  insert into bids (requirement_id, area_manager_id, price_per_l, quantity_l, delivery_date, notes, status, created_at, updated_at)
  values (p_req, p_center, p_price, p_qty, r.required_date, p_notes, p_status::bid_status, r.created_at + interval '3 hours', r.created_at + interval '3 hours')
  returning id into v_id;
  return v_id;
end $$;

-- an order from an accepted bid. p_status delivered / cancelled / confirmed
create or replace function pg_temp.demo_order(p_bid uuid, p_qty numeric, p_status text, p_grade text default null)
returns uuid language plpgsql as $$
declare v_id uuid; b bids; r bulk_requirements; v_day int;
begin
  select * into b from bids where id = p_bid;
  select * into r from bulk_requirements where id = b.requirement_id;
  v_day := r.required_date - (now() at time zone 'Asia/Karachi')::date;
  insert into bulk_orders (requirement_id, bid_id, business_id, area_manager_id, quantity_l, price_per_l, delivery_date, delivery_city,
                           delivery_address, status, created_at, dispatched_at, delivered_at, cancelled_by, dispatch_quality)
  values (r.id, b.id, r.business_id, b.area_manager_id, p_qty, b.price_per_l, r.required_date, r.delivery_city, r.delivery_address,
          p_status::bulk_order_status, least(r.bid_deadline + interval '1 hour', now()),
          case when p_status = 'delivered' then pg_temp.pk(v_day, '06:40') end,
          case when p_status = 'delivered' then pg_temp.pk(v_day, '08:55') end,
          case when p_status = 'cancelled' then 'center' end,
          case when p_status = 'delivered' and p_grade is not null then jsonb_build_object(
            'device', 'AD-IOT-0001', 'quality', p_grade, 'temperature_c', round((3.8 + random() * 1.4)::numeric, 1),
            'ph', round((6.66 + random() * 0.06)::numeric, 2), 'tds_ppm', round(2700 + random() * 250), 'tested_at', pg_temp.pk(v_day, '06:25')) end)
  returning id into v_id;
  return v_id;
end $$;

do $$
declare
  u_khalid uuid; u_taxila uuid; u_ghee uuid; u_grill uuid; u_bakery uuid; u_hotel uuid;
  c1 uuid; c2 uuid; s1 uuid; b1 uuid; b2 uuid;
  v_admin uuid := (select id from profiles where role = 'super_admin' and status = 'active' order by created_at limit 1);
  r uuid; x uuid; y uuid; o uuid; t uuid;
  names2   text[] := array['Raja Mushtaq','Qamar Zaman','Sardar Akram','Liaqat Ali','Mehboob Alam','Iftikhar Ahmed',
                           'Javed Iqbal','Pervez Akhtar','Tariq Mehmood','Arshad Khan','Shamim Bibi','Parveen Akhtar'];
  villages2 text[] := array['Jhang Bahtar','Bhallar','Kot Sarang','Thatha Khalil','Mohra Shah','Dhok Hassu'];
  buyers2  text[] := array['Sadia Rauf','Adeel Shah','Mehwish Ali','Kashif Nawaz','Rabia Saleem','Waqar Younis Malik','Nida Hameed'];
  v_ids uuid[];
  i int; d int; v_prod record; v_qty numeric; v_order uuid; v_total numeric; v_ts timestamptz;
  p_ghee uuid; p_butter uuid; p_yogurt uuid; p_cheese uuid; p_cream uuid; p_lassi uuid;
  v_today date := (now() at time zone 'Asia/Karachi')::date;
begin
  -- ---------- 1. accounts ----------
  u_khalid := pg_temp.demo_user('khalid@apnadairy.test', '{"role":"area_manager","full_name":"Imran Khalid","phone":"0321 5554411","manager_type":"milk_center","center_name":"Khalid Milk Center","city":"Rawalpindi","address":"Plot 14, Chaklala Scheme 3"}');
  u_taxila := pg_temp.demo_user('taxila@apnadairy.test', '{"role":"area_manager","full_name":"Shahid Mehmood","phone":"0333 5126790","manager_type":"milk_center","center_name":"Taxila Dairy Point","city":"Taxila","address":"Main GT Road, near the museum turn"}');
  u_ghee   := pg_temp.demo_user('ghee@apnadairy.test',   '{"role":"area_manager","full_name":"Bilal Ahmed","phone":"0300 5302218","manager_type":"byproduct","center_name":"Bilal Desi Ghee House","city":"Rawalpindi","address":"Shop 7, Raja Bazaar"}');
  u_grill  := pg_temp.demo_user('grill@apnadairy.test',  '{"role":"business","full_name":"Ayesha Siddiqui","phone":"0345 5019922","business_name":"Margalla Grill","business_type":"restaurant","city":"Islamabad","address":"Shop 3, F-7 Markaz"}');
  u_bakery := pg_temp.demo_user('bakery@apnadairy.test', '{"role":"business","full_name":"Farhan Qureshi","phone":"0312 5208833","business_name":"Golden Crust Bakery","business_type":"bakery","city":"Rawalpindi","address":"Bank Road, Saddar"}');
  u_hotel  := pg_temp.demo_user('hotel@apnadairy.test',  '{"role":"business","full_name":"Kamran Javed","phone":"0301 5447761","business_name":"Pindi Point Hotel","business_type":"hotel","city":"Rawalpindi","address":"Murree Road, Committee Chowk"}');

  -- approved (the hotel stays pending), demo centers so they can hold sample data
  update profiles set status = 'active', updated_at = now() where id in (u_khalid, u_taxila, u_ghee, u_grill, u_bakery);
  update area_managers set is_demo = true where user_id in (u_khalid, u_taxila, u_ghee);
  update area_managers set verification_status = 'active', verified_by = v_admin, verified_at = now() - interval '40 days',
         docs_submitted_at = now() - interval '41 days'
   where user_id in (u_khalid, u_taxila, u_ghee) and verification_status <> 'active';
  update business_profiles set verification_status = 'active', verified_by = v_admin, verified_at = now() - interval '40 days',
         docs_submitted_at = now() - interval '41 days'
   where user_id in (u_grill, u_bakery) and verification_status <> 'active';

  select id into c1 from area_managers where user_id = u_khalid;
  select id into c2 from area_managers where user_id = u_taxila;
  select id into s1 from area_managers where user_id = u_ghee;
  select id into b1 from business_profiles where user_id = u_grill;
  select id into b2 from business_profiles where user_id = u_bakery;

  -- ---------- 2. clear what an earlier run made ----------
  -- tickets the demo accounts opened, and the requests the demo businesses posted (with the bids and orders on them)
  delete from support_tickets where opened_by in (u_khalid, u_taxila, u_ghee, u_grill, u_bakery, u_hotel);
  delete from bulk_reviews where order_id in (select id from bulk_orders where business_id in (b1, b2));
  delete from delivery_codes where order_kind = 'bulk' and order_id in (select id from bulk_orders where business_id in (b1, b2));
  delete from bulk_orders where business_id in (b1, b2);
  delete from bids where requirement_id in (select id from bulk_requirements where business_id in (b1, b2));
  delete from bulk_requirements where business_id in (b1, b2);
  -- the ghee shop's made-up orders (no customer account); orders from real app customers stay
  delete from shop_reviews where area_manager_id = s1 and customer_id is null;
  delete from delivery_codes where order_kind = 'shop' and order_id in (select id from shop_orders where area_manager_id = s1 and customer_id is null);
  delete from shop_orders where area_manager_id = s1 and customer_id is null;
  delete from products where area_manager_id = s1;

  -- ---------- 3. the two milk centers: the app's own sample month ----------
  perform pg_temp.act_as(u_khalid);
  perform public.seed_sample_data_v2();
  perform pg_temp.act_as(u_taxila);
  perform public.seed_sample_data_v2();
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);

  -- the second center gets its own farmers, buyers and shop text, so the two do not look the same
  i := 0;
  for x in select id from farmers where area_manager_id = c2 and is_sample order by created_at, id loop
    i := i + 1;
    update farmers set full_name = names2[1 + (i - 1) % 12], village = villages2[1 + i % 6] where id = x;
  end loop;
  update shop_orders set customer_name = buyers2[1 + abs(hashtext(id::text)::bigint) % 7] where area_manager_id = c2 and is_sample;
  update shop_reviews set reviewer_name = buyers2[1 + abs(hashtext(id::text)::bigint) % 7] where area_manager_id = c2 and is_sample;
  update shop_profiles set tagline = 'Taxila ka khalis doodh, seedha gaon se',
         description = 'Buying from farmers around Taxila and Wah since 2015. Every can is tested with the ApnaDairy IoT tester before it is sold.',
         phone = '0333 5126790', whatsapp = '0333 5126790', opening_hours = 'Every day, 5:30 am to 9:30 pm', delivery_radius_km = 6
   where area_manager_id = c2;
  update shop_profiles set phone = '0321 5554411', whatsapp = '0321 5554411' where area_manager_id = c1;

  -- bills: the device and the monthly fee are paid, so nothing is overdue during the demo
  update center_invoices set status = 'paid', paid_at = issued_at + interval '2 days', payment_method = 'jazzcash',
         payment_ref = 'JC' || lpad((abs(hashtext(id::text)::bigint) % 100000000)::text, 8, '0')
   where area_manager_id in (c1, c2, s1) and status = 'due';

  -- ---------- 4. the ghee seller ----------
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'Desi ghee (pure buffalo)', 'ghee', 'kg', 2400, 38, v_today - 6, v_today + 170, 'Made the old way from buffalo makhan, slow cooked in small batches.', now() - interval '35 days') returning id into p_ghee;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'White makhan', 'butter', 'kg', 1500, 22, v_today - 2, v_today + 12, 'Fresh churned white butter, unsalted.', now() - interval '35 days') returning id into p_butter;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'Thick dahi', 'yogurt', 'kg', 260, 55, v_today, v_today + 4, 'Set overnight in clay pots from buffalo milk.', now() - interval '35 days') returning id into p_yogurt;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'Fresh paneer', 'cheese', 'kg', 1800, 12, v_today - 1, v_today + 6, 'Soft cottage cheese, made every morning.', now() - interval '30 days') returning id into p_cheese;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'Malai (fresh cream)', 'cream', 'kg', 950, 9, v_today, v_today + 3, 'Thick malai skimmed from boiled buffalo milk.', now() - interval '30 days') returning id into p_cream;
  insert into products (area_manager_id, name, category, unit, price, stock_qty, made_on, expires_on, description, created_at)
    values (s1, 'Meethi lassi', 'lassi', 'litre', 220, 30, v_today, v_today + 2, 'Sweet lassi with a layer of malai.', now() - interval '20 days') returning id into p_lassi;

  insert into shop_profiles (area_manager_id, tagline, description, phone, whatsapp, opening_hours, delivery_radius_km)
  values (s1, 'Asli desi ghee, Raja Bazaar se', 'A family dairy shop since 1998. Ghee, makhan, dahi and paneer made fresh in our own kitchen.',
          '0300 5302218', '0300 5302218', 'Every day, 8:00 am to 10:00 pm', 8)
  on conflict (area_manager_id) do update set tagline = excluded.tagline, description = excluded.description;

  perform setseed(0.7);
  for d in reverse 29..0 loop
    for i in 1..(2 + floor(random() * 4))::int loop
      v_ts := pg_temp.pk(-d, '09:00') + floor(random() * 12 * 60) * interval '1 minute';
      continue when v_ts > now();
      insert into shop_orders (area_manager_id, customer_name, customer_phone, channel, delivery_address, status, total_amount, created_at, delivered_at)
      values (s1, (array['Ayesha Khan','Bilal Ahmed','Sana Tariq','Usman Ali','Hira Malik','Hamza Sheikh','Zainab Raza','Saad Qureshi'])[1 + floor(random() * 8)::int],
              '03' || (10 + floor(random() * 40))::int || lpad(floor(random() * 10000000)::text, 7, '0'), 'app',
              (array['House 12, Street 4, Satellite Town','Flat 3, Al-Noor Plaza','House 88, Block C, Model Town','House 21, Street 9, Gulraiz'])[1 + floor(random() * 4)::int],
              case when d = 0 and v_ts > now() - interval '2 hours' then 'preparing' else 'delivered' end::shop_order_status, 0, v_ts,
              case when not (d = 0 and v_ts > now() - interval '2 hours') then v_ts + interval '50 minutes' end)
      returning id into v_order;
      v_total := 0;
      for v_prod in select * from products where area_manager_id = s1 and created_at < v_ts order by random() limit (1 + floor(random() * 2))::int loop
        v_qty := case when v_prod.category in ('ghee', 'butter', 'cheese', 'cream') then (array[0.5, 1, 1, 2])[1 + floor(random() * 4)::int] else (1 + floor(random() * 3)) end;
        insert into shop_order_items (order_id, product_id, name, category, milk_type, unit, quantity, unit_price)
        values (v_order, v_prod.id, v_prod.name, v_prod.category, v_prod.milk_type, v_prod.unit, v_qty, v_prod.price);
        v_total := v_total + v_qty * v_prod.price;
      end loop;
      update shop_orders set total_amount = v_total where id = v_order;
      if random() < 0.25 and d > 0 then
        insert into shop_reviews (area_manager_id, order_id, reviewer_name, rating, comment, created_at)
        select s1, v_order, so.customer_name, (array[5, 5, 5, 4, 4, 3])[1 + floor(random() * 6)::int],
               (array['Ghee ki khushboo bilkul ghar jaisi hai.', 'Paneer was soft and fresh, will order again.', 'Dahi is thick, my mother loved it.',
                      'Delivered on time, packing was neat.', 'Good makhan, a little pricey but worth it.', 'Lassi was perfect for iftar.'])[1 + floor(random() * 6)::int],
               v_ts + interval '3 hours'
          from shop_orders so where so.id = v_order;
      end if;
    end loop;
  end loop;

  -- ---------- 5. bulk market ----------
  -- delivered 24 days ago, split between both centers
  r := pg_temp.demo_req(b1, 'milk', 'buffalo', 400, 'litre', 'fresh', 210, 'Islamabad', 'Shop 3, F-7 Markaz', 'Weekend rush. Delivery before 9 am please.', -24, 'awarded');
  x := pg_temp.demo_bid(r, c2, 200, 200, 'accepted', 'Fresh morning milk, chilled van.');
  y := pg_temp.demo_bid(r, c1, 205, 250, 'accepted');
  o := pg_temp.demo_order(x, 200, 'delivered', 'fresh');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b1, c2, 5, 'Arrived cold and early. Malai was excellent.', pg_temp.pk(-24, '13:00'));
  o := pg_temp.demo_order(y, 200, 'delivered', 'fresh');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b1, c1, 4, 'Good milk, came about 20 minutes late.', pg_temp.pk(-24, '13:10'));

  -- delivered 17 days ago, one seller
  r := pg_temp.demo_req(b2, 'milk', 'cow', 150, 'litre', 'standard', 195, 'Rawalpindi', 'Bank Road, Saddar', null, -17, 'awarded');
  x := pg_temp.demo_bid(r, c1, 190, 150, 'accepted');
  y := pg_temp.demo_bid(r, c2, 196, 150, 'not_selected');
  o := pg_temp.demo_order(x, 150, 'delivered', 'standard');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b2, c1, 5, 'Exactly what we needed for the morning bake.', pg_temp.pk(-17, '12:00'));

  -- desi ghee from the seller, 12 days ago
  r := pg_temp.demo_req(b1, 'ghee', 'buffalo', 20, 'kg', 'standard', 2450, 'Islamabad', 'Shop 3, F-7 Markaz', 'For our karahi. Pure buffalo ghee only.', -12, 'awarded');
  x := pg_temp.demo_bid(r, s1, 2350, 20, 'accepted', 'Made this week, sealed tins.');
  o := pg_temp.demo_order(x, 20, 'delivered');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b1, s1, 5, 'Real desi ghee. Customers noticed the taste.', pg_temp.pk(-12, '15:00'));

  -- split again 8 days ago; the complaint below is about the khalid part
  r := pg_temp.demo_req(b2, 'milk', 'mixed', 300, 'litre', 'standard', 190, 'Rawalpindi', 'Bank Road, Saddar', null, -8, 'awarded');
  x := pg_temp.demo_bid(r, c2, 182, 160, 'accepted');
  y := pg_temp.demo_bid(r, c1, 185, 160, 'accepted');
  o := pg_temp.demo_order(x, 160, 'delivered', 'standard');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b2, c2, 5, 'Very good, on time.', pg_temp.pk(-8, '12:30'));
  o := pg_temp.demo_order(y, 140, 'delivered', 'fresh');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b2, c1, 3, 'Milk was good but came two hours late.', pg_temp.pk(-8, '14:00'));

  -- a cancellation: taxila could not deliver 5 days ago, khalid stepped in
  r := pg_temp.demo_req(b1, 'milk', 'cow', 120, 'litre', 'standard', 198, 'Islamabad', 'Shop 3, F-7 Markaz', null, -5, 'awarded');
  x := pg_temp.demo_bid(r, c2, 192, 120, 'accepted');
  perform pg_temp.demo_order(x, 120, 'cancelled');
  y := pg_temp.demo_bid(r, c1, 197, 120, 'accepted');
  o := pg_temp.demo_order(y, 120, 'delivered', 'standard');

  -- premium buffalo milk 3 days ago
  r := pg_temp.demo_req(b1, 'milk', 'buffalo', 250, 'litre', 'premium', 230, 'Islamabad', 'Shop 3, F-7 Markaz', 'For kheer on the new menu.', -3, 'awarded');
  x := pg_temp.demo_bid(r, c1, 226, 250, 'accepted');
  o := pg_temp.demo_order(x, 250, 'delivered', 'premium');
  insert into bulk_reviews (order_id, business_id, area_manager_id, rating, comment, created_at) values (o, b1, c1, 5, 'Premium really is premium. Thick and fresh.', pg_temp.pk(-3, '12:00'));

  -- live: 500 L with bids from both centers, waiting for the restaurant to split it
  r := pg_temp.demo_req(b1, 'milk', 'buffalo', 500, 'litre', 'fresh', 212, 'Islamabad', 'Shop 3, F-7 Markaz', 'Eid week. We can take it from two centers.', 2, 'open');
  perform pg_temp.demo_bid(r, c1, 210, 300, 'submitted', 'We can deliver by 8 am.');
  perform pg_temp.demo_bid(r, c2, 206, 250, 'submitted', 'Chilled van, tested on dispatch.');

  -- live: accepted yesterday, khalid has to test and dispatch it
  r := pg_temp.demo_req(b2, 'milk', 'cow', 200, 'litre', 'standard', 195, 'Rawalpindi', 'Bank Road, Saddar', null, 1, 'awarded');
  x := pg_temp.demo_bid(r, c1, 192, 200, 'accepted');
  y := pg_temp.demo_bid(r, c2, 194, 200, 'not_selected');
  perform pg_temp.demo_order(x, 200, 'confirmed');

  -- live: butter with one offer, cheese and mixed milk with none yet
  r := pg_temp.demo_req(b2, 'butter', 'buffalo', 15, 'kg', 'standard', 1550, 'Rawalpindi', 'Bank Road, Saddar', 'Unsalted white butter for croissants.', 3, 'open');
  perform pg_temp.demo_bid(r, s1, 1480, 15, 'submitted', 'Churned the morning of delivery.');
  perform pg_temp.demo_req(b1, 'cheese', 'buffalo', 10, 'kg', 'standard', 1850, 'Islamabad', 'Shop 3, F-7 Markaz', 'Fresh paneer for the tikka menu.', 4, 'open');
  perform pg_temp.demo_req(b2, 'milk', 'mixed', 300, 'litre', 'standard', 188, 'Rawalpindi', 'Bank Road, Saddar', null, 3, 'open');

  -- ---------- 6. support ----------
  select o2.id into o from bulk_orders o2 join bulk_requirements q on q.id = o2.requirement_id
   where o2.business_id = b2 and o2.area_manager_id = c1 and q.quantity_l = 300 limit 1;
  insert into support_tickets (opened_by, topic, subject, bulk_order_id, center_id, status, created_at, updated_at, resolved_at, resolved_by)
  values (u_bakery, 'order', 'Milk came two hours late', o, c1, 'resolved', pg_temp.pk(-8, '11:20'), pg_temp.pk(-7, '10:05'), pg_temp.pk(-7, '10:05'), u_bakery)
  returning id into t;
  insert into support_messages (ticket_id, author_id, side, body, created_at) values
    (t, u_bakery, 'user', 'Our 140 L from Khalid Milk Center was due at 8 am and came at 10. We had to delay the morning bake.', pg_temp.pk(-8, '11:20')),
    (t, u_khalid, 'seller', 'Very sorry. Our van had a flat tyre on Murree Road. We have a second van ready now so it will not happen again.', pg_temp.pk(-8, '12:05'));
  if v_admin is not null then
    insert into support_messages (ticket_id, author_id, side, body, created_at)
    values (t, v_admin, 'admin', 'Thanks both. We have noted this on the center''s record. Please tell us if it happens again.', pg_temp.pk(-8, '15:40'));
  end if;
  insert into support_messages (ticket_id, author_id, side, body, created_at)
  values (t, u_bakery, 'user', 'The last order came on time. Closing this, thank you.', pg_temp.pk(-7, '10:05'));

  insert into support_tickets (opened_by, topic, subject, status, created_at, updated_at)
  values (u_grill, 'other', 'Can we set up a weekly order?', 'open', pg_temp.pk(-1, '16:10'), pg_temp.pk(-1, '16:10'))
  returning id into t;
  insert into support_messages (ticket_id, author_id, side, body, created_at)
  values (t, u_grill, 'user', 'We need about 200 L of buffalo milk every Friday. Is there a way to post it once instead of every week?', pg_temp.pk(-1, '16:10'));

  if v_admin is not null then
    insert into support_tickets (opened_by, topic, subject, status, created_at, updated_at)
    values (u_taxila, 'billing', 'Device bill paid by JazzCash', 'answered', pg_temp.pk(-35, '10:00'), pg_temp.pk(-35, '13:30'))
    returning id into t;
    insert into support_messages (ticket_id, author_id, side, body, created_at) values
      (t, u_taxila, 'user', 'I paid the device bill by JazzCash this morning and entered the transaction ID. How long until the device works?', pg_temp.pk(-35, '10:00')),
      (t, v_admin, 'admin', 'Payment received and confirmed. Your device is active now. Run a test from Record milk.', pg_temp.pk(-35, '13:30'));
  end if;
end $$;

-- what was made
select p.email, p.full_name, coalesce(a.center_name, b.business_name) as name, p.role, p.status
from profiles p left join area_managers a on a.user_id = p.id left join business_profiles b on b.user_id = p.id
where p.email like '%@apnadairy.test' order by p.role, p.email;
