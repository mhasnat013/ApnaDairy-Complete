import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/roles'
import AuthShell from '../../components/AuthShell'
import Alert from '../../components/Alert'
import Loader from '../../components/Loader'

// opened from the reset email (or an admin invite): supabase signs the user in from the link, then they pick a password
export default function ResetPassword({ invite = false }) {
  const { session, loading, refreshProfile, profile } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (loading) return <Loader />
  if (!session) {
    return (
      <AuthShell title="Link expired" subtitle={invite ? 'This invite link is no longer valid.' : 'This reset link is no longer valid.'}>
        <p className="text-[15px] text-muted">{invite ? 'Ask the admin who invited you to send the invite again.' : 'Ask for a new link and open it soon after it arrives.'}</p>
        {!invite && <Link to="/forgot-password" className="btn-primary mt-6">Send a new link</Link>}
      </AuthShell>
    )
  }

  const onSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (pw.length < 8 || !/[a-z]/i.test(pw) || !/\d/.test(pw)) return setError('Use at least 8 characters with letters and numbers.')
    if (pw !== pw2) return setError('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    setBusy(false)
    if (error) return setError(error.message)
    if (invite) { await refreshProfile(); nav(homeFor(profile?.role ?? 'super_admin'), { replace: true }) }
    else nav('/login', { replace: true })
  }

  return (
    <AuthShell title={invite ? 'Welcome to ApnaDairy' : 'Set a new password'} subtitle={invite ? 'Your email is confirmed. Set a password to finish setting up your admin account.' : 'Pick something you have not used before.'}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <Alert>{error}</Alert>
        <div className="field">
          <label htmlFor="pw">New password</label>
          <input id="pw" type="password" className="input" required autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw2">Type it again</label>
          <input id="pw2" type="password" className="input" required autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </div>
        <button className="btn-primary mt-2" disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
      </form>
    </AuthShell>
  )
}
