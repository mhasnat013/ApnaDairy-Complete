import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import ProductImage from '../../components/ProductImage'
import { requirementWithBids, rankBids, bidIssues, gradeRule, acceptBid, cancelRequirement, qualityLabel, coveredL, stillNeeded, isExpired, reqTitle, qtyText, perUnit, isMilk, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { rs, date, dateTime, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import PriceLadder from '../../components/PriceLadder'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import Loader from '../../components/Loader'

// what the business can check before trusting a center
function TrackRecord({ r }) {
  if (!r) return null
  const bits = [
    r.tests_30d > 0 && `${r.pass_pct ?? 0}% of ${r.tests_30d} milk tests passed`,
    r.premium_pct != null && r.tests_30d > 0 && `${r.premium_pct}% premium`,
    Number(r.orders_delivered) > 0 ? `${r.orders_delivered} bulk ${Number(r.orders_delivered) === 1 ? 'order' : 'orders'}, ${r.on_time_pct ?? 0}% on time` : 'First bulk order',
    Number(r.cancelled_by_center) > 0 && `cancelled ${r.cancelled_by_center} ${Number(r.cancelled_by_center) === 1 ? 'order' : 'orders'}`,
  ].filter(Boolean)
  return (
    <div className="mt-3 rounded-xl bg-cream px-3 py-2.5 text-[12.5px] text-muted">
      <p className="flex items-center gap-1.5 font-semibold text-ink">
        {Number(r.ratings) > 0 ? <><span className="text-haldi">★</span>{Number(r.rating).toFixed(1)} <span className="font-normal text-muted">from {r.ratings} {Number(r.ratings) === 1 ? 'business' : 'businesses'}</span></> : 'No ratings yet'}
      </p>
      <p className="mt-0.5">{bits.join(' · ')}</p>
    </div>
  )
}

function BidCard({ b, req, rank, canAccept, onAccept, busy, highlight }) {
  const Q = (n) => qtyText(n, req.unit)
  const take = Math.min(Number(b.quantity_l), stillNeeded(req))
  const diff = req.target_price ? Number(b.price_per_l) - Number(req.target_price) : null
  const issues = bidIssues(b, req)
  return (
    <article id={`bid-${b.id}`} className={`panel relative animate-rise p-5 transition-shadow ${highlight ? 'ring-2 ring-haldi' : ''}`}>
      {rank === 1 && <span className="absolute -top-3 left-5 rounded-full bg-haldi px-3 py-0.5 text-[12.5px] font-bold text-forest-deep">Best price</span>}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-bold">{b.center?.center_name ?? 'Collection center'}</p>
          <p className="text-[13px] text-muted">{b.center?.city}</p>
        </div>
        {b.status === 'accepted' && <Badge status="accepted" />}
      </div>

      <p className="display num mt-4 text-[34px] text-forest-deep">{rs(b.price_per_l)}<span className="text-[16px] font-medium text-muted"> / {perUnit(req.unit)}</span></p>
      {diff != null && (
        <p className={`text-[13.5px] font-medium ${diff <= 0 ? 'text-forest' : 'text-amber'}`}>
          {diff === 0 ? 'Right on your target' : `${rs(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'} your target`}
        </p>
      )}

      <dl className="mt-4 space-y-1.5 border-t border-line pt-4 text-[14px]">
        <div className="flex justify-between gap-3"><dt className="text-muted">Supplies</dt><dd className="num font-medium">{Q(b.quantity_l)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Arrives</dt><dd className="num font-medium">{date(b.delivery_date)}</dd></div>
        {isMilk(req)
          ? <div className="flex justify-between gap-3"><dt className="text-muted">Quality</dt><dd className="text-right font-medium">{gradeRule(req.quality)}, tested at dispatch</dd></div>
          : <div className="flex justify-between gap-3"><dt className="text-muted">Ready</dt><dd className="font-medium">{Number(b.make_qty) > 0 ? `${Q(b.quantity_l - b.make_qty)} in stock, ${Q(b.make_qty)} to be made` : 'All in stock'}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-muted">Total</dt><dd className="num font-bold">{rs(b.price_per_l * b.quantity_l)}</dd></div>
      </dl>

      <TrackRecord r={b.record} />
      {issues.length > 0 && <p className="mt-3 rounded-xl bg-haldi-soft px-3 py-2 text-[13px] text-amber">{issues.join('. ')}.</p>}
      {b.notes && <p className="mt-3 text-[13.5px] text-muted">“{b.notes}”</p>}

      {canAccept && b.status === 'submitted' && (
        <button className={`${rank ? 'btn-primary' : 'btn-secondary'} mt-5 w-full`} disabled={busy} onClick={() => onAccept(b, take)}>{take < Number(b.quantity_l) ? `Accept ${Q(take)} of this bid` : 'Accept this bid'}</button>
      )}
    </article>
  )
}

export default function RequirementDetail() {
  const { id } = useParams()
  const { toast, confirm } = useUi()
  const { data: req, error, loading, reload } = useLoad(() => requirementWithBids(id), [id])
  const [busy, setBusy] = useState(false)
  const [picked, setPicked] = useState(null)

  if (loading && !req) return <Loader />
  if (error) return <Alert>{error}</Alert>

  const { top, others } = rankBids(req.bids, req)
  const expired = isExpired(req)
  const isOpen = req.status === 'open' && !expired
  const biddingLive = isOpen && new Date(req.bid_deadline) > new Date()
  const accepted = req.bids.filter((b) => b.status === 'accepted')
  const covered = coveredL(req), need = stillNeeded(req)
  const Q = (n) => qtyText(n, req.unit), per = perUnit(req.unit)
  const ladderRows = [...top, ...others].map((b) => ({
    id: b.id, label: b.center?.center_name ?? 'Center', price: b.price_per_l, quantity: b.quantity_l, ok: bidIssues(b, req).length === 0,
  }))

  const pick = (bidId) => {
    setPicked(bidId)
    document.getElementById(`bid-${bidId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const onAccept = async (b, take) => {
    const rest = need - take
    const ok = await confirm({
      title: `Buy from ${b.center?.center_name}?`,
      body: `${Q(take)} at ${rs(b.price_per_l)} per ${per}, ${rs(b.price_per_l * take)} in total, delivered on ${date(b.delivery_date)}. ${rest > 0 ? `You still need ${Q(rest)}, so you can accept more bids after this.` : 'This covers your whole order, so the other bids will be declined.'} You pay the center directly on delivery.`,
      confirmLabel: 'Accept bid',
    })
    if (!ok) return
    setBusy(true)
    try { await acceptBid(b.id); await reload(); toast(`Order placed with ${b.center?.center_name}.`) } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const onCancel = async () => {
    const ok = await confirm(covered > 0
      ? { title: 'Stop taking bids?', body: `You keep the ${Q(covered)} you already ordered. Bids still waiting will be declined.`, confirmLabel: 'Stop taking bids', danger: true, cancelLabel: 'Keep it open' }
      : { title: 'Cancel this requirement?', body: 'Centers can no longer bid, and the bids you have received will be declined.', confirmLabel: 'Cancel requirement', danger: true, cancelLabel: 'Keep it' })
    if (!ok) return
    setBusy(true)
    try { await cancelRequirement(req.id); await reload(); toast('Requirement cancelled.') } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }

  return (
    <>
      <PageHeader back={{ to: '/business/requirements', label: 'My requirements' }}
        title={reqTitle(req)}
        description={`${isMilk(req) ? `${qualityLabel[req.quality]} milk` : productLabel[req.product]} for ${req.delivery_city}, needed on ${date(req.required_date)}.`}>
        {isOpen && <button className="btn-danger" onClick={onCancel} disabled={busy}>{covered > 0 ? 'Stop taking bids' : 'Cancel requirement'}</button>}
      </PageHeader>

      <div className="mb-8 flex flex-wrap items-center gap-2">
        <ProductImage category={req.product ?? 'milk'} size={44} className="mr-1" />
        <Badge status={expired ? 'closed' : req.status} tone={expired ? 'grey' : undefined}>{expired ? 'Date passed' : biddingLive ? 'Taking bids' : isOpen ? 'Bidding closed, pick a bid' : req.status === 'closed' ? 'Stopped' : req.status === 'awarded' ? 'Covered' : undefined}</Badge>
        {isMilk(req) && <span className="rounded-full bg-cream-2 px-3 py-1 text-[13px] font-medium">{qualityLabel[req.quality]}</span>}
        <span className="num rounded-full bg-cream-2 px-3 py-1 text-[13px] font-medium">Target {req.target_price ? `${rs(req.target_price)} / ${per}` : 'best offer'}</span>
        <span className="num rounded-full bg-cream-2 px-3 py-1 text-[13px] font-medium">
          {isOpen ? `Bids close ${relative(req.bid_deadline)}` : `Closed ${dateTime(req.bid_deadline)}`}
        </span>
      </div>

      {(covered > 0 || isOpen) && (
        <div className="panel mb-8 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-semibold"><span className="num">{Q(covered)}</span> of <span className="num">{Q(req.quantity_l)}</span> ordered</p>
            <p className={`text-[13.5px] ${need > 0 ? 'text-muted' : 'font-semibold text-forest'}`}>{need > 0 ? `${Q(need)} still needed${isOpen ? '. You can accept more than one bid.' : ''}` : 'Your whole order is covered'}</p>
          </div>
          <div className="mt-3 h-2.5 rounded-full bg-cream-2"><div className="h-2.5 rounded-full bg-forest-2 transition-all" style={{ width: `${Math.min(100, (covered / Number(req.quantity_l)) * 100)}%` }} /></div>
        </div>
      )}

      {accepted.length > 0 && (
        <div className="mb-8 flex animate-pop flex-wrap items-center justify-between gap-3 rounded-[20px] bg-forest px-6 py-5 text-cream">
          <p className="text-[15.5px]">
            You're buying {accepted.map((a, i) => <span key={a.id}>{i > 0 && (i === accepted.length - 1 ? ' and ' : ', ')}<span className="num">{Q(Number((req.orders ?? []).find((o) => o.bid_id === a.id)?.quantity_l ?? a.quantity_l))}</span> from <strong>{a.center?.center_name}</strong> at <strong className="num text-haldi">{rs(a.price_per_l)}/{per}</strong></span>)}.
          </p>
          <Link to="/business/orders" className="btn-secondary btn-sm">Track the order</Link>
        </div>
      )}

      {ladderRows.length === 0 ? (
        (isOpen || accepted.length === 0) && (
          <div className="panel">
            <EmptyState title={accepted.length ? 'No other bids waiting' : biddingLive ? 'Waiting for the first bid' : 'No bids came in'}>
              {biddingLive ? `Centers can bid until ${dateTime(req.bid_deadline)}. Bids show up here as soon as they're sent.` : accepted.length ? 'Bidding has closed. You can stop taking bids, or post a new requirement for what is still needed.' : 'Try posting again with a later date or a different target price.'}
            </EmptyState>
          </div>
        )
      ) : (
        <div className="space-y-10">
          <PriceLadder rows={ladderRows} unit={req.unit} target={req.target_price} acceptedId={accepted[0]?.id} onPick={pick} />

          {top.length > 0 && (
            <section>
              <h2 className="display text-[26px]">Best matches</h2>
              <p className="mb-5 mt-1 text-muted">Bids that cover what you still need and arrive on time, cheapest first.</p>
              <div className="grid gap-5 pt-2 md:grid-cols-2 xl:grid-cols-3">
                {top.map((b, i) => <BidCard key={b.id} b={b} req={req} rank={i + 1} canAccept={isOpen} onAccept={onAccept} busy={busy} highlight={picked === b.id} />)}
              </div>
            </section>
          )}

          {others.length > 0 && (
            <section>
              <h2 className="display text-[26px]">Other bids</h2>
              <p className="mb-5 mt-1 text-muted">These cover part of your order, arrive late or cost more. You can combine smaller bids to cover what you need.</p>
              <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                {others.map((b) => <BidCard key={b.id} b={b} req={req} canAccept={isOpen} onAccept={onAccept} busy={busy} highlight={picked === b.id} />)}
              </div>
            </section>
          )}
        </div>
      )}

      {req.notes && <p className="mt-10 text-[14.5px] text-muted"><span className="font-semibold text-ink">Your note to centers:</span> {req.notes}</p>}
    </>
  )
}
