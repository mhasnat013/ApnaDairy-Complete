import { createClient } from '@supabase/supabase-js'

// only the project address: https://<ref>.supabase.co (a pasted .../rest/v1/ ending breaks sign-in)
const raw = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const url = raw.match(/^https?:\/\/[^/]+/)?.[0] ?? raw
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

if (!url || !key) {
  console.error('missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(url, key)
