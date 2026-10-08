-- removes the farmers loaded by farmers_from_app.sql (their accounts, requests and reviews).
-- milk a center already bought from them stays in that center's records.
delete from auth.users where id in (select user_id from public.farmer_profiles where app_managed);
select count(*) as app_farmers_left from public.farmer_profiles where app_managed;
