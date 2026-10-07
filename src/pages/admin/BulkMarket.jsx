import { useMemo, useState } from 'react'
import { adminBulkMarket, adminRemoveRequirement, adminRemoveBid, reqTitle, perUnit, isMilk, qtyText, qualityLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { rs, litres, date, dateTime } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import StatCard, { StatRow } from '../../components/StatCard'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import ProductImage from '../../components/ProductImage'
import Sheet from '../../components/Sheet'

const GRADE_RANK = { standard: 0, fresh: 1, premium: 2 }
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
// a removed request is cancelled underneath; show it as removed
const reqState = (r) => (r.removed_at ? 'removed' : r.status)
const reqBadge = {
  open: ['green', 'Taking bids'], awarded: ['green', 'Covered'], closed: ['grey', 'Stopped'], cancelled: ['grey', 'Cancelled'], removed: ['red', 'Removed'],
}
const bidBadge = {
  submitted: ['blue', 'Waiting for buyer'], accepted: ['green', 'Accepted'], not_selected: ['grey', 'Not selected'], withdrawn: ['grey', 'Withdrawn'], removed: ['red', 'Removed'],
}

export default function BulkMarket() {
  const { toast } = useUi()
  const [filter, setFilter] = useState('all')
  const [removing, setRemoving] = useState(null)   // { kind: 'request' | 'bid', req, bid? }
  const { data, error, loading, reload } = useLoad(adminBulkMarket)

  const reqs = useMemo(() => data ?? [], [data])
  const rows = useMemo(() => reqs.filter((r) => filter === 'all' || reqState(r) === filter), [reqs, filter])
  const orders = reqs.flatMap((r) => r.orders.map((o) => ({ ...o, product: r.product })))
  const live = orders.filter((o) => o.status !== 'cancelled')
  const count = (s) => reqs.filter((r) => reqState(r) === s).length

  const remove = async (reason) => {
    const { kind, req, bid } = removing
    if (kind === 'request') await adminRemoveRequirement(req.id, reason)
    else await adminRemoveBid(bid.id, reason)
    toast(kind === 'request' ? `Request removed. ${req.business_name} and the bidders were told.` : `Bid removed. ${bid.center_name} was told why.`)
    setRemoving(null)
    reload()
  }

  return (
    <>
      <PageHeader title="Bulk market" description="Every bulk request from businesses, the bids it received and the orders it became. Remove a request or a bid that breaks the rules; the people affected are told why." />
      <Alert>{error}</Alert>

      <StatRow>
        <StatCard label="Taking bids" value={data ? count('open') : null} note="open requests" />
        <StatCard label="Bids placed" value={data ? reqs.reduce((n, r) => n + r.bids.length, 0) : null} note="all time" />
        <StatCard label="Orders" value={data ? live.length : null} note={data ? `${litres(live.filter((o) => o.product === 'milk').reduce((n, o) => n + Number(o.quantity_l), 0))} of milk, ${live.filter((o) => o.product !== 'milk').length} product orders` : null} />
        <StatCard label="Order value" value={data ? rs(live.reduce((n, o) => n + Number(o.total_amount), 0)) : null} note={data ? `${rs(orders.filter((o) => o.status === 'delivered').reduce((n, o) => n + Number(o.total_amount), 0))} delivered` : null} />
      </StatRow>

      <div className="mb-4 mt-10">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All' }, { value: 'open', label: 'Taking bids', count: data ? count('open') : null }, { value: 'awarded', label: 'Covered' },
          { value: 'cancelled', label: 'Cancelled' }, { value: 'removed', label: 'Removed', count: data ? count('removed') || null : null },
        ]} />
      </div>

      {loading && <div className="panel p-6 text-center text-muted">Loading…</div>}
      {!loading && rows.length === 0 && <div className="panel"><EmptyState title="No requests here">Businesses haven't posted any matching requests yet.</EmptyState></div>}
      <div className="grid gap-4">
        {rows.map((r) => <RequestCard key={r.id} r={r} onRemove={(bid) => setRemoving(bid ? { kind: 'bid', req: r, bid } : { kind: 'request', req: r })} />)}
      </div>

      {removing && <RemoveSheet {...removing} onClose={() => setRemoving(null)} onConfirm={remove} />}
    </>
  )
}

function RequestCard({ r, onRemove }) {
  const state = reqState(r)
  const [tone, label] = reqBadge[state] ?? ['grey', cap(state)]
  const milk = isMilk(r)
  const activeOrders = r.orders.filter((o) => ['confirmed', 'dispatched'].includes(o.status))
  const facts = [
    ['Quantity', qtyText(r.quantity_l, r.unit)],
    milk && ['Quality asked', qualityLabel[r.quality]],
    ['Needed on', date(r.required_date)],
    ['Deliver to', r.delivery_city],
    ['Target', r.target_price ? `${rs(r.target_price)} / ${perUnit(r.unit)}` : 'None'],
    ['Bids close', dateTime(r.bid_deadline)],
    Number(r.covered_l) > 0 && ['Ordered', qtyText(r.covered_l, r.unit)],
  ].filter(Boolean)
  return (
    <article className={`panel p-5 sm:p-6 ${state === 'removed' ? 'opacity-90' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <ProductImage category={r.product ?? 'milk'} size={44} />
          <div className="min-w-0">
            <p className="num font-semibold text-ink">{reqTitle(r)}</p>
            <p className="text-[13px] text-muted">{r.business_name}{r.business_type ? ` (${cap(r.business_type)})` : ''}{r.business_city ? `, ${r.business_city}` : ''} · posted {date(r.created_at)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          {state !== 'removed' && (
            <button className="btn-ghost btn-sm text-danger" onClick={() => onRemove(null)} disabled={activeOrders.length > 0}
              title={activeOrders.length ? 'It has orders in progress. They must be delivered or cancelled first.' : 'Remove this request'}>Remove request</button>
          )}
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {facts.map(([k, v]) => <div key={k} className="rounded-xl bg-cream px-3 py-2"><dt className="text-[11.5px] text-muted">{k}</dt><dd className="num text-[13.5px] font-semibold">{v}</dd></div>)}
      </dl>

      {r.removed_at && (
        <p className="mt-3 rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[13px] text-danger">
          <b>Removed {dateTime(r.removed_at)}{r.removed_by_name ? ` by ${r.removed_by_name}` : ''}.</b> Reason: {r.removed_reason}
        </p>
      )}
      {r.notes && <p className="mt-3 text-[13px] text-muted">Note from the buyer: “{r.notes}”</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="table min-w-[760px]">
          <thead><tr><th>Bidding {milk ? 'center' : 'seller'}</th>{milk && <th>Grade offered</th>}<th className="text-right">Quantity</th><th className="text-right">Price</th><th>Delivers</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {r.bids.length === 0 && <tr><td colSpan={7} className="py-5 text-center text-[13px] text-muted">No bids yet.</td></tr>}
            {r.bids.map((b) => {
              const bState = b.removed_at ? 'removed' : b.status
              const [bt, bl] = bidBadge[bState] ?? ['grey', cap(bState)]
              const lower = milk && b.offered_quality && GRADE_RANK[b.offered_quality] < GRADE_RANK[r.quality]
              return (
                <tr key={b.id}>
                  <td><p className="font-semibold">{b.center_name}</p><p className="text-[12.5px] text-muted">{b.center_city}</p></td>
                  {milk && <td>
                    <span className={`rounded-full px-2.5 py-0.5 text-[12.5px] font-bold ${lower ? 'bg-haldi-soft text-amber' : 'bg-mint-soft text-forest'}`}>{qualityLabel[b.offered_quality] ?? '—'}</span>
                    {lower && <p className="mt-1 text-[12px] font-semibold text-amber">Lower than {qualityLabel[r.quality].toLowerCase()}</p>}
                  </td>}
                  <td className="num text-right">{qtyText(b.quantity_l, r.unit)}</td>
                  <td className="num text-right font-semibold">{rs(b.price_per_l)}<span className="text-[12px] font-normal text-muted"> / {perUnit(r.unit)}</span></td>
                  <td className="num">{date(b.delivery_date)}</td>
                  <td><Badge tone={bt}>{bl}</Badge>
                    {b.removed_at && <p className="mt-1 max-w-[260px] text-[12px] text-muted">{b.removed_reason}{b.removed_by_name ? ` (${b.removed_by_name}, ${date(b.removed_at)})` : ''}</p>}</td>
                  <td className="text-right">{b.status === 'submitted' && !b.removed_at && <button className="btn-ghost btn-sm text-danger" onClick={() => onRemove(b)}>Remove</button>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {r.orders.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {r.orders.map((o) => (
            <span key={o.id} className="rounded-full bg-cream px-3 py-1 text-[12.5px]">
              Order: <b>{o.center_name}</b>, {qtyText(o.quantity_l, r.unit)}{milk && o.quality ? ` ${o.quality}` : ''}, {rs(o.total_amount)} · {o.status === 'dispatched' ? 'on the way' : o.status}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}

// the reason is required and goes to the people affected
function RemoveSheet({ kind, req, bid, onClose, onConfirm }) {
  const { toast } = useUi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = reason.trim().length >= 10
  const go = async () => {
    if (!ok) return
    setBusy(true)
    try { await onConfirm(reason.trim()) } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const what = kind === 'request'
    ? `${req.business_name}'s request for ${reqTitle(req)}`
    : `${bid.center_name}'s bid of ${rs(bid.price_per_l)} / ${perUnit(req.unit)} for ${qtyText(bid.quantity_l, req.unit)}`
  return (
    <Sheet open onClose={onClose} title={kind === 'request' ? 'Remove this request?' : 'Remove this bid?'} subtitle={what}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-danger" disabled={!ok || busy} onClick={go}>{busy ? 'Removing…' : kind === 'request' ? 'Remove request' : 'Remove bid'}</button></>}>
      <p className="rounded-2xl bg-cream px-4 py-3 text-[13px] text-muted">
        {kind === 'request'
          ? `Nothing is deleted. The request is closed and marked removed, its open bids close, and ${req.business_name} gets your reason by email and in the portal. The centers that bid are told it was removed.`
          : `Nothing is deleted. The bid is marked removed and ${bid.center_name} gets your reason by email and in the portal. They cannot bid on this request again. ${req.business_name} is told an offer was removed.`}
      </p>
      <div className="field mt-4">
        <label htmlFor="rr">Reason <span className="font-normal text-muted">(they see this)</span></label>
        <textarea id="rr" rows={3} maxLength={300} className="input" value={reason} onChange={(e) => setReason(e.target.value)}
          placeholder={kind === 'request' ? 'e.g. Posted twice by mistake. The other request stays open.' : 'e.g. The price is far below cost and looks like a mistake.'} />
        <p className={`mt-1 text-[12.5px] ${ok ? 'text-muted' : 'text-danger'}`}>Required, at least 10 characters.</p>
      </div>
    </Sheet>
  )
}
