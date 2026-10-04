import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import { centerOrders } from '../../lib/b2b'
import {
  myCenter, centerDaily, milkStock, stockBatches, activeOrders, farmersWithStats, shelfBatches, stockLeft, seedSample, myInvoices,
  shortDay, weekday, rsShort, todayKey, orderStatusLabel, orderTone, timeOf, milkLabel,
} from '../../lib/center'
import { rs, litres, relative } from '../../lib/format'
import WelcomeBanner from '../../components/WelcomeBanner'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Segmented from '../../components/Segmented'
import EmptyState from '../../components/EmptyState'
import Icon from '../../components/Icon'
import { TrendChart, Legend, Sparkline, Donut, SplitBar, C } from '../../components/charts'

const sum = (rows, key) => rows.reduce((n, r) => n + Number(r[key] || 0), 0)
const typeColor = { buffalo: C.g1, cow: C.g2, mixed: C.g3 }

export default function ManagerHome() {
  const { profile } = useAuth()
  const { data, reload } = useLoad(async () => {
    const center = await myCenter(profile.id)
    if (center?.type !== 'milk_center' || center.verification_status !== 'active') return { center }
    const [daily, stock, batches, orders, farmers, bulk, invoices] = await Promise.all([
      centerDaily(), milkStock(), stockBatches(), activeOrders(), farmersWithStats(), centerOrders(), myInvoices().catch(() => []),
    ])
    return { center, daily, stock, batches, orders, farmers, bulk, invoices }
  }, [profile.id])

  const c = data?.center
  if (c && (c.type !== 'milk_center' || c.verification_status !== 'active')) {
    return (
      <>
        <WelcomeBanner name={profile.full_name.split(' ')[0]} line={c.center_name} />
        <div className="panel"><EmptyState title="Product listings are coming next">Byproduct sellers will list desi ghee and other dairy products here.</EmptyState></div>
      </>
    )
  }

  const empty = data?.daily && data.farmers.length === 0 && sum(data.daily, 'sales') === 0

  return (
    <>
      <WelcomeBanner name={profile.full_name.split(' ')[0]} line={c ? c.center_name : ' '}>
        <Link to="/manager/collection/new" className="btn-haldi"><Icon name="drop" size={17} />Record milk</Link>
        <Link to="/manager/orders?sale=1" className="btn-on-dark"><Icon name="cart" size={17} />New sale</Link>
      </WelcomeBanner>
      <BillReminder invoices={data?.invoices} />
      {empty ? <Onboarding demo={c?.is_demo} onDone={reload} /> : <Dashboard data={data} />}
    </>
  )
}

// a gentle reminder for due bills, red once a bill is overdue
function BillReminder({ invoices }) {
  const due = (invoices ?? []).filter((i) => i.status === 'due').sort((a, b) => a.due_date.localeCompare(b.due_date))
  if (!due.length) return null
  const late = due.filter((i) => i.due_date < todayKey())
  const total = due.reduce((n, i) => n + Number(i.amount), 0)
  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3 text-[14px] ${late.length ? 'bg-[#f8e2dc] text-danger' : 'bg-haldi-soft text-forest-deep'}`}>
      <span className="flex items-center gap-2"><Icon name={late.length ? 'alert' : 'wallet'} size={16} />
        {late.length ? <b>Your ApnaDairy bill is overdue. Bidding and milk testing are paused until it is paid.</b>
          : <span><b>{rs(Math.round(total))}</b> due by {new Date(`${due[0].due_date}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} for {due.length === 1 ? due[0].description.toLowerCase() : `${due.length} bills`}.</span>}
      </span>
      <Link to="/manager/billing" className={late.length ? 'btn-danger btn-sm' : 'btn-secondary btn-sm'}>{late.length ? 'Pay now' : 'View bill'}</Link>
    </div>
  )
}

function Onboarding({ demo, onDone }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState(false)
  const load = async () => {
    setBusy(true)
    try { await seedSample(); toast('Sample data loaded: 12 farmers and 30 days of milk, sales and stock.'); onDone() }
    catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <div className="panel grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
      <div>
        <p className="text-[13px] font-semibold text-amber">Your center is ready</p>
        <h2 className="display mt-1 text-[28px] text-forest-deep">{demo ? 'Start with your farmers, or explore with sample data' : 'Start by adding your farmers'}</h2>
        <p className="mt-2 max-w-lg text-muted">Add the farmers who bring milk to you, then record each collection. The dashboard fills in as you buy and sell milk.
          {demo && ' This is a demo account, so you can also load a month of sample activity and clear it any time.'}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {demo && <button className="btn-primary" onClick={load} disabled={busy}>{busy ? 'Loading sample data…' : 'Load sample data'}</button>}
          <Link to="/manager/farmers?add=1" className={demo ? 'btn-secondary' : 'btn-primary'}>Add your first farmer</Link>
        </div>
      </div>
      <ol className="grid gap-3">
        {[['users', 'Add farmers', 'Name, village and the milk they bring'], ['chip', 'Test and buy milk', 'The IoT device reads it, the AI suggests a fair price'], ['cart', 'Sell and deliver', 'App orders, walk-in sales and bulk orders'], ['chart', 'Watch the numbers', 'Sales, profit, stock and quality at a glance']].map(([ic, t, d], i) => (
          <li key={t} className="flex items-center gap-3 rounded-2xl bg-cream px-4 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-forest text-cream"><Icon name={ic} size={16} /></span>
            <div><p className="font-semibold">{i + 1}. {t}</p><p className="text-[13px] text-muted">{d}</p></div>
          </li>
        ))}
      </ol>
    </div>
  )
}

function Dashboard({ data }) {
  const [range, setRange] = useState('14')
  const daily = data?.daily ?? []
  const today = daily[daily.length - 1] ?? {}
  const yesterday = daily[daily.length - 2] ?? {}
  const month = daily.filter((d) => d.day.slice(0, 7) === todayKey().slice(0, 7))
  const monthSales = sum(month, 'sales')
  const monthProfit = monthSales - sum(month, 'milk_cost')
  const margin = monthSales ? Math.round((monthProfit / monthSales) * 100) : 0
  const last14 = daily.slice(-14)
  const stock = data?.stock ?? []
  const totalStock = stock.reduce((n, s) => n + stockLeft(s), 0)
  const shelf = shelfBatches(data?.batches, stock)
  const sellSoon = shelf.filter((b) => b.hoursLeft < 12).reduce((n, b) => n + b.remaining, 0)
  const chart = daily.slice(-Number(range)).map((d) => ({ ...d, sales: Number(d.sales), milk_cost: Number(d.milk_cost) }))
  const loading = !data?.daily

  return (
    <div className="grid gap-4 sm:gap-5">
      {/* the four numbers a shop owner checks first */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Sales today" value={loading ? null : rs(Math.round(today.sales))} icon={<Icon name="wallet" size={16} />}
          note={loading ? ' ' : `${today.orders} orders · yesterday ${rsShort(yesterday.sales)}`}>
          <Sparkline values={last14.map((d) => Number(d.sales))} color="#e2a93b" width={140} height={30} />
        </Kpi>
        <Kpi label="Profit this month" value={loading ? null : rs(Math.round(monthProfit))} icon={<Icon name="chart" size={16} />}
          note={loading ? ' ' : `${margin}% of sales, after paying for milk`}>
          <Sparkline values={last14.map((d) => Number(d.sales) - Number(d.milk_cost))} color={C.green} width={140} height={30} />
        </Kpi>
        <Kpi label="Milk bought today" value={loading ? null : litres(Math.round(today.bought_l))} icon={<Icon name="drop" size={16} />}
          note={loading ? ' ' : `${today.farmers} farmers${today.failed ? ` · ${today.failed} failed the test` : ''}${today.awaiting ? ` · ${today.awaiting} awaiting farmer` : ''}`}>
          <Sparkline values={last14.map((d) => Number(d.bought_l))} color={C.gold} width={140} height={30} />
        </Kpi>
        <Kpi label="Milk in stock" value={loading ? null : litres(Math.round(totalStock))} icon={<Icon name="box" size={16} />}
          note={loading ? ' ' : sellSoon > 0 ? `${Math.round(sellSoon)} L to sell within 12 hours` : 'All stock is fresh'}>
          <SplitBar parts={stock.map((s) => ({ label: milkLabel[s.milk_type], value: stockLeft(s), color: typeColor[s.milk_type] }))} />
          <div className="mt-1.5 flex flex-wrap gap-x-3 text-[11.5px] text-muted">
            {stock.filter((s) => stockLeft(s) > 0).map((s) => (
              <span key={s.milk_type} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: typeColor[s.milk_type] }} />{milkLabel[s.milk_type]} {Math.round(stockLeft(s))} L</span>
            ))}
          </div>
        </Kpi>
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Sales and milk cost" subtitle="What you sold each day against what you paid farmers"
          action={<Segmented size="sm" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '14', label: '14 days' }, { value: '30', label: '30 days' }]} />}>
          <Legend items={[{ label: 'Sales', color: C.green }, { label: 'Milk cost', color: C.gold, line: true }]} />
          <div className="mt-3">
            <TrendChart data={chart} ariaLabel="Daily sales and milk cost"
              series={[{ key: 'sales', label: 'Sales', color: C.green, type: 'bar' }, { key: 'milk_cost', label: 'Milk cost', color: C.gold, type: 'line' }]}
              xFormat={(v, i, full) => (full ? `${weekday(v)}, ${shortDay(v)}` : Number(range) <= 7 ? weekday(v) : shortDay(v))}
              yFormat={(v, full) => (full ? rs(Math.round(v)) : rsShort(v))}
              tooltipExtra={(d) => (
                <p className="mt-1 flex justify-between border-t border-line pt-1 text-muted">Profit
                  <span className={`num font-semibold ${d.sales - d.milk_cost >= 0 ? 'text-forest' : 'text-danger'}`}>{rs(Math.round(d.sales - d.milk_cost))}</span></p>
              )} />
          </div>
        </Card>
        <PendingOrders orders={data?.orders} bulk={data?.bulk} />
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
        <QualityCard daily={daily} />
        <FarmersToPay farmers={data?.farmers} />
      </div>
    </div>
  )
}

function PendingOrders({ orders, bulk }) {
  const live = orders ?? []
  const bulkActive = (bulk ?? []).filter((o) => o.status === 'confirmed' || o.status === 'dispatched')
  return (
    <Card title="Orders to handle" subtitle={orders ? `${live.length} customer ${live.length === 1 ? 'order' : 'orders'} open` : ' '}
      action={<Link to="/manager/orders" className="text-[13.5px] font-semibold text-forest hover:underline">Open orders</Link>} bodyClass="px-3 pb-3 pt-3">
      {orders && live.length === 0 && bulkActive.length === 0 && (
        <p className="px-3 py-8 text-center text-muted">No open orders right now.</p>
      )}
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
        {live.slice(0, 5).map((o) => (
          <li key={o.id}>
            <Link to="/manager/orders" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-cream">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-2 text-[13px] font-bold text-forest">
                {o.customer_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.customer_name}</p>
                <p className="truncate text-[12.5px] text-muted">{o.items.map((i) => `${Number(i.quantity)} ${i.unit === 'litre' ? 'L' : i.unit === 'kg' || Number(i.quantity) === 1 ? i.unit : `${i.unit}s`} ${i.name.toLowerCase()}`).join(', ')}</p>
              </div>
              <div className="shrink-0 text-right">
                <Badge tone={orderTone[o.status]}>{orderStatusLabel[o.status]}</Badge>
                <p className="mt-1 text-[11.5px] text-muted">{timeOf(o.created_at)}</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      {live.length > 5 && <p className="px-3 pt-1 text-[13px] text-muted">and {live.length - 5} more</p>}
      {bulkActive.length > 0 && (
        <Link to="/manager/bulk-orders" className="mt-2 flex items-center justify-between rounded-2xl bg-haldi-soft px-4 py-3 text-[14px] font-semibold text-forest-deep">
          <span className="flex items-center gap-2"><Icon name="truck" size={16} />{bulkActive.length} bulk {bulkActive.length === 1 ? 'order' : 'orders'} to deliver</span>
          <Icon name="arrow" size={16} />
        </Link>
      )}
    </Card>
  )
}

function QualityCard({ daily }) {
  const seg = [
    { label: 'Premium', value: sum(daily, 'premium'), color: C.g1 },
    { label: 'Fresh', value: sum(daily, 'fresh'), color: C.g2 },
    { label: 'Standard', value: sum(daily, 'standard'), color: C.g3 },
    { label: 'Failed test', value: sum(daily, 'failed'), color: C.danger },
  ]
  const total = seg.reduce((n, s) => n + s.value, 0)
  const pass = total ? Math.round(((total - seg[3].value) / total) * 100) : 0
  return (
    <Card title="Milk quality" subtitle="Every test in the last 30 days"
      action={<Link to="/manager/iot" className="text-[13.5px] font-semibold text-forest hover:underline">IoT readings</Link>}>
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <Donut segments={seg} center={`${pass}%`} sub="passed" />
        <ul className="grid w-full gap-2.5">
          {seg.map((s) => (
            <li key={s.label} className="flex items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: s.color }} />
              <span className="flex-1 text-[14px]">{s.label}</span>
              <span className="num text-[14px] font-semibold">{s.value}</span>
              <span className="num w-11 text-right text-[13px] text-muted">{total ? Math.round((s.value / total) * 100) : 0}%</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

function FarmersToPay({ farmers }) {
  const owed = (farmers ?? []).filter((f) => Number(f.stats.unpaid_amount) > 0).sort((a, b) => b.stats.unpaid_amount - a.stats.unpaid_amount)
  const total = owed.reduce((n, f) => n + Number(f.stats.unpaid_amount), 0)
  const top = owed[0] ? Number(owed[0].stats.unpaid_amount) : 1
  return (
    <Card title="Farmers to pay" subtitle={farmers ? `${rs(Math.round(total))} owed to ${owed.length} farmers` : ' '}
      action={<Link to="/manager/farmers" className="text-[13.5px] font-semibold text-forest hover:underline">All farmers</Link>}>
      {farmers && owed.length === 0 && <p className="py-6 text-center text-muted">Everyone is paid up.</p>}
      <ul className="grid gap-3">
        {owed.slice(0, 4).map((f) => (
          <li key={f.id}>
            <Link to={`/manager/farmers/${f.id}`} className="group block">
              <div className="flex items-baseline justify-between gap-3 text-[14px]">
                <span className="truncate font-semibold group-hover:text-forest">{f.full_name}</span>
                <span className="num font-semibold">{rs(Math.round(f.stats.unpaid_amount))}</span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-cream-2">
                <div className="h-2 rounded-full bg-haldi" style={{ width: `${(Number(f.stats.unpaid_amount) / top) * 100}%` }} />
              </div>
              <p className="mt-1 text-[12px] text-muted">{Number(f.stats.awaiting_confirmation) > 0 ? `${rs(Math.round(f.stats.awaiting_confirmation))} sent, waiting for the farmer to confirm` : `Last milk ${f.stats.last_collected_at ? relative(f.stats.last_collected_at) : 'never'}`}</p>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
