import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useLoad } from '../../lib/useLoad'
import { products, activeOrders, billingOverview, myInvoices, categoryLabel, todayKey, timeOf, orderStatusLabel, orderTone } from '../../lib/center'
import { centerOrders, requestBoard, qtyText, reqTitle } from '../../lib/b2b'
import { rs, relative, date } from '../../lib/format'
import WelcomeBanner from '../../components/WelcomeBanner'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { BillReminder } from '../manager/ManagerHome'

const daysTo = (d) => (d ? Math.round((new Date(`${d}T12:00:00`) - new Date(`${todayKey()}T12:00:00`)) / 864e5) : null)

// overview for a dairy products seller: products, app orders, bulk orders and the bill
export default function SellerHome({ center }) {
  const { profile } = useAuth()
  const { data, error } = useLoad(async () => {
    const [items, orders, bulk, board, overview, invoices] = await Promise.all([
      products(), activeOrders(), centerOrders(), requestBoard().catch(() => []), billingOverview().catch(() => null), myInvoices().catch(() => []),
    ])
    return { items: items.filter((p) => p.category !== 'milk'), orders, bulk, board, overview, invoices }
  })
  const items = data?.items ?? []
  const live = items.filter((p) => p.is_available && Number(p.stock_qty) > 0 && !(daysTo(p.expires_on) < 0))
  const attention = items.filter((p) => (Number(p.stock_qty) > 0 && Number(p.stock_qty) < 5) || (Number(p.stock_qty) > 0 && daysTo(p.expires_on) != null && daysTo(p.expires_on) <= 7) || (p.is_available && Number(p.stock_qty) <= 0))
  const bulkOpen = (data?.bulk ?? []).filter((o) => o.status === 'confirmed' || o.status === 'dispatched')

  return (
    <>
      <WelcomeBanner name={profile.full_name.split(' ')[0]} line={center.center_name}>
        <Link to="/manager/products" className="btn-haldi"><Icon name="plus" size={17} />Add product</Link>
        <Link to="/manager/orders" className="btn-on-dark"><Icon name="cart" size={17} />Shop orders</Link>
      </WelcomeBanner>
      <BillReminder invoices={data?.invoices} milk={false} />
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Sales this month" value={data?.overview ? rs(Math.round(data.overview.this_month_online)) : data ? rs(0) : null} icon={<Icon name="wallet" size={16} />} note="delivered app and bulk orders" />
        <Kpi label="Products on the app" value={data ? live.length : null} note={data ? `of ${items.length} products` : ''} />
        <Kpi label="Shop orders to handle" value={data ? data.orders.length : null} note="from the customer app" />
        <Kpi label="Bulk orders to deliver" value={data ? bulkOpen.length : null} note={data ? `${data.board.length} open ${data.board.length === 1 ? 'request' : 'requests'} to bid on` : ''} />
      </div>

      {data && items.length === 0 && (
        <div className="panel mt-5"><EmptyState title="Start by adding your products" action={<Link to="/manager/products" className="btn-primary btn-sm">Add a product</Link>}>
          List desi ghee, butter, yogurt or anything you make, with how much you have and your price. Customers can then order it in the ApnaDairy app.
        </EmptyState></div>
      )}

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-2">
        <Card title="Shop orders" subtitle="Orders from the customer app, oldest first" action={<Link to="/manager/orders" className="text-[13.5px] font-semibold text-forest hover:underline">All orders</Link>}>
          {data && data.orders.length === 0 && <p className="py-6 text-center text-muted">No open orders right now.</p>}
          <ul className="grid gap-2">
            {(data?.orders ?? []).slice(0, 5).map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{o.customer_name}</p>
                  <p className="truncate text-[12.5px] text-muted">{o.items.map((i) => `${qtyText(i.quantity, i.unit)} ${i.name.toLowerCase()}`).join(', ')}</p>
                </div>
                <div className="shrink-0 text-right"><Badge tone={orderTone[o.status]}>{orderStatusLabel[o.status]}</Badge><p className="mt-1 text-[11.5px] text-muted">{timeOf(o.created_at)}</p></div>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Needs your attention" subtitle="Low stock, sold out or close to its best before date" action={<Link to="/manager/products" className="text-[13.5px] font-semibold text-forest hover:underline">Products</Link>}>
          {data && attention.length === 0 && <p className="py-6 text-center text-muted">All products are well stocked.</p>}
          <ul className="grid gap-2">
            {attention.slice(0, 6).map((p) => {
              const d = daysTo(p.expires_on)
              const why = Number(p.stock_qty) <= 0 ? 'Sold out' : d != null && d < 0 ? 'Expired' : d != null && d <= 7 ? `Best before ${date(p.expires_on)}` : `Only ${qtyText(p.stock_qty, p.unit)} left`
              return (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
                  <div className="min-w-0"><p className="truncate font-semibold">{p.name}</p><p className="text-[12.5px] text-muted">{categoryLabel[p.category]}</p></div>
                  <span className={`shrink-0 text-[13px] font-semibold ${Number(p.stock_qty) <= 0 || (d != null && d < 0) ? 'text-danger' : 'text-amber'}`}>{why}</span>
                </li>
              )
            })}
          </ul>
        </Card>
      </div>

      <Card className="mt-4 sm:mt-5" title="Bulk requests for dairy products" subtitle="Businesses looking for what you make" action={<Link to="/manager/bulk-requests" className="text-[13.5px] font-semibold text-forest hover:underline">Open the board</Link>}>
        {data && data.board.length === 0 && <p className="py-4 text-center text-muted">No open requests right now. New ones appear here as soon as businesses post them.</p>}
        <ul className="grid gap-2 sm:grid-cols-2">
          {(data?.board ?? []).slice(0, 4).map((r) => (
            <li key={r.id}><Link to={`/manager/bulk-requests/${r.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 hover:border-forest/40">
              <div className="min-w-0"><p className="truncate font-semibold">{reqTitle(r)}</p><p className="truncate text-[12.5px] text-muted">{r.business_name}, {r.delivery_city} · closes {relative(r.bid_deadline)}</p></div>
              <Icon name="arrow" size={16} className="shrink-0 text-forest" />
            </Link></li>
          ))}
        </ul>
      </Card>
    </>
  )
}
