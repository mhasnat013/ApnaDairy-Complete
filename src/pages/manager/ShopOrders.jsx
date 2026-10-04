import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import {
  activeOrders, pastOrders, products, myMilkShelf, myCenter, recordSale, updateShopOrder,
  orderStatusLabel, orderTone, nextOrderStep, timeOf,
} from '../../lib/center'
import { rs, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'
import { SkeletonRows } from '../../components/Skeleton'
import DeliverySheet from '../../components/DeliverySheet'

const COLUMNS = ['pending', 'preparing', 'out_for_delivery']
const qtyText = (i) => `${Number(i.quantity)} ${i.unit === 'litre' ? 'L' : i.unit === 'kg' || Number(i.quantity) === 1 ? i.unit : `${i.unit}s`}`

export default function ShopOrders() {
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState('active')
  const active = useLoad(activeOrders)
  const past = useLoad(() => (tab === 'active' ? Promise.resolve(null) : pastOrders(tab)), [tab])
  const [selling, setSelling] = useState(params.get('sale') === '1')
  const closeSale = () => { setSelling(false); if (params.get('sale')) setParams({}) }

  return (
    <>
      <PageHeader title="Shop orders" description="Orders from the customer app and sales at your counter. Move each app order along until it is delivered.">
        <button className="btn-primary" onClick={() => setSelling(true)}><Icon name="cart" size={17} />New sale</button>
      </PageHeader>
      <div className="mb-5">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'active', label: 'Open', count: active.data?.length },
          { value: 'delivered', label: 'Delivered' },
          { value: 'cancelled', label: 'Cancelled' },
        ]} />
      </div>
      <Alert>{active.error || past.error}</Alert>
      {tab === 'active' ? <Board data={active.data} loading={active.loading} reload={active.reload} /> : <History rows={past.data} loading={past.loading} />}
      <SaleForm key={selling ? 'open' : 'closed'} open={selling} onClose={closeSale} onSaved={() => { active.reload(); if (tab !== 'active') past.reload() }} />
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
    if (status === 'delivered' && o.channel === 'app') return setDelivering(o)
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

function History({ rows, loading }) {
  return (
    <div className="panel overflow-x-auto">
      <table className="table min-w-[680px]">
        <thead><tr><th>Customer</th><th>Items</th><th className="text-right">Total</th><th>When</th><th>Status</th></tr></thead>
        <tbody>
          {loading && <SkeletonRows cols={5} />}
          {!loading && rows?.length === 0 && <tr><td colSpan={5}><EmptyState title="Nothing here yet" /></td></tr>}
          {!loading && rows?.map((o) => (
            <tr key={o.id}>
              <td><p className="font-semibold">{o.customer_name}</p><p className="text-[12.5px] text-muted">{o.channel === 'app' ? 'App order' : 'Counter sale'}</p></td>
              <td className="max-w-[300px] truncate text-[13.5px] text-muted">{o.items.map((i) => `${qtyText(i)} ${i.name.toLowerCase()}`).join(', ')}</td>
              <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
              <td className="num">{date(o.created_at)}<p className="text-[12.5px] text-muted">{timeOf(o.created_at)}</p></td>
              <td><Badge tone={orderTone[o.status]}>{orderStatusLabel[o.status]}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// counter sale: tap products, adjust quantities, record. stock is checked by the database.
function SaleForm({ open, onClose, onSaved }) {
  const { toast } = useUi()
  // every milk listing can be sold at the counter, even one hidden from the app; only fresh milk counts
  const { data } = useLoad(async () => (open ? Promise.all([products(), myMilkShelf()]) : null), [open])
  const [cart, setCart] = useState({})
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [prods, stock] = data ?? [[], []]
  const avail = prods.filter((p) => p.category === 'milk')
  const left = (p) => Math.max(0, Number(stock.find((s) => s.milk_type === p.milk_type)?.sellable_l ?? 0))
  const price = (p) => p.price * (100 - p.discount_pct) / 100
  const step = () => 0.5
  const change = (p, d) => setCart((c) => {
    const v = Math.max(0, Math.min(left(p), +((c[p.id] || 0) + d * step(p)).toFixed(2)))
    return { ...c, [p.id]: v }
  })
  const lines = avail.filter((p) => cart[p.id] > 0)
  const total = lines.reduce((n, p) => n + cart[p.id] * price(p), 0)

  const submit = async () => {
    setBusy(true); setErr('')
    try {
      await recordSale(lines.map((p) => ({ product_id: p.id, quantity: cart[p.id] })), name)
      toast(`Sale recorded: ${rs(Math.round(total))}.`); onSaved(); onClose()
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <Sheet open={open} onClose={onClose} wide title="New counter sale" subtitle="Tap + for each item the customer takes."
      footer={(
        <div className="flex w-full items-center justify-between gap-3">
          <div><p className="text-[12.5px] text-muted">Total</p><p className="display num text-[24px]">{rs(Math.round(total))}</p></div>
          <button className="btn-primary" onClick={submit} disabled={busy || lines.length === 0}>{busy ? 'Saving…' : 'Record sale'}</button>
        </div>
      )}>
      <Alert>{err}</Alert>
      <div className="field mb-4"><label htmlFor="cn">Customer name (optional)</label><input id="cn" className="input" placeholder="Walk-in customer" value={name} onChange={(e) => setName(e.target.value)} /></div>
      {!data && <div className="grid gap-2">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-16" />)}</div>}
      {data && avail.length === 0 && <EmptyState title="No milk to sell yet">Add a milk listing on the My shop page first.</EmptyState>}
      <ul className="grid gap-2">
        {avail.map((p) => {
          const q = cart[p.id] || 0
          const max = left(p)
          return (
            <li key={p.id} className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 transition-colors ${q > 0 ? 'border-forest bg-mint-soft' : 'border-line bg-white'}`}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{p.name}</p>
                <p className="text-[12.5px] text-muted">{rs(Math.round(price(p)))} per {p.unit}{p.discount_pct ? ` · ${p.discount_pct}% off` : ''} · {+max.toFixed(1)} L fresh</p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full border border-line bg-white disabled:opacity-40" onClick={() => change(p, -1)} disabled={q <= 0} aria-label={`Less ${p.name}`}><Icon name="minus" size={16} /></button>
                <span className="num w-12 text-center font-bold">{q}</span>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-full bg-forest text-cream disabled:opacity-40" onClick={() => change(p, 1)} disabled={q + step(p) > max + 1e-9} aria-label={`More ${p.name}`}><Icon name="plus" size={16} /></button>
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
