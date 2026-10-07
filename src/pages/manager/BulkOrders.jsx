import { Link } from 'react-router-dom'
import { useState } from 'react'
import { centerOrders, updateBulkOrder, myDispatchStock, milkLabel, qualityLabel, qtyText, perUnit, isMilk, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { myCenter, gradeLabel, dateTimeShort } from '../../lib/center'
import ProductImage from '../../components/ProductImage'
import DeliverySheet from '../../components/DeliverySheet'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { rs, date, cap } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import OrderProgress from '../../components/OrderProgress'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import Sheet from '../../components/Sheet'
import Icon from '../../components/Icon'

const next = { confirmed: ['dispatched', 'Mark dispatched'], dispatched: ['delivered', 'Mark delivered'] }

export default function BulkOrders() {
  const { data, error, loading, reload } = useLoad(centerOrders)
  const [busy, setBusy] = useState(null)
  const [delivering, setDelivering] = useState(null)
  const [testing, setTesting] = useState(null)
  const { toast, confirm } = useUi()
  const { profile } = useAuth()
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const done = { dispatched: 'Dispatched. It left your stock and the buyer can see it is on the way.', delivered: 'Marked as delivered.', cancelled: 'Order cancelled.' }

  const move = async (o, status) => {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel this order?', body: `${qtyText(o.quantity_l, o.requirement?.unit)} for ${o.buyer?.business_name}. The buyer will see it as cancelled.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
      if (!ok) return
    }
    // milk goes out of tested stock; products just leave stock
    if (status === 'dispatched' && isMilk(o.requirement)) return setTesting(o)
    if (status === 'dispatched') {
      const ok = await confirm({ title: `Dispatch ${qtyText(o.quantity_l, o.requirement?.unit)}?`, body: 'This takes it out of your product stock now, oldest stock first.', confirmLabel: 'Dispatch' })
      if (!ok) return
    }
    if (status === 'delivered') return setDelivering(o)
    setBusy(o.id)
    try { await updateBulkOrder(o.id, status); await reload(); toast(done[status]) } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Bulk orders" description={center?.type === 'byproduct' ? 'Bids you won. Dispatch each order when it leaves, and the buyer’s 4-digit code confirms delivery.' : 'Bids you won. Milk goes out of your tested stock at the grade you offered, and the buyer’s 4-digit code confirms delivery.'} />
      {testing && <DispatchFromStock order={testing} onClose={() => setTesting(null)} onDone={() => { toast('Dispatched from your tested stock. The buyer can see its grade and test time.'); reload() }} />}
      <DeliverySheet key={delivering?.id ?? 'closed'} order={delivering} kind="bulk" demo={center?.is_demo}
        title={delivering ? `Deliver to ${delivering.buyer?.business_name}` : ''} subtitle={delivering ? `${qtyText(delivering.quantity_l, delivering.requirement?.unit)} · ${rs(delivering.total_amount)}` : ''}
        submit={(code) => updateBulkOrder(delivering.id, 'delivered', code)}
        onClose={() => setDelivering(null)} onDone={() => { toast('Delivered. It now counts in your sales.'); reload() }} />
      <Alert>{error}</Alert>
      <div className="panel overflow-x-auto">
        <table className="table min-w-[920px]">
          <thead>
            <tr><th>Buyer</th><th>Order</th><th className="text-right">Total</th><th>Deliver to</th><th>Progress</th><th className="text-right">Next step</th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={6} />}
            {!loading && data?.length === 0 && (
              <tr><td colSpan={6}><EmptyState title="No bulk orders yet">When a business accepts one of your bids, the order appears here.</EmptyState></td></tr>
            )}
            {data?.map((o) => (
              <tr key={o.id}>
                <td><p className="font-semibold">{o.buyer?.business_name}</p><p className="text-[13px] text-muted">{cap(o.buyer?.business_type)}</p></td>
                <td className="num"><div className="flex items-center gap-3"><ProductImage category={o.requirement?.product ?? 'milk'} size={36} /><div>{qtyText(o.quantity_l, o.requirement?.unit)} at {rs(o.price_per_l)}/{perUnit(o.requirement?.unit)}<p className="text-[13px] text-muted">{isMilk(o.requirement) ? `${milkLabel[o.requirement?.milk_type]}, ${qualityLabel[o.quality ?? o.requirement?.quality]?.toLowerCase()}${o.quality && o.requirement?.quality && o.quality !== o.requirement.quality ? ` (asked ${qualityLabel[o.requirement.quality].toLowerCase()})` : ''}` : productLabel[o.requirement?.product]}</p></div></div></td>
                <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
                <td className="num">{date(o.delivery_date)}<p className="text-[13px] text-muted">{o.delivery_address ? `${o.delivery_address}, ` : ''}{o.delivery_city}</p></td>
                <td><OrderProgress order={o} /></td>
                <td>
                  <div className={`flex justify-end gap-2 ${busy === o.id ? 'pointer-events-none opacity-50' : ''}`}>
                    {next[o.status] && <button className="btn-primary btn-sm" onClick={() => move(o, next[o.status][0])}>{next[o.status][1]}</button>}
                    {o.status === 'confirmed' && <button className="btn-danger btn-sm" onClick={() => move(o, 'cancelled')}>Cancel</button>}
                    {o.status === 'delivered' && (o.review
                      ? <span className="text-right text-[13px]" title={o.review.comment ?? ''}><span className="text-haldi">{'★'.repeat(o.review.rating)}</span><span className="text-line">{'★'.repeat(5 - o.review.rating)}</span>{o.review.comment && <p className="max-w-[200px] truncate text-[12px] text-muted">“{o.review.comment}”</p>}</span>
                      : <span className="text-[12.5px] text-muted">Not rated yet</span>)}
                  </div>
                  <Link to={`/manager/support?new=1&order=${o.id}`} className="mt-1.5 block text-right text-[12.5px] text-muted hover:text-forest hover:underline">Report a problem</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// bulk milk goes out of the center's tested stock: no new test, the order keeps what that stock was
function DispatchFromStock({ order, onClose, onDone }) {
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const { data: st, error } = useLoad(() => myDispatchStock(order.id), [order.id])
  const grade = order.quality ?? order.requirement?.quality ?? 'standard'
  const have = Number(st?.litres ?? 0)
  const ok = st && have >= Number(order.quantity_l)
  const send = async () => {
    setBusy(true); setFail('')
    try { await updateBulkOrder(order.id, 'dispatched'); onDone(); onClose() } catch (e) { setFail(e.message) }
    setBusy(false)
  }
  return (
    <Sheet open onClose={onClose} title={`Dispatch ${qtyText(order.quantity_l, 'litre')}`}
      subtitle={`For ${order.buyer?.business_name}. You offered ${gradeLabel[grade].toLowerCase()} milk, so it goes out of your tested stock of that grade or better. No new test is needed.`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={!ok || busy} onClick={send}>{busy ? 'Dispatching…' : 'Dispatch'}</button></>}>
      <Alert>{error || fail}</Alert>
      {!st && !error ? <div className="skeleton h-40 rounded-2xl" /> : st && (
        <div className="grid gap-3">
          <dl className="grid grid-cols-2 gap-2">
            {[['Needed', qtyText(order.quantity_l, 'litre')], [`${gradeLabel[grade]} or better in stock`, qtyText(Math.floor(have * 10) / 10, 'litre')],
              ['Grade of that stock', st.quality ? `${gradeLabel[st.quality]}${st.quality !== grade ? ' (better)' : ''}` : '—'], ['Freshness', st.freshness_score != null ? `${st.freshness_score}/100` : '—'],
              ['Tested', st.tested_from ? `${dateTimeShort(st.tested_from)}${st.tested_to && st.tested_to !== st.tested_from ? ` to ${dateTimeShort(st.tested_to)}` : ''}` : '—'],
              ['Good until', st.good_until ? dateTimeShort(st.good_until) : '—']].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-cream px-3 py-2.5"><dt className="text-[12px] text-muted">{k}</dt><dd className="num font-semibold">{v}</dd></div>
            ))}
          </dl>
          {ok ? <p className="rounded-2xl bg-mint-soft px-4 py-3 text-[13.5px] text-forest">The buyer sees this stock's grade, test time and freshness with the order.</p>
            : <p className="rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[13.5px] text-danger"><b>Not enough {gradeLabel[grade].toLowerCase()} milk in stock.</b> Buy and test more milk from your farmers, or cancel the order.</p>}
        </div>
      )}
    </Sheet>
  )
}
