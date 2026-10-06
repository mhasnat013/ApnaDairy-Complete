import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { useLoad } from '../../lib/useLoad'
import { rs } from '../../lib/format'
import WelcomeBanner from '../../components/WelcomeBanner'
import Alert from '../../components/Alert'
import StatCard, { StatRow } from '../../components/StatCard'

const count = async (table, filter = {}) => {
  let q = supabase.from(table).select('*', { count: 'exact', head: true })
  Object.entries(filter).forEach(([k, v]) => { q = q.eq(k, v) })
  const { count } = await q
  return count ?? 0
}

export default function AdminHome() {
  const { profile } = useAuth()
  const { data: s, error } = useLoad(async () => {
    const [users, pm, pb, am, bb, open, orders] = await Promise.all([
      count('profiles'),
      count('area_managers', { verification_status: 'pending' }),
      count('business_profiles', { verification_status: 'pending' }),
      count('area_managers', { verification_status: 'active' }),
      count('business_profiles', { verification_status: 'active' }),
      count('bulk_requirements', { status: 'open' }),
      supabase.from('bulk_orders').select('total_amount, status').then(({ data }) => data ?? []),
    ])
    // sales count once delivered, the same rule as center dashboards and billing
    const live = orders.filter((o) => o.status === 'delivered')
    return { users, pending: pm + pb, am, bb, open, value: live.reduce((n, o) => n + Number(o.total_amount), 0) }
  })

  return (
    <>
      <WelcomeBanner name={profile.full_name.split(' ')[0]}
        line={s ? (s.pending ? `${s.pending} ${s.pending === 1 ? 'account is' : 'accounts are'} waiting for you.` : 'Everyone is approved. All clear.') : ' '}>
        <Link to="/admin/approvals" className="btn-haldi">Review approvals</Link>
        <Link to="/admin/analytics" className="btn-on-dark">Analytics</Link>
      </WelcomeBanner>
      {error && <div className="mt-4"><Alert>{error}</Alert></div>}
      <StatRow>
        <StatCard label="Waiting for approval" value={s?.pending} note="centers and businesses" tone="haldi" />
        <StatCard label="Verified centers" value={s?.am} note="area managers" />
        <StatCard label="Verified businesses" value={s?.bb} note="bulk buyers" />
        <StatCard label="Registered users" value={s?.users} note="all roles" />
      </StatRow>
      <div className="mt-4">
        <StatRow cols={3}>
          <StatCard label="Bulk requests open" value={s?.open} note="taking bids now" />
          <StatCard label="Bulk sales" value={s?.value} format={(n) => rs(Math.round(n))} note="delivered orders" tone="green" />
        </StatRow>
      </div>
    </>
  )
}
