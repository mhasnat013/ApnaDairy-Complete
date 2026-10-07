import { useState } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useUi } from '../context/UiContext'
import { useLoad } from '../lib/useLoad'
import { roleLabel } from '../lib/roles'
import { nameError, phoneError, passwordError, firstError, prettyPhone } from '../lib/validate'
import { cap } from '../lib/format'
import PageHeader from '../components/PageHeader'
import Card from '../components/Card'
import Alert from '../components/Alert'

// every portal user: their own name, phone and password. the phone is only kept for records (no sms).
export default function Account() {
  const { profile, session, refreshProfile } = useAuth()
  const { center } = useOutletContext() ?? {}
  const { toast } = useUi()
  const base = profile.role === 'super_admin' ? '/admin' : profile.role === 'business' ? '/business' : '/manager'
  const providers = session?.user?.app_metadata?.providers ?? [session?.user?.app_metadata?.provider].filter(Boolean)
  const google = providers.includes('google')
  const hasPassword = providers.length === 0 || providers.includes('email')

  const { data: biz } = useLoad(async () => {
    if (profile.role !== 'business') return null
    const { data } = await supabase.from('business_profiles').select('business_name, business_type, city, address').eq('user_id', profile.id).maybeSingle()
    return data
  }, [profile.id, profile.role])

  const [f, setF] = useState({ full_name: profile.full_name ?? '', phone: profile.phone ?? '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const saveDetails = async (e) => {
    e.preventDefault()
    const bad = firstError(nameError(f.full_name, 'full name'), phoneError(f.phone, { required: profile.role !== 'super_admin' }))
    if (bad) return setErr(bad)
    setErr(''); setBusy(true)
    const { error } = await supabase.from('profiles')
      .update({ full_name: f.full_name.trim(), phone: f.phone.trim() ? prettyPhone(f.phone) : null, updated_at: new Date().toISOString() })
      .eq('id', profile.id)
    setBusy(false)
    if (error) return setErr(error.message)
    await refreshProfile()
    toast('Your details are saved.')
  }

  const [pw, setPw] = useState({ a: '', b: '' })
  const [pwErr, setPwErr] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const savePassword = async (e) => {
    e.preventDefault()
    const bad = firstError(passwordError(pw.a), pw.a !== pw.b ? 'The two passwords do not match.' : '')
    if (bad) return setPwErr(bad)
    setPwErr(''); setPwBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw.a })
    setPwBusy(false)
    if (error) return setPwErr(error.message)
    setPw({ a: '', b: '' })
    toast(hasPassword ? 'Password changed.' : 'Password set. You can now also sign in with your email.')
  }

  const place = center
    ? [['Name', center.center_name], ['Type', center.type === 'byproduct' ? 'Dairy products seller' : 'Milk collection center'], ['City', center.city], ['Address', center.address || '—']]
    : biz ? [['Name', biz.business_name], ['Type', cap(biz.business_type)], ['City', biz.city], ['Address', biz.address || '—']] : null

  return (
    <>
      <PageHeader title="My account" description="Your name, phone number and password." />
      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <Card title="Your details" subtitle={`${roleLabel[profile.role]} account`}>
          <form onSubmit={saveDetails} noValidate className="grid gap-4">
            <Alert>{err}</Alert>
            <div className="field"><span className="label">Email</span>
              <p className="flex h-11 items-center gap-2 rounded-2xl bg-cream px-4 text-[15px]">{profile.email}{google && <span className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold text-muted">Google</span>}</p>
              <span className="hint">Your sign-in email cannot be changed here.</span></div>
            <div className="field"><label htmlFor="acc-name">Full name</label>
              <input id="acc-name" className="input" maxLength={80} value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} /></div>
            <div className="field"><label htmlFor="acc-phone">Mobile number</label>
              <input id="acc-phone" type="tel" inputMode="tel" className="input num" maxLength={16} placeholder="0300 1234567" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
              <span className="hint">Kept for records so ApnaDairy can reach you. No SMS is sent.</span></div>
            <button className="btn-primary justify-self-start" disabled={busy}>{busy ? 'Saving…' : 'Save details'}</button>
          </form>
        </Card>

        <Card title={hasPassword ? 'Change password' : 'Set a password'} subtitle={hasPassword ? 'Use at least 8 characters with letters and numbers.' : 'You sign in with Google. A password lets you sign in with your email too.'}>
          <form onSubmit={savePassword} noValidate className="grid gap-4">
            <Alert>{pwErr}</Alert>
            <div className="field"><label htmlFor="acc-pw">New password</label>
              <input id="acc-pw" type="password" className="input" autoComplete="new-password" value={pw.a} onChange={(e) => setPw({ ...pw, a: e.target.value })} /></div>
            <div className="field"><label htmlFor="acc-pw2">Type it again</label>
              <input id="acc-pw2" type="password" className="input" autoComplete="new-password" value={pw.b} onChange={(e) => setPw({ ...pw, b: e.target.value })} /></div>
            <button className="btn-primary justify-self-start" disabled={pwBusy}>{pwBusy ? 'Saving…' : hasPassword ? 'Change password' : 'Set password'}</button>
          </form>
        </Card>

        {place && (
          <Card title={profile.role === 'business' ? 'Your business' : 'Your center'} subtitle="From your registration, checked by ApnaDairy.">
            <dl className="grid gap-2 text-[14.5px]">
              {place.map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-line pb-2 last:border-0"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
            </dl>
            <p className="mt-4 text-[13px] text-muted">Need to change these? <Link to={`${base}/support`} className="font-semibold text-forest hover:underline">Ask ApnaDairy support</Link>.</p>
          </Card>
        )}
      </div>
    </>
  )
}
