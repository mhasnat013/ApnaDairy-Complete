import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { billingOverview, myInvoices, paymentLabel, monthLabel, todayKey, runMyBilling, myDues, billingNotices, overdueText } from '../../lib/center'
import { rs, date, dateTime } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { Breakdown, PaySheet } from '../../components/BillPay'

const isOverdue = (i) => i.status === 'due' && i.due_date < todayKey()

export default function Billing() {
  const { center } = useOutletContext() ?? {}
  const seller = center?.type === 'byproduct'
  const { data, error, reload } = useLoad(async () => {
    await runMyBilling().catch(() => {})   // this month's bill and any warning due today
    const [o, invoices, dues, notices] = await Promise.all([billingOverview(), myInvoices(), myDues(), billingNotices().catch(() => [])])
    return { o, invoices, dues, notices }
  })
  const [paying, setPaying] = useState(null)
  const o = data?.o
  const due = (data?.invoices ?? []).filter((i) => i.status === 'due')
  const past = (data?.invoices ?? []).filter((i) => i.status !== 'due')

  return (
    <>
      <PageHeader title="Billing" description={seller ? "Your ApnaDairy plan: the monthly platform fee only. Every rupee from your sales is yours." : "Your ApnaDairy plan: the IoT milk tester and the monthly platform fee. Every rupee from your milk sales is yours."} />
      <Alert>{error}</Alert>
      {data?.dues && <DuesBanner d={data.dues} seller={seller} />}

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <section className="furrows relative overflow-hidden rounded-[24px] bg-forest-deep p-6 text-cream">
          <p className="text-[13px] text-cream/70">Your plan</p>
          <p className="display mt-1 text-[28px]">{seller ? 'ApnaDairy Seller' : 'ApnaDairy Center'}</p>
          <dl className="mt-5 grid gap-3">
            {!seller && <div className="flex items-center justify-between rounded-2xl bg-cream/10 px-4 py-3">
              <dt className="flex items-center gap-2 text-[14px]"><Icon name="chip" size={16} />IoT milk tester</dt>
              <dd>{o ? (o.device_active
                ? <span className="rounded-full bg-[#7fd39b]/20 px-2.5 py-1 text-[12.5px] font-semibold text-[#a9e6bd]">Active</span>
                : <span className="rounded-full bg-haldi/20 px-2.5 py-1 text-[12.5px] font-semibold text-haldi">Awaiting payment</span>) : '—'}</dd>
            </div>}
            <div className="flex items-center justify-between rounded-2xl bg-cream/10 px-4 py-3">
              <dt className="flex items-center gap-2 text-[14px]"><Icon name="clock" size={16} />Monthly platform fee</dt>
              <dd className="num font-semibold">{o ? rs(o.monthly_fee) : '—'}</dd>
            </div>
            <div className="flex items-center justify-between rounded-2xl bg-cream/10 px-4 py-3">
              <dt className="flex items-center gap-2 text-[14px]"><Icon name="cart" size={16} />{seller ? 'Your sales' : 'Your milk sales'}</dt>
              <dd><span className="rounded-full bg-[#7fd39b]/20 px-2.5 py-1 text-[12.5px] font-semibold text-[#a9e6bd]">100% yours</span></dd>
            </div>
          </dl>
          <p className="mt-4 text-[12.5px] leading-relaxed text-cream/65">ApnaDairy takes no cut from what you sell. One monthly fee, with a discount in months after high sales.</p>
        </section>

        <Card title="This month" subtitle="One plan for every seller, with a discount when your sales are high.">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-cream px-3 py-3"><p className="text-[12px] text-muted">Sales so far</p><p className="display num mt-0.5 text-[20px] sm:text-[24px]">{o ? rs(Math.round(o.this_month_online)) : '—'}</p></div>
            <div className="rounded-2xl bg-cream px-3 py-3"><p className="text-[12px] text-muted">This month’s fee</p><p className="display num mt-0.5 text-[20px] sm:text-[24px]">{o ? rs(Math.round(Number(o.monthly_fee) * (100 - Number(o.discount_now || 0)) / 100)) : '—'}</p></div>
            <div className="rounded-2xl bg-cream px-3 py-3"><p className="text-[12px] text-muted">Cut from sales</p><p className="display num mt-0.5 text-[20px] text-forest sm:text-[24px]">Rs 0</p></div>
          </div>
          {o && Number(o.discount_pct) > 0 && Number(o.discount_min_sales) > 0 && (
            <div className="mt-5">
              <p className="text-[14px]">Sell <b className="num">{rs(o.discount_min_sales)}</b> or more in a month and next month’s fee is <b>{o.discount_pct}% off</b>.</p>
              <div className="mt-2 h-3 rounded-full bg-cream-2"><div className="h-3 rounded-full bg-haldi transition-all" style={{ width: `${Math.min(100, (Number(o.this_month_online) / Number(o.discount_min_sales)) * 100)}%` }} /></div>
              <p className="mt-2 text-[13px] text-muted">{Number(o.discount_next) > 0
                ? <b className="text-forest">Reached: next month’s fee is {o.discount_next}% off.</b>
                : `${rs(Math.max(0, Math.round(o.discount_min_sales - o.this_month_online)))} more in delivered app and bulk orders this month to get it.`}</p>
              {Number(o.discount_now) > 0 && <p className="mt-3 rounded-2xl bg-mint-soft px-4 py-3 text-[13px] text-forest">This month’s fee is {o.discount_now}% off, because you sold {rs(Math.round(o.last_month_online))} last month.</p>}
            </div>
          )}
        </Card>
      </div>

      {data?.dues && (
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['Outstanding', rs(data.dues.outstanding), data.dues.due_bills ? `${data.dues.due_bills} ${data.dues.due_bills === 1 ? 'bill' : 'bills'}` : 'all paid'],
            ['Due date', data.dues.next_due ? date(data.dues.next_due) : '—', data.dues.next_due && data.dues.next_due < todayKey() ? 'overdue' : ''],
            ['Paid so far', rs(data.dues.paid), data.dues.last_paid_at ? `last on ${date(data.dues.last_paid_at)}` : ''],
            ['Warnings', data.dues.warnings, data.dues.last_warning_at ? `last on ${date(data.dues.last_warning_at)}` : 'none']].map(([k, v, n]) => (
            <div key={k} className="panel px-4 py-3"><dt className="text-[12.5px] text-muted">{k}</dt><dd className={`display num mt-0.5 text-[22px] ${n === 'overdue' ? 'text-danger' : ''}`}>{v}</dd>{n && <p className={`text-[12px] ${n === 'overdue' ? 'font-semibold text-danger' : 'text-muted'}`}>{n}</p>}</div>
          ))}
        </dl>
      )}

      <h2 className="display mb-3 mt-8 text-[22px] text-forest-deep">To pay</h2>
      {data && due.length === 0 && <div className="panel"><EmptyState title="Nothing to pay">You are all paid up. Thank you.</EmptyState></div>}
      <div className="grid gap-3 lg:grid-cols-2">
        {due.map((i) => (
          <article key={i.id} className={`panel animate-rise p-5 sm:p-6 ${isOverdue(i) ? 'border-[#efc6bb]' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{i.description}</p>
                <p className={`mt-0.5 text-[13px] ${isOverdue(i) ? 'font-semibold text-danger' : 'text-muted'}`}>{isOverdue(i) ? `Overdue since ${date(i.due_date)}. ${seller ? 'Bidding is paused.' : 'Bidding and testing are paused.'}` : `Due ${date(i.due_date)}`}</p>
              </div>
              <p className="display num shrink-0 text-[26px]">{rs(i.amount)}</p>
            </div>
            <Breakdown i={i} />
            {i.submitted_at ? (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-haldi-soft px-4 py-3 text-[13px] text-amber">
                <span><b>Payment sent</b> by {paymentLabel[i.payment_method]} ({i.payment_ref}). ApnaDairy is checking it.</span>
                <button className="font-semibold underline" onClick={() => setPaying(i)}>Change</button>
              </div>
            ) : <button className="btn-primary mt-4 w-full" onClick={() => setPaying(i)}><Icon name="wallet" size={17} />Pay {rs(i.amount)}</button>}
          </article>
        ))}
      </div>

      <Card className="mt-6" title="Payment history" bodyClass="pt-3">
        <div className="overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>Bill</th><th className="text-right">Amount</th><th>Paid</th><th>Status</th></tr></thead>
            <tbody>
              {data && past.length === 0 && <tr><td colSpan={4} className="py-8 text-center text-muted">No payments yet.</td></tr>}
              {past.map((i) => (
                <tr key={i.id}>
                  <td><p className="font-semibold">{i.kind === 'device' ? 'IoT milk tester' : monthLabel(i.period_month)}</p><p className="text-[12.5px] text-muted">{i.description}</p></td>
                  <td className="num text-right font-semibold">{rs(i.amount)}</td>
                  <td className="num">{i.paid_at ? date(i.paid_at) : '—'}<p className="text-[12.5px] text-muted">{paymentLabel[i.payment_method] ?? ''}{i.payment_ref ? ` · ${i.payment_ref}` : ''}</p></td>
                  <td><Badge tone={i.status === 'paid' ? 'green' : 'grey'}>{i.status === 'paid' ? 'Paid' : 'Cancelled'}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {data?.notices?.length > 0 && (
        <Card className="mt-6" title="Warnings and notices" subtitle="ApnaDairy sends a warning every 30 days a bill stays unpaid, by email too.">
          <ul className="grid gap-2">
            {data.notices.map((n) => (
              <li key={n.id} className="rounded-2xl bg-cream px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Badge tone={n.kind === 'warning' ? 'amber' : n.kind === 'suspended' ? 'red' : 'green'}>{n.kind === 'warning' ? `Warning ${n.level}` : n.kind === 'suspended' ? 'Suspended' : 'Restored'}</Badge>
                  <span className="text-[12px] text-muted">{dateTime(n.created_at)}</span>
                </div>
                <p className="mt-1.5 text-[14px] font-semibold">{n.title}</p>
                {n.note && <p className="mt-0.5 text-[13px] text-muted">{n.note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <PaySheet key={paying?.id ?? 'closed'} invoice={paying} onClose={() => setPaying(null)} onPaid={reload} />
    </>
  )
}

// overdue: how long, what is paused, and when the account can be suspended
function DuesBanner({ d, seller }) {
  if (d.overdue_days == null) return null
  const paused = seller ? 'Bidding is paused' : 'Bidding and milk testing are paused'
  return (
    <div className={`mb-5 flex items-start gap-3 rounded-[20px] px-5 py-4 ${d.eligible ? 'bg-[#f8e2dc] text-danger' : 'bg-haldi-soft text-amber'}`} role="status">
      <span className="mt-0.5 shrink-0"><Icon name="alert" size={20} /></span>
      <div className="min-w-0 text-[14px]">
        <p className="font-semibold">{d.eligible ? 'Your account can be suspended' : `${rs(d.overdue_amount)} overdue for ${overdueText(d.overdue_days)}`}</p>
        <p className="mt-0.5 leading-relaxed">
          {d.eligible
            ? `${rs(d.overdue_amount)} has been unpaid since ${date(d.overdue_since)}. ApnaDairy can suspend your account now. Pay below to keep it.`
            : `${paused} until it is paid. If it is still unpaid on ${date(d.suspend_from)}, your account can be suspended.`}
          {d.payment_sent ? ' Your payment was sent and ApnaDairy is checking it.' : ''}
        </p>
      </div>
    </div>
  )
}
