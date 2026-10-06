import { useState } from 'react'
import { centerOrders, updateBulkOrder, milkLabel, qualityLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { myCenter } from '../../lib/center'
import DeliverySheet from '../../components/DeliverySheet'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { rs, litres, date, cap } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import OrderProgress from '../../components/OrderProgress'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'

const next = { confirmed: ['dispatched', 'Mark dispatched'], dispatched: ['delivered', 'Mark delivered'] }

export default function BulkOrders() {
  const { data, error, loading, reload } = useLoad(centerOrders)
  const [busy, setBusy] = useState(null)
  const [delivering, setDelivering] = useState(null)
  const { toast, confirm } = useUi()
  const { profile } = useAuth()
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const done = { dispatched: 'Dispatched. The milk left your stock and the buyer can see it is on the way.', delivered: 'Marked as delivered.', cancelled: 'Order cancelled.' }

  const move = async (o, status) => {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel this order?', body: `${litres(o.quantity_l)} for ${o.buyer?.business_name}. The buyer will see it as cancelled.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
      if (!ok) return
    }
    if (status === 'dispatched') {
      const ok = await confirm({ title: `Dispatch ${litres(o.quantity_l)}?`, body: 'This takes the milk out of your stock now. Only fresh milk can be sent.', confirmLabel: 'Dispatch' })
      if (!ok) return
    }
    if (status === 'delivered') return setDelivering(o)
    setBusy(o.id)
    try { await updateBulkOrder(o.id, status); await reload(); toast(done[status]) } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Bulk orders" description="Bids you won. Dispatch takes the milk out of your stock; the buyer’s 4-digit code confirms delivery." />
      <DeliverySheet key={delivering?.id ?? 'closed'} order={delivering} kind="bulk" demo={center?.is_demo}
        title={delivering ? `Deliver to ${delivering.buyer?.business_name}` : ''} subtitle={delivering ? `${litres(delivering.quantity_l)} · ${rs(delivering.total_amount)}` : ''}
        submit={(code) => updateBulkOrder(delivering.id, 'delivered', code)}
        onClose={() => setDelivering(null)} onDone={() => { toast('Delivered. It now counts in your sales.'); reload() }} />
      <Alert>{error}</Alert>
      <div className="panel overflow-x-auto">
        <table className="table min-w-[920px]">
          <thead>
            <tr><th>Buyer</th><th>Milk</th><th className="text-right">Total</th><th>Deliver to</th><th>Progress</th><th className="text-right">Next step</th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={6} />}
            {!loading && data?.length === 0 && (
              <tr><td colSpan={6}><EmptyState title="No bulk orders yet">When a business accepts one of your bids, the order appears here.</EmptyState></td></tr>
            )}
            {data?.map((o) => (
              <tr key={o.id}>
                <td><p className="font-semibold">{o.buyer?.business_name}</p><p className="text-[13px] text-muted">{cap(o.buyer?.business_type)}</p></td>
                <td className="num">{litres(o.quantity_l)} at {rs(o.price_per_l)}<p className="text-[13px] text-muted">{milkLabel[o.requirement?.milk_type]}, {qualityLabel[o.requirement?.quality]?.toLowerCase()}</p></td>
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
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
