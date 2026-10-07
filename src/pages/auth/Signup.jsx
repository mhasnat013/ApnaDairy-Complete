import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'
import GoogleButton, { OrLine } from '../../components/GoogleButton'
import ResendConfirmation from '../../components/ResendConfirmation'
import { nameError, titleError, cityError, emailError, phoneError, passwordError, firstError, normPhone, tidyCity, CITIES } from '../../lib/validate'

const roles = [
  { id: 'area_manager', label: 'Area Manager', hint: 'Run a collection center or sell dairy products' },
  { id: 'business', label: 'Business Buyer', hint: 'Restaurants, bakeries, hotels buying in bulk' },
]

const empty = {
  full_name: '', email: '', phone: '', password: '', password2: '',
  manager_type: 'milk_center', center_name: '',
  business_name: '', business_type: 'restaurant',
  city: '', address: '',
}

export default function Signup() {
  const { session } = useAuth()
  const [params] = useSearchParams()
  const [role, setRole] = useState(params.get('role') === 'business' ? 'business' : 'area_manager')
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/pending" replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const onSubmit = async (e) => {
    e.preventDefault()
    const bad = firstError(
      nameError(form.full_name, 'full name'),
      emailError(form.email),
      phoneError(form.phone, { required: true }),
      role === 'area_manager' ? titleError(form.center_name, 'center or shop name') : titleError(form.business_name, 'business name'),
      cityError(form.city),
      form.address.length > 200 ? 'The address is too long.' : '',
      passwordError(form.password),
      form.password !== form.password2 ? 'The two passwords do not match.' : '',
    )
    if (bad) return setError(bad)
    setError('')
    setBusy(true)

    // everything in "data" lands in raw_user_meta_data → the db trigger builds the profile
    const meta = { role, full_name: form.full_name.trim(), phone: normPhone(form.phone), city: tidyCity(form.city), address: form.address.trim() }
    if (role === 'area_manager') Object.assign(meta, { manager_type: form.manager_type, center_name: form.center_name.trim() })
    else Object.assign(meta, { business_name: form.business_name.trim(), business_type: form.business_type })

    const { data, error } = await supabase.auth.signUp({
      email: form.email.trim().toLowerCase(),
      password: form.password,
      options: { data: meta, emailRedirectTo: `${window.location.origin}/pending` },
    })
    setBusy(false)
    if (error) return setError(error.message)
    // supabase answers an already-used email without an error, but with no sign-in methods
    if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) return setError('An account with this email already exists. Sign in instead, or use Forgot password.')
    if (!data.session) setDone(true) // email confirmation is on
  }

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle={`We sent a confirmation link to ${form.email.trim().toLowerCase()}.`}>
        <Alert type="success">
          Open the link to confirm your email. Then upload your documents; the ApnaDairy admin reviews your account before it opens. Not in your inbox? Check Spam and mark it "Not spam".
        </Alert>
        <ResendConfirmation email={form.email.trim().toLowerCase()} className="mt-4 text-[14px]" />
        <Link to="/login" className="btn-primary mt-6 w-full">Go to sign in</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Create your account" subtitle="Accounts are verified by ApnaDairy before activation.">
      {/* role picker */}
      <div className="mb-6 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
        {roles.map((r) => (
          <button key={r.id} type="button" onClick={() => setRole(r.id)}
            role="radio" aria-checked={role === r.id}
            className={`rounded-[10px] border px-3.5 py-3 text-left transition-colors ${role === r.id ? 'border-forest bg-mint-soft' : 'border-line bg-surface hover:border-[#b9c4c9]'}`}>
            <p className={`text-[15px] font-semibold ${role === r.id ? 'text-forest' : 'text-ink'}`}>{r.label}</p>
            <p className="mt-0.5 text-[13px] leading-snug text-muted">{r.hint}</p>
          </button>
        ))}
      </div>

      <GoogleButton label="Sign up with Google" onError={setError} />
      <OrLine />
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">

        <div className="field">
          <label htmlFor="su-name">Full name</label>
          <input id="su-name" className="input" required maxLength={80} autoComplete="name" value={form.full_name} onChange={set('full_name')} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="su-email">Email</label>
            <input id="su-email" type="email" className="input" required maxLength={120} autoComplete="email" value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label htmlFor="su-phone">Mobile number</label>
            <input id="su-phone" type="tel" inputMode="tel" className="input num" required maxLength={16} autoComplete="tel" placeholder="0300 1234567" value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        {role === 'area_manager' ? (
          <>
            <div className="field">
              <label htmlFor="su-type">What do you operate?</label>
              <select id="su-type" className="input" value={form.manager_type} onChange={set('manager_type')}>
                <option value="milk_center">Milk collection center</option>
                <option value="byproduct">Dairy byproducts (desi ghee, etc.)</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="su-center">Center or shop name</label>
              <input id="su-center" className="input" required maxLength={80} value={form.center_name} onChange={set('center_name')} />
            </div>
          </>
        ) : (
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
            <div className="field">
              <label htmlFor="su-biz">Business name</label>
              <input id="su-biz" className="input" required maxLength={80} value={form.business_name} onChange={set('business_name')} />
            </div>
            <div className="field">
              <label htmlFor="su-btype">Type</label>
              <select id="su-btype" className="input" value={form.business_type} onChange={set('business_type')}>
                <option value="restaurant">Restaurant</option>
                <option value="bakery">Bakery</option>
                <option value="hotel">Hotel</option>
                <option value="shop">Shop</option>
                <option value="distributor">Distributor</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr]">
          <div className="field">
            <label htmlFor="su-city">City</label>
            <input id="su-city" className="input" required maxLength={40} list="su-cities" autoComplete="address-level2" value={form.city} onChange={set('city')} />
            <datalist id="su-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="field">
            <label htmlFor="su-addr">Address <span className="font-normal text-muted">(optional)</span></label>
            <input id="su-addr" className="input" maxLength={200} autoComplete="street-address" value={form.address} onChange={set('address')} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label htmlFor="su-pw">Password</label>
            <input id="su-pw" type="password" className="input" required minLength={8} autoComplete="new-password" value={form.password} onChange={set('password')} />
            <span className="hint">8 or more, letters and numbers</span>
          </div>
          <div className="field">
            <label htmlFor="su-pw2">Type it again</label>
            <input id="su-pw2" type="password" className="input" required autoComplete="new-password" value={form.password2} onChange={set('password2')} />
          </div>
        </div>

        <Alert>{error}</Alert>
        <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already registered? <Link to="/login" className="font-semibold text-forest hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}
