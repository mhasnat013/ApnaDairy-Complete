import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import {
  activeOrders, pastOrders, myCenter, myFirstDay, updateShopOrder, todayKey,
  orderStatusLabel, orderTone, nextOrderStep, timeOf,
} from '../../lib/center'
import { rs, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import DayPicker from '../../components/DayPicker'
import EmptyState from '../../components/EmptyState'
import { SkeletonRows } from '../../components/Skeleton'
import DeliverySheet from '../../components/DeliverySheet'

const COLUMNS = ['pending', 'preparing', 'out_for_delivery']
const qtyText = (i) => `${Number(i.quantity)} ${i.unit === 'litre' ? 'L' : i.unit === 'kg' || Number(i.quantity) === 1 ? i.unit : `${i.unit}s`}`

export default function ShopOrders() {
  const [tab, setTab] = useState('active')
  const [day, setDay] = useState(todayKey)
  const active = useLoad(activeOrders)
  const first = useLoad(myFirstDay)
  const past = useLoad(() => (tab === 'active' ? Promise.resolve(null) : pastOrders(tab, day)), [tab, day])

  return (
    <>
      <PageHeader title="Shop orders" description="Customers order through the ApnaDairy app. Move each order along until the customer gives you their delivery code." />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'active', label: 'Open', count: active.data?.length },
          { value: 'delivered', label: 'Delivered' },
          { value: 'cancelled', label: 'Cancelled' },
        ]} />
        {tab !== 'active' && <DayPicker value={day} onChange={setDay} min={first.data ?? undefined} />}
      </div>
      <Alert>{active.error || past.error}</Alert>
      {tab === 'active' ? <Board data={active.data} loading={active.loading} reload={active.reload} /> : <History rows={past.data} loading={past.loading} status={tab} />}
    </>
  )
}

function Board({ data, loading, reload }) {
  const { toast, confirm } = useUi()
  const { profile } = useAuth()
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const [busy, setBusy] = useState(null)
  const [delivering, setDelivering] = useState(null)
  const move = async (o, status) => {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel this order?', body: `${o.customer_name}’s order of ${rs(o.total_amount)}. The milk goes back into your stock.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
      if (!ok) return
    }
    // app orders are delivered with the customer's code
    if (status === 'delivered') return setDelivering(o)
    setBusy(o.id)
    try { await updateShopOrder(o.id, status); toast(status === 'cancelled' ? 'Order cancelled.' : `${o.customer_name}: ${orderStatusLabel[status].toLowerCase()}.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }
  if (!loading && data?.length === 0) {
    return <div className="panel"><EmptyState title="No open orders">New orders from the customer app appear here.</EmptyState></div>
  }
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <DeliverySheet key={delivering?.id ?? 'closed'} order={delivering} kind="shop" demo={center?.is_demo}
        title={delivering ? `Deliver to ${delivering.customer_name}` : ''} subtitle={delivering ? `${rs(delivering.total_amount)} · ${delivering.delivery_address ?? ''}` : ''}
        submit={(code) => updateShopOrder(delivering.id, 'delivered', code)}
        onClose={() => setDelivering(null)} onDone={() => { toast(`${delivering.customer_name}: delivered.`); reload() }} />
      {COLUMNS.map((col) => {
        const list = (data ?? []).filter((o) => o.status === col)
        return (
          <section key={col} className="rounded-[22px] bg-cream-2/70 p-3">
            <header className="flex items-center justify-between px-2 pb-3 pt-1">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold"><Badge tone={orderTone[col]}>{orderStatusLabel[col]}</Badge></h2>
              <span className="num text-[13px] font-semibold text-muted">{list.length}</span>
            </header>
            <div className="grid gap-3">
              {loading && <div className="skeleton h-40 rounded-[18px]" />}
              {!loading && list.length === 0 && <p className="rounded-[18px] border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">Nothing here</p>}
              {list.map((o) => (
                <article key={o.id} className={`animate-rise rounded-[18px] border border-line bg-surface p-4 shadow-[0_8px_20px_-18px_rgb(30_43_34/.6)] ${busy === o.id ? 'pointer-events-none opacity-50' : ''}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{o.customer_name}</p>
                      <p className="text-[12.5px] text-muted">{timeOf(o.created_at)} · {relative(o.created_at)}</p>
                    </div>
                    <p className="num shrink-0 font-bold">{rs(o.total_amount)}</p>
                  </div>
                  <ul className="mt-3 grid gap-1 text-[13.5px]">
                    {o.items.map((i) => <li key={i.id} className="flex justify-between gap-2"><span className="truncate">{i.name}</span><span className="num shrink-0 text-muted">{qtyText(i)}</span></li>)}
                  </ul>
                  {o.delivery_address && <p className="mt-3 flex items-start gap-1.5 text-[12.5px] text-muted"><Icon name="truck" size={14} className="mt-0.5 shrink-0" />{o.delivery_address}</p>}
                  <div className="mt-4 flex gap-2">
                    <button className="btn-primary btn-sm flex-1" onClick={() => move(o, nextOrderStep[o.status][0])}>{nextOrderStep[o.status][1]}</button>
                    {o.status !== 'out_for_delivery' && <button className="btn-ghost btn-sm text-danger" onClick={() => move(o, 'cancelled')}>Cancel</button>}
                  </div>
                </article>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function History({ rows, loading, status }) {
  const litres = (rows ?? []).reduce((n, o) => n + o.items.filter((i) => i.unit === 'litre').reduce((m, i) => m + Number(i.quantity), 0), 0)
  const total = (rows ?? []).reduce((n, o) => n + Number(o.total_amount), 0)
  return (
    <>
    {!loading && rows?.length > 0 && (
      <div className="mb-4 grid grid-cols-3 gap-3">
        {[[status === 'delivered' ? 'Orders delivered' : 'Orders cancelled', rows.length], ['Milk', `${+litres.toFixed(1)} L`], [status === 'delivered' ? 'Sales' : 'Value', rs(Math.round(total))]].map(([k, v]) => (
          <div key={k} className="rounded-[18px] border border-line bg-surface px-4 py-3"><p className="text-[12.5px] text-muted">{k}</p><p className="display num mt-0.5 text-[20px] text-forest-deep sm:text-[22px]">{v}</p></div>
        ))}
      </div>
    )}
    <div className="panel overflow-x-auto">
      <table className="table min-w-[680px]">
        <thead><tr><th>Customer</th><th>Items</th><th className="text-right">Total</th><th>When</th><th>Status</th></tr></thead>
        <tbody>
          {loading && <SkeletonRows cols={5} />}
          {!loading && rows?.length === 0 && <tr><td colSpan={5}><EmptyState title={status === 'delivered' ? 'No orders delivered on this day' : 'No orders cancelled on this day'}>Pick another day with the arrows or the calendar.</EmptyState></td></tr>}
          {!loading && rows?.map((o) => (
            <tr key={o.id}>
              <td><p className="font-semibold">{o.customer_name}</p><p className="max-w-[220px] truncate text-[12.5px] text-muted">{o.delivery_address ?? 'App order'}</p></td>
              <td className="max-w-[300px] truncate text-[13.5px] text-muted">{o.items.map((i) => `${qtyText(i)} ${i.name.toLowerCase()}`).join(', ')}</td>
              <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
              <td className="num">{date(status === 'delivered' ? o.delivered_at ?? o.created_at : o.created_at)}<p className="text-[12.5px] text-muted">{timeOf(status === 'delivered' ? o.delivered_at ?? o.created_at : o.created_at)}</p></td>
              <td><Badge tone={orderTone[o.status]}>{orderStatusLabel[o.status]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    </>
  )
}
