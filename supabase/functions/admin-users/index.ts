// admin-users: the super admin creates a new admin account.
//   { full_name, email, password }  ->  { admin: { id, email, full_name } }
// deploy: supabase dashboard → edge functions → deploy a new function → via editor, name "admin-users".
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // only an active super admin may create admins
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return reply({ error: 'Sign in again.' }, 401)
    const { data: me } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
    if (me?.role !== 'super_admin' || me?.status !== 'active') return reply({ error: 'Only a super admin can create admins.' }, 403)

    const body = await req.json().catch(() => ({}))
    const name = String(body.full_name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const password = String(body.password ?? '')
    if (name.length < 3) return reply({ error: 'Enter the full name.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply({ error: 'Enter a valid email address.' })
    if (password.length < 8 || !/[0-9]/.test(password) || !/[a-zA-Z]/.test(password)) {
      return reply({ error: 'The password needs at least 8 characters, with letters and numbers.' })
    }

    // the login is created already confirmed; the signup trigger makes a plain profile, then it becomes an admin
    const { data: created, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { full_name: name, role: 'customer' },
    })
    if (error) {
      const taken = /already|registered|exists/i.test(error.message)
      return reply({ error: taken ? 'An account with this email already exists.' : error.message })
    }
    const { error: e2 } = await admin.rpc('make_new_admin', { p_user: created.user.id })
    if (e2) {
      await admin.auth.admin.deleteUser(created.user.id)
      return reply({ error: e2.message }, 500)
    }
    return reply({ admin: { id: created.user.id, email, full_name: name } })
  } catch (e) {
    return reply({ error: `Could not create the admin: ${(e as Error).message}` }, 500)
  }
})
