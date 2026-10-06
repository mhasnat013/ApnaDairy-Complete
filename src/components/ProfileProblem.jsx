import { useAuth } from '../context/AuthContext'
import Loader from './Loader'

// shown when the signed-in user's profile could not be loaded, instead of a spinner that never ends
export default function ProfileProblem() {
  const { profileError, refreshProfile, signOut } = useAuth()
  if (!profileError) return <Loader label="Setting up your account" />
  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <div className="panel max-w-sm p-6 text-center">
        <h2 className="display text-[22px] text-forest-deep">We could not load your account</h2>
        <p className="mt-2 text-[14px] text-muted">Check your internet and try again. If it keeps happening, sign out and sign in again.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button className="btn-primary" onClick={refreshProfile}>Try again</button>
          <button className="btn-secondary" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}
