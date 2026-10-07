// admin-users: the super admin invites new admins by email.
//   { action: 'invite', full_name, email, phone }  ->  { invite: { id, email, full_name } }
//   { action: 'resend', user_id }                  ->  { ok: true }   the invite email again
//   { action: 'cancel', user_id }                  ->  { ok: true }   removes an invite that was not opened
// the person gets an email from supabase auth, opens the link (that confirms the email) and sets a password.
// only then does the database make the account an admin (supabase/30_accounts.sql). nobody is admin before that.
// deploy: supabase dashboard → edge functions → admin-users → paste this → deploy.
// needs: auth smtp set up (authentication → smtp settings) so the invite email can be sent, and the portal's
// /set-password address in authentication → url configuration → redirect urls.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// 0300 1234567, +92 300 1234567 → 03001234567
const normPhone = (s: string) => {
  const d = s.replace(/\D/g, '')
  return d.startsWith('92') && d.length === 12 ? `0${d.slice(2)}` : d
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // only an active super admin
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return reply({ error: 'Sign in again.' }, 401)
    const { data: me } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
    if (me?.role !== 'super_admin' || me?.status !== 'active') return reply({ error: 'Only a super admin can manage admins.' }, 403)

    const body = await req.json().catch(() => ({}))
    const site = (Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? '').replace(/\/$/, '')
    const redirectTo = /^https?:\/\//.test(site) ? `${site}/set-password` : undefined

    if (body.action === 'resend' || body.action === 'cancel') {
      const { data: inv } = await admin.from('admin_invites').select('*').eq('user_id', String(body.user_id ?? '')).maybeSingle()
      if (!inv) return reply({ error: 'Invite not found.' })
      if (inv.accepted_at) return reply({ error: 'This invite was already accepted.' })
      if (body.action === 'cancel') {
        const { error } = await admin.auth.admin.deleteUser(inv.user_id)   // the invite row goes with it
        return error ? reply({ error: error.message }) : reply({ ok: true })
      }
      const { error } = await admin.auth.admin.inviteUserByEmail(inv.email, { redirectTo, data: { full_name: inv.full_name, role: 'customer' } })
      return error ? reply({ error: `The email could not be sent: ${error.message}` }) : reply({ ok: true })
    }

    const name = String(body.full_name ?? '').trim()
    const email = String(body.email ?? '').trim().toLowerCase()
    const phone = normPhone(String(body.phone ?? ''))
    if (name.length < 3 || name.length > 80) return reply({ error: 'Enter the full name.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply({ error: 'Enter a valid email address.' })
    if (!/^03\d{9}$/.test(phone)) return reply({ error: 'Phone must be a mobile number like 0300 1234567.' })

    // the login exists but has no password and no admin rights until the link is opened
    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo, data: { full_name: name, phone, role: 'customer' },
    })
    if (error) {
      const taken = /already|registered|exists/i.test(error.message)
      return reply({ error: taken ? 'An account with this email already exists. Admins need a new email address.' : `The invite could not be sent: ${error.message}` })
    }
    const { error: e2 } = await admin.from('admin_invites').insert({ user_id: invited.user.id, email, full_name: name, invited_by: user.id })
    if (e2) {
      await admin.auth.admin.deleteUser(invited.user.id)
      return reply({ error: e2.message }, 500)
    }
    return reply({ invite: { id: invited.user.id, email, full_name: name } })
  } catch (e) {
    return reply({ error: `Could not invite the admin: ${(e as Error).message}` }, 500)
  }
})
