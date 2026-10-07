-- 40: the public bulk requests page works for visitors who are not signed in
-- run after 39_bulk_moderation.sql (safe to run again).
-- the public list shows how much of each request is still needed, which uses requirement_covered().
-- visitors (anon) could not call it, so the page showed "you are not allowed to do this".
grant execute on function public.requirement_covered(uuid) to anon;
