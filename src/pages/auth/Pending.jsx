import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { homeFor, roleLabel } from '../../lib/roles'
import { mySubmission } from '../../lib/docs'
import { dateTime, rs, date } from '../../lib/format'
import AuthShell from '../../components/AuthShell'
import Loader from '../../components/Loader'
import Badge from '../../components/Badge'
import Icon from '../../components/Icon'
import DocumentUpload from '../../components/DocumentUpload'
import ProfileProblem from '../../components/ProfileProblem'
import { PaySheet } from '../../components/BillPay'
import { myUnpaidBills, paymentLabel, todayKey } from '../../lib/center'

const needsDocs = (role) => ['area_manager', 'business'].includes(role)

export default function Pending() {
  const { session, profile, loading, signOut, refreshProfile } = useAuth()
  const [sub, setSub] = useState(undefined)   // undefined while loading, then { docs_submitted_at, rejection_reason }

  const loadSub = useCallback(() => {
    if (!profile || !needsDocs(profile.role)) return setSub(null)
    mySubmission(profile.role, profile.id).then(setSub).catch(() => setSub(null))
  }, [profile])
  useEffect(() => { loadSub() }, [loadSub])

  if (loading) return <Loader />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <ProfileProblem />
  if (profile.status === 'active') return <Navigate to={homeFor(profile.role)} replace />
  if (sub === undefined) return <Loader />

  const who = `${profile.full_name}, ${roleLabel[profile.role].toLowerCase()} account`
  const actions = (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <Link to="/" className="btn-primary"><Icon name="arrow" size={16} className="rotate-180" />Back to home page</Link>
      <button onClick={signOut} className="btn-secondary">Sign out</button>
    </div>
  )

  if (profile.status === 'rejected' || profile.status === 'suspended') {
    const rejected = profile.status === 'rejected'
    return (
      <AuthShell title={rejected ? 'Application not approved' : 'Account suspended'} subtitle={who}>
        <div className="panel p-5">
          <Badge status={profile.status} />
          <p className="mt-3 text-[15px] leading-relaxed text-ink">{rejected ? 'Your application was not approved.' : 'Your account is suspended, so you cannot use the portal right now.'}</p>
          {sub?.rejection_reason || rejected
            ? <p className="mt-3 rounded-2xl bg-cream px-4 py-3 text-[14px] text-ink"><span className="font-semibold">Reason: </span>{sub?.rejection_reason || 'No reason was given.'} If you think this is a mistake, reply to the email we sent you.</p>
            : null}
        </div>
        {!rejected && profile.role === 'area_manager' && <UnpaidBills />}
        {actions}
      </AuthShell>
    )
  }

  // pending, documents sent: waiting for the admin
  if (!needsDocs(profile.role) || sub?.docs_submitted_at) {
    return (
      <AuthShell title="Approval not done yet" subtitle={who}>
        <div className="panel p-5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-haldi-soft text-amber"><Icon name="clock" size={20} /></span>
            <div>
              <p className="font-semibold text-ink">Your documents are submitted</p>
              {sub?.docs_submitted_at && <p className="text-[13px] text-muted">Sent {dateTime(sub.docs_submitted_at)}</p>}
            </div>
          </div>
          <p className="mt-4 text-[15px] leading-relaxed text-ink">
            The ApnaDairy admin has not approved your account yet. They are checking your details and documents.
            Once approved, your portal opens when you sign in. You can leave this page and come back any time.
          </p>
          <button onClick={() => { refreshProfile(); loadSub() }} className="btn-secondary btn-sm mt-4"><Icon name="clock" size={14} />Check again</button>
        </div>
        {needsDocs(profile.role) && <div className="mt-4"><DocumentUpload profile={profile} submitted /></div>}
        {actions}
      </AuthShell>
    )
  }

  // pending, documents not sent yet
  return (
    <AuthShell title="Upload your documents" subtitle={who}>
      <div className="panel p-5">
        <Badge status="pending" />
        <p className="mt-3 text-[15px] leading-relaxed text-ink">
          ApnaDairy checks every {profile.role === 'business' ? 'business' : 'area manager'} before the portal opens.
          Upload all the required documents below, then press Submit.
        </p>
      </div>
      <div className="mt-4"><DocumentUpload profile={profile} submitted={false} onSubmitted={loadSub} /></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/" className="btn-secondary"><Icon name="arrow" size={16} className="rotate-180" />Back to home page</Link>
        <button onClick={signOut} className="btn-secondary">Sign out</button>
      </div>
    </AuthShell>
  )
}

// a seller suspended over unpaid bills can still pay them; ApnaDairy restores the account once it is paid
function UnpaidBills() {
  const [bills, setBills] = useState(null)
  const [paying, setPaying] = useState(null)
  const load = useCallback(() => { myUnpaidBills().then(setBills).catch(() => setBills([])) }, [])
  useEffect(() => { load() }, [load])
  if (!bills?.length) return null
  const total = bills.reduce((n, i) => n + Number(i.amount), 0)
  return (
    <div className="panel mt-4 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold text-ink">Unpaid bills</p>
        <p className="display num text-[22px]">{rs(total)}</p>
      </div>
      <p className="mt-1 text-[13px] text-muted">Pay them and send the transaction ID. ApnaDairy checks the payment and can then restore your account.</p>
      <ul className="mt-3 grid gap-2">
        {bills.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
            <div className="min-w-0">
              <p className="text-[14px] font-medium">{i.description}</p>
              <p className={`text-[12.5px] ${i.due_date < todayKey() ? 'font-semibold text-danger' : 'text-muted'}`}>{rs(i.amount)}, due {date(i.due_date)}</p>
              {i.submitted_at && <p className="text-[12.5px] text-amber">Payment sent by {paymentLabel[i.payment_method]} ({i.payment_ref}). ApnaDairy is checking it.</p>}
            </div>
            <button className={i.submitted_at ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'} onClick={() => setPaying(i)}>{i.submitted_at ? 'Change' : `Pay ${rs(i.amount)}`}</button>
          </li>
        ))}
      </ul>
      <PaySheet key={paying?.id ?? 'closed'} invoice={paying} onClose={() => setPaying(null)} onPaid={load} />
    </div>
  )
}
