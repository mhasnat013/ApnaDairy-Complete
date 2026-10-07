import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { roleLabel } from '../../lib/roles'
import AuthShell from '../../components/AuthShell'

export default function MobileOnly() {
  const { profile, signOut } = useAuth()
  return (
    <AuthShell title="Use the ApnaDairy app" subtitle={profile ? roleLabel[profile.role] + ' account' : ''}>
      <p className="text-sm leading-relaxed text-ink">
        Farmer and customer accounts are managed in the ApnaDairy mobile app. This web portal is for admins, area managers and business buyers.
      </p>
      {profile?.role === 'customer' && (
        <Link to="/welcome" className="btn-secondary mt-6 h-auto w-full whitespace-normal py-3 text-center">Register a center or business instead</Link>
      )}
      <button onClick={signOut} className="btn-primary mt-3 w-full">Sign out</button>
    </AuthShell>
  )
}
