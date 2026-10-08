"""create_supabase_client() -> supabase Client using the SERVICE ROLE key.
The service key never leaves this server. All RLS still applies per user
where user-scoped queries run with the user's JWT."""
