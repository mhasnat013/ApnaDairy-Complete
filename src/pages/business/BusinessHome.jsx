import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { myRequirements, businessOrders, milkLabel, isExpired } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { rs, litres, date, relative } from '../../lib/format'
import WelcomeBanner from '../../components/WelcomeBanner'
import StatCard, { StatRow } from '../../components/StatCard'
import Badge from '../../components/Badge'
import EmptyState from '../../components/EmptyState'

export default function BusinessHome() {
  const { profile } = useAuth()
  const { data } = useLoad(async () => {
    const [{ data: biz }, reqs, orders] = await Promise.all([
      supabase.from('business_profiles').select('business_name, business_type, city').eq('user_id', profile.id).single(),
      myRequirements(),
      businessOrders(),
    ])
    return { biz, reqs, orders }
  }, [profile.id])

  const open = data?.reqs.filter((r) => r.status === 'open' && !isExpired(r)) ?? []
  const active = data?.orders.filter((o) => o.status === 'confirmed' || o.status === 'dispatched') ?? []
  const delivered = data?.orders.filter((o) => o.status === 'delivered') ?? []

  return (
    <>
      <WelcomeBanner name={profile.full_name.split(' ')[0]} line={data?.biz ? `${data.biz.business_name}'s milk, sorted.` : ' '}>
        <Link to="/business/requirements/new" className="btn-haldi">Post a requirement</Link>
        <Link to="/business/orders" className="btn-on-dark">Track orders</Link>
      </WelcomeBanner>

      <StatRow>
        <StatCard label="Taking bids" value={data ? open.length : null} note="open requirements" />
        <StatCard label="Bids received" value={data ? open.reduce((n, r) => n + r.bid_count, 0) : null} note="waiting for your pick" tone="haldi" />
        <StatCard label="Orders on the way" value={data ? active.length : null} note="confirmed or dispatched" />
        <StatCard label="Milk received" value={data ? delivered.reduce((n, o) => n + Number(o.quantity_l), 0) : null} format={(n) => `${Math.round(n).toLocaleString('en-PK')} L`}
          note={data ? `${rs(delivered.reduce((n, o) => n + Number(o.total_amount), 0))} spent` : null} tone="green" />
      </StatRow>

      <section className="mt-10">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="display text-[24px]">Taking bids now</h2>
          <Link to="/business/requirements" className="text-sm font-medium text-forest hover:underline">All requirements</Link>
        </div>
        <div className="panel overflow-x-auto">
          {data && open.length === 0 ? (
            <EmptyState title="Nothing is taking bids" action={<Link to="/business/requirements/new" className="btn-secondary btn-sm">Post a requirement</Link>}>
              Post what you need and collection centers will start bidding.
            </EmptyState>
          ) : (
            <table className="table min-w-[640px]">
              <thead><tr><th>Requirement</th><th>Needed on</th><th className="text-right">Bids</th><th>Closes</th><th></th></tr></thead>
              <tbody>
                {open.slice(0, 5).map((r) => (
                  <tr key={r.id}>
                    <td className="font-semibold">{litres(r.quantity_l)} {milkLabel[r.milk_type].toLowerCase()}</td>
                    <td className="num">{date(r.required_date)}</td>
                    <td className="num text-right font-semibold">{r.bid_count}</td>
                    <td className="text-muted">{relative(r.bid_deadline)}</td>
                    <td className="text-right"><Link to={`/business/requirements/${r.id}`} className="btn-secondary btn-sm">{r.bid_count ? 'Compare bids' : 'View'}</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {active.length > 0 && (
        <section className="mt-10">
          <h2 className="display mb-3 text-[24px]">Orders on the way</h2>
          <div className="panel divide-y divide-line overflow-hidden">
            {active.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <p><span className="font-semibold">{litres(o.quantity_l)}</span> from {o.center?.center_name}, due {date(o.delivery_date)}</p>
                <Badge status={o.status}>{o.status === 'dispatched' ? 'On the way' : undefined}</Badge>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
