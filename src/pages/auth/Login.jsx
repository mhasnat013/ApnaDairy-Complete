import { useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/roles'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'
import GoogleButton, { OrLine } from '../../components/GoogleButton'
import ResendConfirmation from '../../components/ResendConfirmation'

export default function Login() {
  const { session, profile } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [unconfirmed, setUnconfirmed] = useState(false)

  // already logged in → go to the right place
  if (session && profile) {
    return <Navigate to={profile.status === 'active' ? homeFor(profile.role) : '/pending'} replace />
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    setUnconfirmed(false)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setBusy(false)
    if (error) {
      setError(error.message)
      setUnconfirmed(/not confirmed/i.test(error.message))
    }
    // on success, AuthContext loads the profile and the redirect above runs
  }

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your ApnaDairy portal.">
      <GoogleButton onError={setError} />
      <OrLine />
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Alert>{error}</Alert>
        {unconfirmed && <ResendConfirmation email={email.trim().toLowerCase()} className="-mt-2 text-[14px]" />}
        <div className="field">
          <label htmlFor="email">Email</label>
          <input id="email" type="email" className="input" required autoComplete="email"
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="field">
          <span className="flex items-center justify-between"><label htmlFor="password">Password</label>
            <Link to="/forgot-password" className="text-[13px] font-semibold text-forest hover:underline">Forgot password?</Link></span>
          <input id="password" type="password" className="input" required autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
        </div>
        <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <p className="mt-6 text-sm text-muted">
        New to ApnaDairy?{' '}
        <Link to="/signup" className="font-semibold text-forest hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  )
}
