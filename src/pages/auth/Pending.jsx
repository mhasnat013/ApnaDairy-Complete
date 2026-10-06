import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { homeFor, roleLabel } from '../../lib/roles'
import AuthShell from '../../components/AuthShell'
import Loader from '../../components/Loader'
import Badge from '../../components/Badge'
import DocumentUpload from '../../components/DocumentUpload'
import ProfileProblem from '../../components/ProfileProblem'

const copy = {
  pending: ['Under review', 'Your account is waiting for approval by the ApnaDairy admin. You will get access as soon as it is verified.'],
  rejected: ['Application not approved', 'Your application was not approved.'],
  suspended: ['Account suspended', 'Your account is currently suspended. Please contact ApnaDairy support.'],
}

export default function Pending() {
  const { session, profile, loading, signOut, refreshProfile } = useAuth()
  const [reason, setReason] = useState(null)
  const table = profile?.role === 'business' ? 'business_profiles' : 'area_managers'
  useEffect(() => {
    if (profile?.status !== 'rejected' || !['area_manager', 'business'].includes(profile.role)) return
    supabase.from(table).select('rejection_reason').eq('user_id', profile.id).maybeSingle()
      .then(({ data }) => setReason(data?.rejection_reason ?? null))
  }, [profile, table])
  if (loading) return <Loader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <ProfileProblem />
  if (profile.status === 'active') return <Navigate to={homeFor(profile.role)} replace />

  const [title, body] = copy[profile.status] ?? copy.pending
  return (
    <AuthShell title={title} subtitle={`${profile.full_name}, ${roleLabel[profile.role].toLowerCase()} account`}>
      <div className="panel p-5">
        <Badge status={profile.status} />
        <p className="mt-3 text-[15px] leading-relaxed text-ink">{body}</p>
        {profile.status === 'rejected' && (
          <p className="mt-3 rounded-2xl bg-cream px-4 py-3 text-[14px] text-ink"><span className="font-semibold">Reason: </span>{reason || 'No reason was given.'} Contact ApnaDairy support if you think this is a mistake.</p>
        )}
      </div>
      {profile.status === 'pending' && ['area_manager', 'business'].includes(profile.role) && (
        <div className="mt-4"><DocumentUpload profile={profile} /></div>
      )}
      <div className="mt-6 grid grid-cols-2 gap-3">
        <button onClick={refreshProfile} className="btn-primary">Check status</button>
        <button onClick={signOut} className="btn-secondary">Sign out</button>
      </div>
    </AuthShell>
  )
}
