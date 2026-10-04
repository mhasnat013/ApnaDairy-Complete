import { businessOrders, updateBulkOrder, myDeliveryCodes, milkLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { rs, litres, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import OrderProgress from '../../components/OrderProgress'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'

export default function BusinessOrders() {
  const { data, error, loading, reload } = useLoad(async () => {
    const [orders, codes] = await Promise.all([businessOrders(), myDeliveryCodes().catch(() => [])])
    const byOrder = Object.fromEntries(codes.map((c) => [c.order_id, c.code]))
    return orders.map((o) => ({ ...o, code: byOrder[o.id] }))
  })
  const { toast, confirm } = useUi()

  const cancel = async (o) => {
    const ok = await confirm({ title: 'Cancel this order?', body: `${litres(o.quantity_l)} from ${o.center?.center_name}. They haven't dispatched it yet.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
    if (!ok) return
    try { await updateBulkOrder(o.id, 'cancelled'); await reload(); toast('Order cancelled.') } catch (e) { toast(e.message, 'error') }
  }
  const received = async (o) => {
    const ok = await confirm({ title: 'Did the milk arrive?', body: `${litres(o.quantity_l)} from ${o.center?.center_name}. Confirm only once you have it.`, confirmLabel: 'Yes, received' })
    if (!ok) return
    try { await updateBulkOrder(o.id, 'delivered'); await reload(); toast('Marked as received. Thank you.') } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Bulk orders" description="Bids you accepted. Give the delivery code to the driver when the milk arrives, or press Received yourself." />
      <Alert>{error}</Alert>
      <div className="panel overflow-x-auto">
        <table className="table min-w-[980px]">
          <thead>
            <tr><th>Supplier</th><th>Milk</th><th className="text-right">Price / L</th><th className="text-right">Total</th><th>Delivery</th><th>Progress</th><th>Delivery code</th><th></th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={8} />}
            {!loading && data?.length === 0 && (
              <tr><td colSpan={8}><EmptyState title="No bulk orders yet">When you accept a bid on one of your requirements, the order shows up here.</EmptyState></td></tr>
            )}
            {data?.map((o) => (
              <tr key={o.id}>
                <td><p className="font-semibold">{o.center?.center_name}</p><p className="text-[13px] text-muted">{o.center?.city}</p></td>
                <td className="num">{litres(o.quantity_l)}<p className="text-[13px] text-muted">{milkLabel[o.requirement?.milk_type]}</p></td>
                <td className="num text-right">{rs(o.price_per_l)}</td>
                <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
                <td className="num">{date(o.delivery_date)}<p className="text-[13px] text-muted">{o.delivery_city}</p></td>
                <td><OrderProgress order={o} /></td>
                <td>{o.code && ['confirmed', 'dispatched'].includes(o.status)
                  ? <span className="num rounded-xl bg-haldi-soft px-3 py-1.5 text-[17px] font-bold tracking-[0.25em] text-forest-deep" title="Give this code to the driver when the milk arrives">{o.code}</span>
                  : <span className="text-[13px] text-muted">{o.status === 'delivered' ? 'Used' : '—'}</span>}</td>
                <td className="text-right">
                  {o.status === 'confirmed' && <button className="btn-danger btn-sm" onClick={() => cancel(o)}>Cancel</button>}
                  {o.status === 'dispatched' && <button className="btn-primary btn-sm" onClick={() => received(o)}>Received</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
