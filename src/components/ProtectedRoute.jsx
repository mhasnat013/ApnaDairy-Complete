import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roles'
import Loader from './Loader'
import ProfileProblem from './ProfileProblem'

// allow = list of roles that may open this section
export default function ProtectedRoute({ allow }) {
  const { session, profile, loading } = useAuth()

  if (loading) return <Loader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <ProfileProblem />
  if (profile.status !== 'active') return <Navigate to="/pending" replace />
  if (allow && !allow.includes(profile.role)) return <Navigate to={homeFor(profile.role)} replace />

  return <Outlet />
}
