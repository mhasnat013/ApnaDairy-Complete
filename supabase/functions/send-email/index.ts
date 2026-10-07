// send-email: emails an area manager or business about their account, from a gmail account (free, up to 500 a day).
//   { user_id, kind: 'account_rejected' }   ->  { sent: true, to }   the reason the admin gave
//   { user_id, kind: 'account_approved' }   ->  { sent: true, to }   "you can sign in now"
// only an active super admin can call it, and only when the account really is rejected / approved:
// the email text comes from the database, never from the caller.
// optional secret SITE_URL (the portal's link for the sign-in button); otherwise the admin's own portal address is used.
//
// deploy: supabase dashboard → edge functions → deploy a new function → via editor, name "send-email".
// secrets (edge functions → secrets):
//   GMAIL_USER          the gmail address that sends, e.g. apnadairy.fyp@gmail.com
//   GMAIL_APP_PASSWORD  a 16-letter google "app password" for that account (google account → security →
//                       2-step verification on → app passwords). not the normal gmail password.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { SMTPClient } from 'https://deno.land/x/denomailer@1.6.0/mod.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // only an active super admin
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return reply({ error: 'Sign in again.' }, 401)
    const { data: me } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
    if (me?.role !== 'super_admin' || me?.status !== 'active') return reply({ error: 'Only a super admin can send account emails.' }, 403)

    const body = await req.json().catch(() => ({}))
    const kind = body.kind
    if (kind !== 'account_rejected' && kind !== 'account_approved') return reply({ error: 'Unknown email.' }, 400)

    const { data: who } = await admin.from('profiles').select('id, full_name, email, role, status').eq('id', String(body.user_id ?? '')).maybeSingle()
    if (!who?.email) return reply({ error: 'Account not found.' })
    if (kind === 'account_rejected' && who.status !== 'rejected') return reply({ error: 'This account is not rejected.' })
    if (kind === 'account_approved' && who.status !== 'active') return reply({ error: 'This account is not approved.' })
    const table = who.role === 'business' ? 'business_profiles' : 'area_managers'
    const nameCol = who.role === 'business' ? 'business_name' : 'center_name'
    const { data: app } = await admin.from(table).select(`${nameCol}, rejection_reason`).eq('user_id', who.id).maybeSingle()
    const place = (app as Record<string, string> | null)?.[nameCol] ?? 'your account'
    const reason = (app as Record<string, string> | null)?.rejection_reason ?? 'No reason was given.'

    const userName = Deno.env.get('GMAIL_USER'), pass = Deno.env.get('GMAIL_APP_PASSWORD')
    if (!userName || !pass) return reply({ error: 'email is not set up yet (GMAIL_USER and GMAIL_APP_PASSWORD are missing)' })

    const first = String(who.full_name ?? '').split(' ')[0] || 'there'
    const site = (Deno.env.get('SITE_URL') ?? req.headers.get('origin') ?? '').replace(/\/$/, '')
    const signIn = /^https?:\/\//.test(site) ? `${site}/login` : null
    const mail = kind === 'account_approved' ? approvedMail(first, place, signIn) : rejectedMail(first, place, reason)

    // port 465 (ssl): supabase edge functions do not allow 25 or 587
    const client = new SMTPClient({ connection: { hostname: 'smtp.gmail.com', port: 465, tls: true, auth: { username: userName, password: pass } } })
    try {
      await client.send({ from: `ApnaDairy <${userName}>`, to: who.email, subject: mail.subject, content: mail.text, html: mail.html })
    } finally {
      await client.close()
    }
    return reply({ sent: true, to: who.email })
  } catch (e) {
    return reply({ error: `Email failed: ${(e as Error).message}` }, 500)
  }
})

const wrap = (inner: string) => `<div style="font-family:Arial,sans-serif;background:#f6efe0;padding:24px">
  <div style="max-width:520px;margin:auto;background:#fffcf4;border-radius:16px;padding:28px;color:#1e2b22">
    <p style="margin:0 0 4px;font-weight:bold;color:#1f4d36;font-size:18px">ApnaDairy</p>
    ${inner}
    <p style="margin-top:24px">ApnaDairy team</p>
  </div>
</div>`

function rejectedMail(first: string, place: string, reason: string) {
  const subject = 'Your ApnaDairy application was not approved'
  const text = [
      `Dear ${first},`, '',
      `Thank you for applying to ApnaDairy with ${place}. We checked your details and documents, and we could not approve the application.`, '',
      `Reason: ${reason}`, '',
      'You can sign up again with this email address once you have the right documents. If you think this is a mistake, reply to this email.', '',
      'ApnaDairy team',
  ].join('\n')
  const html = wrap(`<h2 style="margin:16px 0 12px;font-size:20px;color:#173a28">Your application was not approved</h2>
    <p>Dear ${esc(first)},</p>
    <p>Thank you for applying to ApnaDairy with <b>${esc(place)}</b>. We checked your details and documents, and we could not approve the application.</p>
    <p style="background:#f8e2dc;border-radius:12px;padding:12px 14px;color:#9b2c1f"><b>Reason:</b> ${esc(reason)}</p>
    <p>You can sign up again with this email address once you have the right documents. If you think this is a mistake, reply to this email.</p>`)
  return { subject, text, html }
}

function approvedMail(first: string, place: string, signIn: string | null) {
  const subject = 'Your ApnaDairy account is approved'
  const text = [
    `Dear ${first},`, '',
    `Good news: ApnaDairy has approved ${place}. Your portal is ready, and you can sign in now.`,
    ...(signIn ? ['', `Sign in: ${signIn}`] : []), '',
    'ApnaDairy team',
  ].join('\n')
  const html = wrap(`<h2 style="margin:16px 0 12px;font-size:20px;color:#173a28">Your account is approved</h2>
    <p>Dear ${esc(first)},</p>
    <p>Good news: ApnaDairy has approved <b>${esc(place)}</b>. Your portal is ready, and you can sign in now.</p>
    ${signIn ? `<p style="margin:22px 0"><a href="${esc(signIn)}" style="background:#1f4d36;color:#fffcf4;text-decoration:none;padding:12px 22px;border-radius:999px;font-weight:bold">Sign in to ApnaDairy</a></p>` : ''}`)
  return { subject, text, html }
}
