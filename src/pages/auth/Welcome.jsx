import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/roles'
import { nameError, titleError, cityError, phoneError, firstError, prettyPhone, tidyCity, CITIES } from '../../lib/validate'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'
import Loader from '../../components/Loader'
import ProfileProblem from '../../components/ProfileProblem'

const roles = [
  { id: 'area_manager', label: 'Area Manager', hint: 'Run a collection center or sell dairy products' },
  { id: 'business', label: 'Business Buyer', hint: 'Restaurants, bakeries, hotels buying in bulk' },
]

// after signing in with google for the first time: the same details as the email sign-up form.
// the account then waits for documents and approval like any other.
export default function Welcome() {
  const { session, profile, loading, refreshProfile, signOut } = useAuth()
  const nav = useNavigate()
  const [role, setRole] = useState('area_manager')
  const [f, setF] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <Loader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <ProfileProblem />
  if (profile.role !== 'customer') return <Navigate to={profile.status === 'active' ? homeFor(profile.role) : '/pending'} replace />

  const form = f ?? { full_name: profile.full_name ?? '', phone: profile.phone ?? '', manager_type: 'milk_center', center_name: '', business_name: '', business_type: 'restaurant', city: '', address: '' }
  const set = (k) => (e) => setF({ ...form, [k]: e.target.value })

  const submit = async (e) => {
    e.preventDefault()
    const bad = firstError(
      nameError(form.full_name, 'full name'),
      phoneError(form.phone, { required: true }),
      role === 'area_manager' ? titleError(form.center_name, 'center or shop name') : titleError(form.business_name, 'business name'),
      cityError(form.city),
      form.address.length > 200 ? 'The address is too long.' : '',
    )
    if (bad) return setError(bad)
    setError(''); setBusy(true)
    const { error: err } = await supabase.rpc('complete_portal_signup', {
      p_role: role, p_full_name: form.full_name.trim(), p_phone: prettyPhone(form.phone), p_city: tidyCity(form.city),
      p_address: form.address.trim() || null, p_manager_type: form.manager_type, p_center_name: form.center_name.trim() || null,
      p_business_name: form.business_name.trim() || null, p_business_type: form.business_type,
    })
    setBusy(false)
    if (err) return setError(err.message)
    await refreshProfile()
    nav('/pending', { replace: true })
  }

  return (
    <AuthShell title="Finish signing up" subtitle={`Signed in as ${profile.email}. Tell us who you are, then upload your documents.`}>
      <div className="mb-6 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
        {roles.map((r) => (
          <button key={r.id} type="button" onClick={() => setRole(r.id)} role="radio" aria-checked={role === r.id}
            className={`rounded-[10px] border px-3.5 py-3 text-left transition-colors ${role === r.id ? 'border-forest bg-mint-soft' : 'border-line bg-surface hover:border-[#b9c4c9]'}`}>
            <p className={`text-[15px] font-semibold ${role === r.id ? 'text-forest' : 'text-ink'}`}>{r.label}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{r.hint}</p>
          </button>
        ))}
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field"><label htmlFor="w-name">Full name</label>
            <input id="w-name" className="input" maxLength={80} value={form.full_name} onChange={set('full_name')} /></div>
          <div className="field"><label htmlFor="w-phone">Mobile number</label>
            <input id="w-phone" type="tel" inputMode="tel" className="input num" maxLength={16} placeholder="0300 1234567" value={form.phone} onChange={set('phone')} /></div>
        </div>
        {role === 'area_manager' ? (
          <>
            <div className="field"><label htmlFor="w-type">What do you operate?</label>
              <select id="w-type" className="input" value={form.manager_type} onChange={set('manager_type')}>
                <option value="milk_center">Milk collection center</option>
                <option value="byproduct">Dairy byproducts (desi ghee, etc.)</option>
              </select></div>
            <div className="field"><label htmlFor="w-center">Center or shop name</label>
              <input id="w-center" className="input" maxLength={80} value={form.center_name} onChange={set('center_name')} /></div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="field"><label htmlFor="w-biz">Business name</label>
              <input id="w-biz" className="input" maxLength={80} value={form.business_name} onChange={set('business_name')} /></div>
            <div className="field"><label htmlFor="w-btype">Type</label>
              <select id="w-btype" className="input" value={form.business_type} onChange={set('business_type')}>
                {['restaurant', 'bakery', 'hotel', 'shop', 'distributor', 'other'].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select></div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <div className="field"><label htmlFor="w-city">City</label>
            <input id="w-city" className="input" maxLength={40} list="w-cities" value={form.city} onChange={set('city')} />
            <datalist id="w-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist></div>
          <div className="field"><label htmlFor="w-addr">Address <span className="font-normal text-muted">(optional)</span></label>
            <input id="w-addr" className="input" maxLength={200} value={form.address} onChange={set('address')} /></div>
        </div>
        <Alert>{error}</Alert>
        <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Saving…' : 'Continue'}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Buying milk for your home? <Link to="/mobile-only" className="font-semibold text-forest hover:underline">Use the ApnaDairy app</Link>
        {' · '}<button onClick={signOut} className="font-semibold text-forest hover:underline">Sign out</button>
      </p>
    </AuthShell>
  )
}
