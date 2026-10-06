import { useState } from 'react'
import { businessOrders, updateBulkOrder, myDeliveryCodes, rateOrder, milkLabel, qtyText, perUnit, isMilk, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { rs, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import OrderProgress from '../../components/OrderProgress'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import Sheet from '../../components/Sheet'
import { gradeLabel } from '../../lib/center'

export default function BusinessOrders() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [orders, codes] = await Promise.all([businessOrders(), myDeliveryCodes().catch(() => [])])
    const byOrder = Object.fromEntries(codes.map((c) => [c.order_id, c.code]))
    return orders.map((o) => ({ ...o, code: byOrder[o.id] }))
  })
  const { toast, confirm } = useUi()
  const [rating, setRating] = useState(null)

  const cancel = async (o) => {
    const ok = await confirm({ title: 'Cancel this order?', body: `${qtyText(o.quantity_l, o.requirement?.unit)} from ${o.center?.center_name}. They haven't dispatched it yet.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
    if (!ok) return
    try { await updateBulkOrder(o.id, 'cancelled'); await reload(); toast('Order cancelled.') } catch (e) { toast(e.message, 'error') }
  }
  const received = async (o) => {
    const ok = await confirm({ title: 'Did the order arrive?', body: `${qtyText(o.quantity_l, o.requirement?.unit)} from ${o.center?.center_name}. Confirm only once you have it.`, confirmLabel: 'Yes, received' })
    if (!ok) return
    try { await updateBulkOrder(o.id, 'delivered'); await reload(); toast('Marked as received. Thank you.') } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Bulk orders" description="Bids you accepted. Give the delivery code to the driver when the milk arrives. You pay the center directly; ApnaDairy takes no cut." />
      <Alert>{error}</Alert>
      <div className="panel overflow-x-auto">
        <table className="table min-w-[980px]">
          <thead>
            <tr><th>Supplier</th><th>Order</th><th className="text-right">Price</th><th className="text-right">Total</th><th>Delivery</th><th>Progress</th><th>Delivery code</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={8} />}
            {!loading && data?.length === 0 && (
              <tr><td colSpan={8}><EmptyState title="No bulk orders yet">When you accept a bid on one of your requirements, the order shows up here.</EmptyState></td></tr>
            )}
            {data?.map((o) => (
              <tr key={o.id}>
                <td><p className="font-semibold">{o.center?.center_name}</p><p className="text-[13px] text-muted">{o.center?.city}</p></td>
                <td className="num">{qtyText(o.quantity_l, o.requirement?.unit)}<p className="text-[13px] text-muted">{isMilk(o.requirement) ? milkLabel[o.requirement?.milk_type] : productLabel[o.requirement?.product]}</p></td>
                <td className="num text-right">{rs(o.price_per_l)}<span className="text-[12px] text-muted"> / {perUnit(o.requirement?.unit)}</span></td>
                <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
                <td className="num">{date(o.delivery_date)}<p className="text-[13px] text-muted">{o.delivery_city}</p></td>
                <td><OrderProgress order={o} />{o.dispatch_quality && (
                  <p className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-mint-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-forest" title={`Tested on device ${o.dispatch_quality.device} before dispatch: ${o.dispatch_quality.temperature_c} °C, pH ${o.dispatch_quality.ph}, TDS ${Math.round(o.dispatch_quality.tds_ppm)}`}>
                    Tested before dispatch: {gradeLabel[o.dispatch_quality.quality] ?? o.dispatch_quality.quality}, pH {Number(o.dispatch_quality.ph)}, {Number(o.dispatch_quality.temperature_c)} °C
                  </p>)}</td>
                <td>{o.code && ['confirmed', 'dispatched'].includes(o.status)
                  ? <span className="num rounded-xl bg-haldi-soft px-3 py-1.5 text-[17px] font-bold tracking-[0.25em] text-forest-deep" title="Give this code to the driver when the milk arrives">{o.code}</span>
                  : <span className="text-[13px] text-muted">{o.status === 'delivered' ? 'Used' : '—'}</span>}</td>
                <td className="text-right">
                  {o.status === 'confirmed' && <button className="btn-danger btn-sm" onClick={() => cancel(o)}>Cancel</button>}
                  {o.status === 'dispatched' && <button className="btn-primary btn-sm" onClick={() => received(o)}>Received</button>}
                  {o.status === 'delivered' && (o.review
                    ? <button className="text-[13.5px] font-semibold text-forest hover:underline" onClick={() => setRating(o)} title="Change your rating"><span className="text-haldi">{'★'.repeat(o.review.rating)}</span><span className="text-line">{'★'.repeat(5 - o.review.rating)}</span></button>
                    : <button className="btn-secondary btn-sm" onClick={() => setRating(o)}>Rate</button>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <RateSheet key={rating?.id ?? 'closed'} order={rating} onClose={() => setRating(null)} onSaved={reload} />
    </>
  )
}

// after delivery the business rates the center; other businesses see it next to that center's bids
function RateSheet({ order, onClose, onSaved }) {
  const { toast } = useUi()
  const [stars, setStars] = useState(order?.review?.rating ?? 0)
  const [comment, setComment] = useState(order?.review?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const words = ['', 'Poor', 'Below what was promised', 'Okay', 'Good', 'Excellent']
  const save = async () => {
    setBusy(true)
    try { await rateOrder(order.id, stars, comment); toast('Thank you. Your rating helps other businesses choose.'); onSaved(); onClose() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <Sheet open={!!order} onClose={onClose} title={`Rate ${order?.center?.center_name ?? 'the center'}`}
      subtitle={order ? `${qtyText(order.quantity_l, order.requirement?.unit)} delivered for ${rs(order.total_amount)}. Was it as promised and on time?` : ''}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!stars || busy} onClick={save}>{busy ? 'Saving…' : 'Save rating'}</button></>}>
      <div className="flex gap-1" role="radiogroup" aria-label="Stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`} onClick={() => setStars(n)}
            className={`text-[40px] leading-none transition-transform active:scale-90 ${n <= stars ? 'text-haldi' : 'text-line hover:text-haldi/50'}`}>★</button>
        ))}
      </div>
      <p className="mt-2 h-5 text-[14px] font-semibold text-forest">{words[stars]}</p>
      <div className="field mt-4">
        <label htmlFor="rc">Comment <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="rc" rows={3} maxLength={300} className="input" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Milk arrived chilled and on time…" />
      </div>
    </Sheet>
  )
}
