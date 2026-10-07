import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'

export default function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  const onSubmit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <AuthShell title="Forgot your password?" subtitle="We will email you a link to set a new one.">
      {sent ? (
        <div className="panel p-5 text-[15px] leading-relaxed">
          If an account exists for <span className="font-semibold">{email}</span>, a reset link is on its way. Open it on this device. Not in your inbox? Check Spam.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Alert>{error}</Alert>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" required autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
          </div>
          <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Sending…' : 'Send reset link'}</button>
        </form>
      )}
      <p className="mt-6 text-sm text-muted"><Link to="/login" className="font-semibold text-forest hover:underline">Back to sign in</Link></p>
    </AuthShell>
  )
}
