-- removes everything demo/demo_data.sql made: the six demo accounts and all their data.
-- only accounts the demo script made (marked as demo) are removed. safe to run again.
-- anything a real account did with a demo account goes too: bulk orders between them, and reviews of those orders.
-- tickets real accounts opened about a demo seller stay (without the seller).

do $$
declare
  v_users uuid[];
  v_sellers uuid[];
  v_buyers uuid[];
begin
  select array_agg(id) into v_users from auth.users
   where email in ('khalid@apnadairy.test', 'taxila@apnadairy.test', 'ghee@apnadairy.test',
                   'grill@apnadairy.test', 'bakery@apnadairy.test', 'hotel@apnadairy.test')
     and coalesce((raw_app_meta_data->>'demo')::boolean, false);
  if v_users is null then raise notice 'no demo accounts found'; return; end if;
  select coalesce(array_agg(id), '{}') into v_sellers from area_managers where user_id = any(v_users);
  select coalesce(array_agg(id), '{}') into v_buyers from business_profiles where user_id = any(v_users);

  -- rows that point at the demo accounts without being removed with them
  delete from support_tickets where opened_by = any(v_users);
  delete from bulk_reviews where business_id = any(v_buyers) or area_manager_id = any(v_sellers);
  delete from delivery_codes where order_kind = 'bulk'
     and order_id in (select id from bulk_orders where business_id = any(v_buyers) or area_manager_id = any(v_sellers));
  delete from bulk_orders where business_id = any(v_buyers) or area_manager_id = any(v_sellers);
  delete from bids where area_manager_id = any(v_sellers);
  delete from bulk_requirements where business_id = any(v_buyers);
  delete from delivery_codes where order_kind = 'shop' and order_id in (select id from shop_orders where area_manager_id = any(v_sellers));
  delete from collection_audit where actor = any(v_users) or area_manager_id = any(v_sellers);
  delete from usage_audit where actor = any(v_users) or area_manager_id = any(v_sellers);
  update iot_devices set area_manager_id = null where area_manager_id = any(v_sellers);   -- a real device stays, unlinked

  -- the login; profiles, centers, businesses, farmers, milk, orders, products and bills go with it
  delete from auth.users where id = any(v_users);
end $$;

select count(*) as demo_accounts_left from auth.users where coalesce((raw_app_meta_data->>'demo')::boolean, false);
