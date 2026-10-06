import { useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'

const roles = [
  { id: 'area_manager', label: 'Area Manager', hint: 'Run a collection center or sell dairy products' },
  { id: 'business', label: 'Business Buyer', hint: 'Restaurants, bakeries, hotels buying in bulk' },
]

const empty = {
  full_name: '', email: '', phone: '', password: '',
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
    setError('')
    setBusy(true)

    // everything in "data" lands in raw_user_meta_data → the db trigger builds the profile
    const meta = { role, full_name: form.full_name, phone: form.phone, city: form.city, address: form.address }
    if (role === 'area_manager') Object.assign(meta, { manager_type: form.manager_type, center_name: form.center_name })
    else Object.assign(meta, { business_name: form.business_name, business_type: form.business_type })

    const { data, error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: { data: meta },
    })
    setBusy(false)
    if (error) return setError(error.message)
    if (!data.session) setDone(true) // email confirmation is on
  }

  if (done) {
    return (
      <AuthShell title="Check your email" subtitle="We sent you a confirmation link.">
        <Alert type="success">
          After confirming, sign in. Your account will be reviewed by the ApnaDairy admin before you get full access.
        </Alert>
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

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Alert>{error}</Alert>

        <div className="field">
          <label>Full name</label>
          <input className="input" required value={form.full_name} onChange={set('full_name')} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="field">
            <label>Email</label>
            <input type="email" className="input" required value={form.email} onChange={set('email')} />
          </div>
          <div className="field">
            <label>Phone</label>
            <input className="input" required placeholder="03xx xxxxxxx" value={form.phone} onChange={set('phone')} />
          </div>
        </div>

        {role === 'area_manager' ? (
          <>
            <div className="field">
              <label>What do you operate?</label>
              <select className="input" value={form.manager_type} onChange={set('manager_type')}>
                <option value="milk_center">Milk collection center</option>
                <option value="byproduct">Dairy byproducts (desi ghee, etc.)</option>
              </select>
            </div>
            <div className="field">
              <label>Center / shop name</label>
              <input className="input" required value={form.center_name} onChange={set('center_name')} />
            </div>
          </>
        ) : (
          <div className="grid grid-cols-[1.4fr_1fr] gap-3">
            <div className="field">
              <label>Business name</label>
              <input className="input" required value={form.business_name} onChange={set('business_name')} />
            </div>
            <div className="field">
              <label>Type</label>
              <select className="input" value={form.business_type} onChange={set('business_type')}>
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

        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <div className="field">
            <label>City</label>
            <input className="input" required value={form.city} onChange={set('city')} />
          </div>
          <div className="field">
            <label>Address</label>
            <input className="input" value={form.address} onChange={set('address')} />
          </div>
        </div>

        <div className="field">
          <label>Password</label>
          <input type="password" className="input" required minLength={6} value={form.password} onChange={set('password')} />
        </div>

        <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already registered? <Link to="/login" className="font-semibold text-forest hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  )
}
