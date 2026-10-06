import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  adminInvoices, platformSettings, savePlatformSettings, adminCenterFees, setFeeDiscount, generateInvoices, voidInvoice, payInvoice,
  paymentLabel, monthLabel, rsShort, todayKey,
} from '../../lib/center'
import { rs, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'

const overdue = (i) => i.status === 'due' && i.due_date < todayKey()

const GROUPS = [
  ['Subscription', [['device_price', 'IoT device', 'Rs'], ['monthly_fee', 'Monthly fee', 'Rs'], ['payment_days', 'Days to pay', 'days']]],
  ['Fair pricing (% of the AI market rate for farmers, % above cost for shops)', [['farmer_min_pct', 'Farmer, minimum', '%'], ['farmer_default_pct', 'Farmer, suggested', '%'],
    ['markup_suggest_pct', 'Shop markup, suggested', '%'], ['markup_max_pct', 'Shop markup, maximum', '%']]],
  ['Customer orders on the app (milk per order)', [['order_min_l', 'Smallest order', 'L'], ['order_max_l', 'Largest order', 'L']]],
]

export default function AdminBilling() {
  const { toast, confirm } = useUi()
  const { data, error, reload } = useLoad(async () => {
    const [invoices, settings] = await Promise.all([adminInvoices(), platformSettings()])
    return { invoices, settings }
  })
  const [view, setView] = useState('due')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)

  const inv = data?.invoices ?? []
  const s = form ?? data?.settings ?? {}
  const month = todayKey().slice(0, 7)
  const collected = inv.filter((i) => i.status === 'paid' && i.paid_at?.slice(0, 7) === month).reduce((n, i) => n + Number(i.amount), 0)
  const outstanding = inv.filter((i) => i.status === 'due').reduce((n, i) => n + Number(i.amount), 0)
  const late = inv.filter(overdue)
  const devices = inv.filter((i) => i.kind === 'device' && i.status !== 'void')
  const list = inv.filter((i) => view === 'all' || (view === 'overdue' ? overdue(i) : i.status === view))

  const saveSettings = async () => {
    if (Number(s.order_min_l) <= 0 || Number(s.order_max_l) < Number(s.order_min_l)) return toast('The largest order must be at least the smallest order, and both above 0.', 'error')
    if (Number(s.farmer_min_pct) > Number(s.farmer_default_pct)) return toast('The suggested farmer share cannot be below the minimum.', 'error')
    if (Number(s.markup_suggest_pct) > Number(s.markup_max_pct)) return toast('The suggested shop markup cannot be above the maximum.', 'error')
    setBusy(true)
    try { await savePlatformSettings(s); toast('Settings saved. They apply to new offers, prices and bills.'); setForm(null); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const bill = async () => {
    const label = monthLabel(`${month}-01`)
    if (!(await confirm({ title: `Create ${label} bills?`, body: 'Every approved seller without a bill for this month gets one: the monthly fee minus the discount you gave them. ApnaDairy takes nothing from sales.', confirmLabel: 'Create bills' }))) return
    try { const n = await generateInvoices(); toast(n ? `${n} bills created.` : 'Every center already has a bill for this month.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  const cash = async (i) => {
    if (!(await confirm({ title: `Record ${rs(i.amount)} from ${i.center_name}?`, body: 'Use this when the center paid in cash or by bank at the office.', confirmLabel: 'Mark paid' }))) return
    try { await payInvoice(i.id, 'cash'); toast('Marked as paid.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  // the center sent a transaction id; the admin checks the money arrived
  const confirmPaid = async (i) => {
    if (!(await confirm({ title: `Confirm ${rs(i.amount)} from ${i.center_name}?`, body: `They paid by ${paymentLabel[i.payment_method]}, transaction ID ${i.payment_ref}. Confirm only after checking it reached ApnaDairy's account.`, confirmLabel: 'Mark paid' }))) return
    try { await payInvoice(i.id, i.payment_method, i.payment_ref); toast('Marked as paid.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  const cancel = async (i) => {
    if (!(await confirm({ title: 'Cancel this bill?', body: `${i.description} for ${i.center_name}.`, confirmLabel: 'Cancel bill', danger: true, cancelLabel: 'Keep it' }))) return
    try { await voidInvoice(i.id); toast('Bill cancelled.'); await reload() } catch (e) { toast(e.message, 'error') }
  }

  const dirty = form && data?.settings && Object.keys(form).some((k) => String(form[k]) !== String(data.settings[k]))

  return (
    <>
      <PageHeader title="Billing" description="ApnaDairy earns from two things only: the IoT device and the monthly fee. Milk sales stay with the centers.">
        <button className="btn-primary" onClick={bill}><Icon name="plus" size={17} />Create {monthLabel(`${month}-01`).split(' ')[0]} bills</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Collected this month" value={data ? rs(Math.round(collected)) : null} icon={<Icon name="wallet" size={16} />} />
        <Kpi label="Waiting to be paid" value={data ? rs(Math.round(outstanding)) : null} note={(() => { const n = inv.filter((i) => i.status === 'due').length; return `${n} ${n === 1 ? 'bill' : 'bills'}` })()} />
        <Kpi label="Overdue centers" value={data ? new Set(late.map((i) => i.area_manager_id)).size : null} note="bidding and testing paused" />
        <Kpi label="Devices paid for" value={data ? devices.filter((i) => i.status === 'paid').length : null} note={data ? `of ${devices.length} device ${devices.length === 1 ? 'bill' : 'bills'}` : ''} />
      </div>

      <Card className="mt-5" title="Bills" bodyClass="pt-3"
        action={<Segmented size="sm" value={view} onChange={setView} options={[
          { value: 'due', label: 'Due', count: data ? inv.filter((i) => i.status === 'due').length : null },
          { value: 'overdue', label: 'Overdue', count: data ? late.length : null },
          { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]} />}>
        <div className="overflow-x-auto">
          <table className="table min-w-[860px]">
            <thead><tr><th>Center</th><th>Bill</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th className="text-right"></th></tr></thead>
            <tbody>
              {data && list.length === 0 && <tr><td colSpan={6}><EmptyState title="No bills here" /></td></tr>}
              {list.map((i) => (
                <tr key={i.id}>
                  <td><p className="font-semibold">{i.center_name}</p><p className="text-[12.5px] text-muted">{i.city}</p></td>
                  <td><p className="font-medium">{i.kind === 'device' ? 'IoT device' : monthLabel(i.period_month)}</p>
                    <p className="text-[12.5px] text-muted">{i.kind === 'monthly' ? (i.discount_pct ? `${i.discount_pct}% discount` : 'monthly fee') : 'one-time'}</p></td>
                  <td className="num text-right font-semibold">{rs(i.amount)}</td>
                  <td className={`num ${overdue(i) ? 'font-semibold text-danger' : ''}`}>{date(i.due_date)}</td>
                  <td>{i.status === 'paid' ? <><Badge tone="green">Paid</Badge><p className="mt-1 text-[12px] text-muted">{paymentLabel[i.payment_method]} · {date(i.paid_at)}</p></>
                    : i.status === 'void' ? <Badge tone="grey">Cancelled</Badge> : i.submitted_at ? <><Badge tone="blue">Payment sent</Badge><p className="mt-1 text-[12px] text-muted">{paymentLabel[i.payment_method]} · {i.payment_ref}</p></> : <Badge tone={overdue(i) ? 'red' : 'amber'}>{overdue(i) ? 'Overdue' : 'Due'}</Badge>}</td>
                  <td>{i.status === 'due' && (
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {i.submitted_at
                        ? <button className="btn-primary btn-sm" onClick={() => confirmPaid(i)} title={`${paymentLabel[i.payment_method]} ${i.payment_ref}`}>Confirm {paymentLabel[i.payment_method]}</button>
                        : <button className="btn-secondary btn-sm" onClick={() => cash(i)}>Record cash</button>}
                      <button className="btn-ghost btn-sm text-danger" onClick={() => cancel(i)}>Cancel</button>
                    </div>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Platform rules" subtitle="Changes apply to new offers, price checks and bills">
          <div className="grid gap-5">
            {GROUPS.map(([title, fields]) => (
              <fieldset key={title}>
                <legend className="mb-2 text-[13px] font-semibold text-forest-deep">{title}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {fields.map(([k, label, unit]) => (
                    <label key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-2.5">
                      <span className="text-[13.5px]">{label}</span>
                      <span className="flex items-center gap-1.5">
                        {unit === 'Rs' && <span className="text-[13px] text-muted">Rs</span>}
                        <input className="input num h-10 w-24 text-right font-semibold" type="number" min="0" step="any" value={s[k] ?? ''}
                          onChange={(e) => setForm({ ...s, [k]: e.target.value })} aria-label={label} />
                        {unit !== 'Rs' && <span className="w-8 text-[12px] text-muted">{unit}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <button className="btn-primary mt-5 w-full" disabled={!dirty || busy} onClick={saveSettings}>Save rules</button>
        </Card>

        <Discounts />
      </div>
    </>
  )
}

// one plan for every seller; the admin rewards high sales with a discount on the monthly fee
function Discounts() {
  const { toast } = useUi()
  const { data, error, reload } = useLoad(adminCenterFees)
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(null)
  const save = async (c) => {
    const v = Number(edits[c.id])
    if (!(v >= 0 && v <= 90) || !Number.isInteger(v)) return toast('Discount must be a whole number from 0 to 90.', 'error')
    setBusy(c.id)
    try { await setFeeDiscount(c.id, v); toast(v ? `${c.center_name} gets ${v}% off from the next bill.` : `${c.center_name} pays the full fee from the next bill.`); setEdits((e) => { const n = { ...e }; delete n[c.id]; return n }); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }
  return (
    <Card title="Discounts" subtitle="Every seller pays the same monthly fee. Give a discount to sellers with high sales; it applies from their next bill." bodyClass="pt-3">
      <Alert>{error}</Alert>
      <div className="overflow-x-auto">
        <table className="table min-w-[460px]">
          <thead><tr><th>Seller</th><th className="text-right">Sales last month</th><th className="text-right">Discount</th></tr></thead>
          <tbody>
            {!data && <tr><td colSpan={3}><div className="skeleton h-16" /></td></tr>}
            {data?.length === 0 && <tr><td colSpan={3} className="py-6 text-center text-muted">No approved sellers yet.</td></tr>}
            {(data ?? []).map((c) => {
              const v = edits[c.id] ?? String(c.fee_discount_pct)
              const changed = String(v) !== String(c.fee_discount_pct)
              return (
                <tr key={c.id}>
                  <td><p className="font-semibold">{c.center_name}</p><p className="text-[12.5px] text-muted">{c.type === 'byproduct' ? 'Dairy products' : 'Milk center'} · {c.city}</p></td>
                  <td className="num text-right">{rs(Math.round(c.last_month_sales ?? 0))}<p className="text-[12px] text-muted">this month {rs(Math.round(c.this_month_sales ?? 0))}</p></td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <input className="input num h-9 w-16 text-right" type="number" min="0" max="90" value={v} aria-label={`Discount for ${c.center_name}`}
                        onChange={(e) => setEdits({ ...edits, [c.id]: e.target.value })} />
                      <span className="text-[12px] text-muted">%</span>
                      {changed && <button className="btn-primary btn-sm" disabled={busy === c.id} onClick={() => save(c)}>Save</button>}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}
