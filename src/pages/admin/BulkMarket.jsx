import { useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { milkLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { rs, litres, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import StatCard, { StatRow } from '../../components/StatCard'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'

export default function BulkMarket() {
  const [filter, setFilter] = useState('all')
  const { data, error, loading } = useLoad(async () => {
    const [{ data: reqs, error: e1 }, { data: orders, error: e2 }] = await Promise.all([
      supabase.from('bulk_requirements')
        .select('*, business:business_profiles(business_name), bids(price_per_l, status), order:bulk_orders(total_amount, status, center:area_managers(center_name))')
        .order('created_at', { ascending: false }),
      supabase.from('bulk_orders').select('total_amount, status, quantity_l'),
    ])
    if (e1 || e2) throw e1 || e2
    return { reqs, orders }
  })

  const rows = useMemo(() => (data?.reqs ?? []).filter((r) => filter === 'all' || r.status === filter), [data, filter])
  const live = (data?.orders ?? []).filter((o) => o.status !== 'cancelled')

  return (
    <>
      <PageHeader title="Bulk market" description="Every bulk requirement posted by businesses, the bids it received and the order it became." />
      <Alert>{error}</Alert>

      <StatRow>
        <StatCard label="Taking bids" value={data ? data.reqs.filter((r) => r.status === 'open').length : null} note="open requirements" />
        <StatCard label="Bids placed" value={data ? data.reqs.reduce((n, r) => n + r.bids.length, 0) : null} note="all time" />
        <StatCard label="Orders" value={data ? live.length : null} note={data ? `${litres(live.reduce((n, o) => n + Number(o.quantity_l), 0))} of milk` : null} />
        <StatCard label="Order value" value={data ? rs(live.reduce((n, o) => n + Number(o.total_amount), 0)) : null} note={data ? `${rs((data.orders ?? []).filter((o) => o.status === 'delivered').reduce((n, o) => n + Number(o.total_amount), 0))} delivered` : null} />
      </StatRow>

      <div className="mb-4 mt-10">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All' }, { value: 'open', label: 'Taking bids' }, { value: 'awarded', label: 'Awarded' }, { value: 'cancelled', label: 'Cancelled' },
        ]} />
      </div>

      <div className="panel overflow-x-auto">
        <table className="table min-w-[900px]">
          <thead><tr><th>Business</th><th>Requirement</th><th>Needed on</th><th className="text-right">Bids</th><th className="text-right">Lowest bid</th><th>Outcome</th></tr></thead>
          <tbody>
            {loading && <tr><td colSpan={6} className="text-center text-muted">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6}><EmptyState title="No requirements here">Businesses haven't posted any matching requirements yet.</EmptyState></td></tr>}
            {rows.map((r) => {
              const prices = r.bids.filter((b) => b.status !== 'withdrawn').map((b) => Number(b.price_per_l))
              const order = Array.isArray(r.order) ? r.order[0] : r.order
              return (
                <tr key={r.id}>
                  <td className="font-semibold">{r.business?.business_name}</td>
                  <td className="num">{litres(r.quantity_l)} {milkLabel[r.milk_type].toLowerCase()}<p className="text-[13px] text-muted">{r.target_price ? `Target ${rs(r.target_price)}` : 'No target'}</p></td>
                  <td className="num">{date(r.required_date)}<p className="text-[13px] text-muted">{r.delivery_city}</p></td>
                  <td className="num text-right">{prices.length}</td>
                  <td className="num text-right">{prices.length ? rs(Math.min(...prices)) : '—'}</td>
                  <td>
                    {order ? (
                      <p className="text-[13px]"><span className="font-semibold">{order.center?.center_name}</span>, {rs(order.total_amount)}<br /><span className="text-muted">Order {order.status === 'dispatched' ? 'on the way' : order.status}</span></p>
                    ) : <Badge status={r.status}>{r.status === 'open' ? 'Taking bids' : undefined}</Badge>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
