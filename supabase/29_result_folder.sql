-- 29: every iot device reads the Result folder in firebase (the demo folder is no longer used)
-- run after 28_reject_reason.sql (safe to run again).
update public.iot_devices set path = 'Result' where path is distinct from 'Result';
alter table public.iot_devices alter column path set default 'Result';
alter table public.iot_devices drop constraint if exists iot_devices_result_folder;
alter table public.iot_devices add constraint iot_devices_result_folder check (path = 'Result');
