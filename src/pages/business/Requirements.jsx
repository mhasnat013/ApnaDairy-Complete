import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ProductImage from '../../components/ProductImage'
import { myRequirements, qualityLabel, coveredL, isExpired, reqTitle, qtyText, isMilk, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { rs, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import { SkeletonRows } from '../../components/Skeleton'

const filters = [
  { value: 'open', label: 'Receiving bids' },
  { value: 'awarded', label: 'Ordered' },
  { value: 'cancelled', label: 'Closed' },
  { value: 'all', label: 'All' },
]

export default function Requirements() {
  const nav = useNavigate()
  const { data, error, loading } = useLoad(myRequirements)
  const [filter, setFilter] = useState('open')

  // ordered = covered, or stopped after some litres were ordered; closed = cancelled or the date passed
  const group = (r) => (isExpired(r) ? (coveredL(r) > 0 ? 'awarded' : 'cancelled') : r.status === 'closed' ? 'awarded' : r.status)
  const rows = useMemo(() => (data ?? []).filter((r) => filter === 'all' || group(r) === filter), [data, filter])
  const count = (s) => (data ?? []).filter((r) => s === 'all' || group(r) === s).length

  return (
    <>
      <PageHeader title="My requirements" description="Post what you need and when. Verified sellers send you their price, and you pick one or more.">
        <Link to="/business/requirements/new" className="btn-primary">Post a requirement</Link>
      </PageHeader>

      <div className="mb-4">
        <Segmented value={filter} onChange={setFilter} options={filters.map((f) => ({ ...f, count: data ? count(f.value) : null }))} />
      </div>
      <Alert>{error}</Alert>

      <div className="panel overflow-x-auto">
        <table className="table min-w-[820px]">
          <thead>
            <tr><th>Requirement</th><th>Delivery</th><th className="text-right">Target</th><th className="text-right">Bids</th><th>Bidding closes</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={6} />}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6}>
                <EmptyState title={filter === 'open' ? 'No requirements are taking bids' : 'Nothing here yet'}
                  action={<Link to="/business/requirements/new" className="btn-secondary btn-sm">Post a requirement</Link>}>
                  Tell centers the quantity, date and quality you need.
                </EmptyState>
              </td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/business/requirements/${r.id}`)}>
                <td><div className="flex items-center gap-3">
                  <ProductImage category={r.product ?? 'milk'} size={40} />
                  <div className="min-w-0">
                  <Link to={`/business/requirements/${r.id}`} className="font-semibold text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
                    {reqTitle(r)}
                  </Link>
                  <p className="text-[13px] text-muted">{isMilk(r) ? qualityLabel[r.quality] : productLabel[r.product]}{coveredL(r) > 0 ? ` · ${qtyText(coveredL(r), r.unit)} ordered` : ''}</p>
                  </div>
                </div></td>
                <td className="num">{date(r.required_date)}<p className="text-[13px] text-muted">{r.delivery_city}</p></td>
                <td className="num text-right">{r.target_price ? rs(r.target_price) : <span className="text-muted">Open</span>}</td>
                <td className="text-right"><span className={`num inline-grid h-7 min-w-7 place-items-center rounded-full px-2 text-[13px] font-semibold ${r.bid_count ? 'bg-haldi-soft text-amber' : 'bg-cream-2 text-muted'}`}>{r.bid_count}</span></td>
                <td className="text-muted">{r.status === 'open' && !isExpired(r) ? (new Date(r.bid_deadline) > new Date() ? relative(r.bid_deadline) : 'Closed, choose a bid') : '—'}</td>
                <td>{r.removed_at ? <Badge tone="red">Removed</Badge> : isExpired(r) ? <Badge tone="grey">Date passed</Badge>
                  : <Badge status={r.status}>{r.status === 'open' ? (coveredL(r) > 0 ? 'Part ordered' : 'Receiving bids') : r.status === 'awarded' ? 'Covered' : r.status === 'closed' ? 'Stopped' : undefined}</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
