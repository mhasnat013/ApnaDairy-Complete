import { useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { billingOverview, myInvoices, payInvoice, paymentLabel, monthLabel, rsShort, todayKey } from '../../lib/center'
import { rs, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'

const isOverdue = (i) => i.status === 'due' && i.due_date < todayKey()

export default function Billing() {
  const { center } = useOutletContext() ?? {}
  const seller = center?.type === 'byproduct'
  const { data, error, reload } = useLoad(async () => {
    const [o, invoices] = await Promise.all([billingOverview(), myInvoices()])
    return { o, invoices }
  })
  const [paying, setPaying] = useState(null)
  const o = data?.o
  const due = (data?.invoices ?? []).filter((i) => i.status === 'due')
  const past = (data?.invoices ?? []).filter((i) => i.status !== 'due')

  return (
    <>
      <PageHeader title="Billing" description={seller ? "Your ApnaDairy plan: the monthly platform fee only. Every rupee from your sales is yours." : "Your ApnaDairy plan: the IoT milk tester and the monthly platform fee. Every rupee from your milk sales is yours."} />
      <Alert>{error}</Alert>

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

      <PaySheet key={paying?.id ?? 'closed'} invoice={paying} onClose={() => setPaying(null)} onPaid={reload} />
    </>
  )
}

export function Breakdown({ i }) {
  const rows = []
  if (Number(i.device_fee)) rows.push(['IoT milk tester', rs(i.device_fee)])
  if (Number(i.subscription_fee)) {
    rows.push(['Platform fee', rs(i.subscription_fee)])
    if (i.discount_pct) rows.push([`${i.discount_pct}% off, for ${rsShort(i.sales_basis)} sales the month before`, `−${rs(Math.round(i.subscription_fee * i.discount_pct) / 100)}`])
  }
  // bills from before the subscription-only plan may still show a commission line
  if (Number(i.commission)) rows.push([`Commission ${Number(i.commission_pct)}% of ${rs(i.online_sales)} online orders`, rs(i.commission)])
  return (
    <dl className="mt-4 grid gap-1.5 rounded-2xl bg-cream px-4 py-3 text-[13.5px]">
      {rows.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt className="text-muted">{l}</dt><dd className="num shrink-0 font-medium">{v}</dd></div>)}
    </dl>
  )
}

function PaySheet({ invoice, onClose, onPaid }) {
  const { toast } = useUi()
  const [method, setMethod] = useState(invoice?.payment_method && invoice.payment_method !== 'cash' ? invoice.payment_method : 'jazzcash')
  const [ref, setRef] = useState(invoice?.payment_ref ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    if (!ref.trim()) return setErr('Enter the transaction ID from your payment.')
    setBusy(true); setErr('')
    try { await payInvoice(invoice.id, method, ref); toast('Payment sent. ApnaDairy confirms it once the money arrives.'); onPaid(); onClose() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Sheet open={!!invoice} onClose={onClose} title={`Pay ${invoice ? rs(invoice.amount) : ''}`} subtitle={invoice?.description}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send payment details'}</button></>}>
      <Alert>{err}</Alert>
      <p className="text-[13px] font-semibold">How did you pay?</p>
      <div className="mt-2 grid gap-2">
        {['jazzcash', 'easypaisa', 'bank'].map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all ${method === m ? 'border-forest bg-mint-soft ring-2 ring-forest/15' : 'border-line bg-white hover:border-forest/40'}`}>
            <span className="font-semibold">{paymentLabel[m]}</span>
            <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${method === m ? 'border-forest' : 'border-line'}`}>{method === m && <span className="h-2.5 w-2.5 rounded-full bg-forest" />}</span>
          </button>
        ))}
      </div>
      <div className="field mt-5"><label htmlFor="ref">Transaction ID</label><input id="ref" className="input" placeholder="e.g. 0123456789" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-[12.5px] text-muted">Pay ApnaDairy by JazzCash, EasyPaisa or bank transfer, then enter the transaction ID here. ApnaDairy checks it and marks the bill paid. To pay cash, visit the ApnaDairy office.</p>
    </Sheet>
  )
}
