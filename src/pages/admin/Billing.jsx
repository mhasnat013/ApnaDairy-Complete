import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  adminInvoices, platformSettings, savePlatformSettings, generateInvoices, voidInvoice, payInvoice,
  paymentLabel, monthLabel, todayKey, runBillingChecks, billingAccounts, setSellerStatus, billingNotices, centerInvoices, overdueText,
} from '../../lib/center'
import { rs, date, dateTime } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'
import { numberError } from '../../lib/validate'

const overdue = (i) => i.status === 'due' && i.due_date < todayKey()
const sellerType = { milk_center: 'Milk center', byproduct: 'Product seller' }

const GROUPS = [
  ['Subscription', [['device_price', 'IoT device', 'Rs'], ['monthly_fee', 'Monthly fee', 'Rs'], ['payment_days', 'Days to pay', 'days'], ['suspend_after_months', 'Can be suspended after', 'months']]],
  ['Fair pricing (% of the AI market rate for farmers, % above cost for shops)', [['farmer_min_pct', 'Farmer, minimum', '%'], ['farmer_default_pct', 'Farmer, suggested', '%'],
    ['markup_suggest_pct', 'Shop markup, suggested', '%'], ['markup_max_pct', 'Shop markup, maximum', '%']]],
  ['Discount for high sellers (on next month’s fee, for every seller who reaches it)', [['discount_min_sales', 'Monthly sales from', 'Rs'], ['discount_pct', 'Discount', '%']]],
  ['Customer orders on the app (milk per order)', [['order_min_l', 'Smallest order', 'L'], ['order_max_l', 'Largest order', 'L']]],
]

export default function AdminBilling() {
  const { toast, confirm } = useUi()
  const [params, setParams] = useSearchParams()
  const tab = ['bills', 'rules'].includes(params.get('tab')) ? params.get('tab') : 'sellers'
  const { data, error, reload } = useLoad(async () => {
    await runBillingChecks().catch(() => {})   // this month's bills and any warnings due today
    const [invoices, settings, accounts] = await Promise.all([adminInvoices(), platformSettings(), billingAccounts()])
    return { invoices, settings, accounts }
  })
  const [view, setView] = useState('due')
  const [who, setWho] = useState('all')
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)        // seller whose details are open
  const [acting, setActing] = useState(null)    // { seller, suspend }

  const inv = data?.invoices ?? []
  const accounts = data?.accounts ?? []
  const s = form ?? data?.settings ?? {}
  const month = todayKey().slice(0, 7)
  const collected = inv.filter((i) => i.status === 'paid' && i.paid_at?.slice(0, 7) === month).reduce((n, i) => n + Number(i.amount), 0)
  const outstanding = inv.filter((i) => i.status === 'due').reduce((n, i) => n + Number(i.amount), 0)
  const devices = inv.filter((i) => i.kind === 'device' && i.status !== 'void')
  const list = inv.filter((i) => view === 'all' || (view === 'overdue' ? overdue(i) : i.status === view))

  const isLate = (a) => a.account_status === 'active' && a.dues.overdue_days != null
  const isEligible = (a) => a.account_status === 'active' && a.dues.eligible
  const sellers = accounts.filter((a) => who === 'all' || (who === 'overdue' ? isLate(a) : who === 'eligible' ? isEligible(a) : a.account_status === 'suspended'))
  const lateCount = accounts.filter(isLate).length
  const eligibleCount = accounts.filter(isEligible).length

  const saveSettings = async () => {
    for (const [, fields] of GROUPS) for (const [k, label, unit] of fields) {
      const max = unit === '%' ? 300 : unit === 'days' ? 60 : unit === 'months' ? 12 : unit === 'L' ? 1000 : 100000000
      const bad = numberError(s[k], { min: unit === 'Rs' && k !== 'discount_min_sales' ? 0 : unit === '%' ? 0 : 1, max, whole: unit === 'days' || unit === 'months', what: label.toLowerCase() })
      if (bad) return toast(bad, 'error')
    }
    if (Number(s.farmer_min_pct) > 100 || Number(s.farmer_default_pct) > 100) return toast('The farmer share cannot be more than 100%.', 'error')
    if (!(Number(s.discount_pct) >= 0 && Number(s.discount_pct) <= 90)) return toast('The discount can be 0 to 90%.', 'error')
    if (Number(s.order_min_l) <= 0 || Number(s.order_max_l) < Number(s.order_min_l)) return toast('The largest order must be at least the smallest order, and both above 0.', 'error')
    if (Number(s.farmer_min_pct) > Number(s.farmer_default_pct)) return toast('The suggested farmer share cannot be below the minimum.', 'error')
    if (Number(s.markup_suggest_pct) > Number(s.markup_max_pct)) return toast('The suggested shop markup cannot be above the maximum.', 'error')
    setBusy(true)
    try { await savePlatformSettings(s); toast('Settings saved. They apply to new offers, prices and bills.'); setForm(null); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const bill = async () => {
    const label = monthLabel(`${month}-01`)
    if (!(await confirm({ title: `Create ${label} bills?`, body: 'Bills are created automatically on the 1st. This creates any that are missing: the monthly fee, with the discount for sellers whose sales last month reached the limit.', confirmLabel: 'Create bills' }))) return
    try { const n = await generateInvoices(); toast(n ? `${n} bills created.` : 'Every seller already has a bill for this month.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  // a suspended seller who has now paid everything overdue: offer to restore them
  const afterPaid = async (i) => {
    const fresh = await billingAccounts().catch(() => null)
    const a = fresh?.find((x) => x.center_id === i.area_manager_id)
    await reload()
    if (a?.account_status === 'suspended' && a.dues.overdue_days == null) {
      if (await confirm({ title: `Restore ${a.center_name}?`, body: 'Nothing is overdue any more. Restoring opens their portal again and tells them by email.', confirmLabel: 'Restore account', cancelLabel: 'Not now' })) {
        try { await setSellerStatus(a.center_id, false, 'Overdue bills paid'); toast(`${a.center_name} restored.`); await reload() } catch (e) { toast(e.message, 'error') }
      }
    }
  }
  const cash = async (i) => {
    if (!(await confirm({ title: `Record ${rs(i.amount)} from ${i.center_name}?`, body: 'Use this when the seller paid in cash or by bank at the office.', confirmLabel: 'Mark paid' }))) return
    try { await payInvoice(i.id, 'cash'); toast('Marked as paid. The seller is told.'); await afterPaid(i) } catch (e) { toast(e.message, 'error') }
  }
  // the seller sent a transaction id; the admin checks the money arrived
  const confirmPaid = async (i) => {
    if (!(await confirm({ title: `Confirm ${rs(i.amount)} from ${i.center_name}?`, body: `They paid by ${paymentLabel[i.payment_method]}, transaction ID ${i.payment_ref}. Confirm only after checking it reached ApnaDairy's account.`, confirmLabel: 'Mark paid' }))) return
    try { await payInvoice(i.id, i.payment_method, i.payment_ref); toast('Marked as paid. The seller is told.'); await afterPaid(i) } catch (e) { toast(e.message, 'error') }
  }
  const cancel = async (i) => {
    if (!(await confirm({ title: 'Cancel this bill?', body: `${i.description} for ${i.center_name}.`, confirmLabel: 'Cancel bill', danger: true, cancelLabel: 'Keep it' }))) return
    try { await voidInvoice(i.id); toast('Bill cancelled.'); await reload() } catch (e) { toast(e.message, 'error') }
  }

  const dirty = form && data?.settings && Object.keys(form).some((k) => String(form[k]) !== String(data.settings[k]))

  return (
    <>
      <PageHeader title="Billing" description="ApnaDairy earns from two things only: the IoT device and the monthly fee. Milk sales stay with the sellers.">
        <button className="btn-secondary" onClick={bill}><Icon name="plus" size={17} />Create {monthLabel(`${month}-01`).split(' ')[0]} bills</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Collected this month" value={data ? rs(Math.round(collected)) : null} icon={<Icon name="wallet" size={16} />} />
        <Kpi label="Waiting to be paid" value={data ? rs(Math.round(outstanding)) : null} note={(() => { const n = inv.filter((i) => i.status === 'due').length; return `${n} ${n === 1 ? 'bill' : 'bills'}` })()} />
        <Kpi label="Overdue sellers" value={data ? lateCount : null} note={data ? (eligibleCount ? `${eligibleCount} can be suspended` : 'bidding and testing paused') : ''} />
        <Kpi label="Devices paid for" value={data ? devices.filter((i) => i.status === 'paid').length : null} note={data ? `of ${devices.length} device ${devices.length === 1 ? 'bill' : 'bills'}` : ''} />
      </div>

      <div className="mt-5">
        <Segmented value={tab} onChange={(v) => setParams(v === 'sellers' ? {} : { tab: v })} options={[
          { value: 'sellers', label: 'Sellers', count: data && eligibleCount ? eligibleCount : null },
          { value: 'bills', label: 'Bills', count: data ? inv.filter((i) => i.status === 'due' && i.submitted_at).length || null : null },
          { value: 'rules', label: 'Rules' }]} />
      </div>

      {tab === 'sellers' && (
        <Card className="mt-4" title="Sellers" subtitle={data ? `A warning goes out every 30 days a bill is overdue. After ${data.settings.suspend_after_months} ${Number(data.settings.suspend_after_months) === 1 ? 'month' : 'months'} the seller can be suspended. You decide.` : ''} bodyClass="pt-3"
          action={<Segmented size="sm" value={who} onChange={setWho} options={[
            { value: 'all', label: 'All' },
            { value: 'overdue', label: 'Overdue', count: data ? lateCount : null },
            { value: 'eligible', label: 'Can be suspended', count: data ? eligibleCount : null },
            { value: 'suspended', label: 'Suspended', count: data ? accounts.filter((a) => a.account_status === 'suspended').length : null }]} />}>
          <div className="overflow-x-auto">
            <table className="table min-w-[1060px]">
              <thead><tr><th>Seller</th><th>Account</th><th className="text-right">Outstanding</th><th>Due date</th><th>Overdue</th><th className="text-right">Paid so far</th><th></th></tr></thead>
              <tbody>
                {data && sellers.length === 0 && <tr><td colSpan={7}><EmptyState title="No sellers here" /></td></tr>}
                {sellers.map((a) => {
                  const d = a.dues
                  return (
                    <tr key={a.center_id}>
                      <td><button className="text-left font-semibold hover:text-forest hover:underline" onClick={() => setOpen(a)}>{a.center_name}</button>
                        <p className="text-[12.5px] text-muted">{sellerType[a.type]}{a.city ? `, ${a.city}` : ''}</p></td>
                      <td className="whitespace-nowrap"><AccountBadge a={a} /></td>
                      <td className="num text-right"><p className="font-semibold">{rs(d.outstanding)}</p>
                        <p className="text-[12px] text-muted">{d.due_bills ? `${d.due_bills} ${d.due_bills === 1 ? 'bill' : 'bills'}` : 'paid up'}</p>
                        {d.payment_sent && <p className="text-[12px] font-semibold text-[#2b5866]">Payment sent</p>}</td>
                      <td className={`num whitespace-nowrap ${d.next_due && d.next_due < todayKey() ? 'font-semibold text-danger' : ''}`}>{d.next_due ? date(d.next_due) : '—'}</td>
                      <td>{d.overdue_days != null
                        ? <><p className="num whitespace-nowrap font-semibold text-danger">{overdueText(d.overdue_days)}</p><p className="text-[12px] text-muted">{rs(d.overdue_amount)}{d.warnings ? ` · ${d.warnings} ${d.warnings === 1 ? 'warning' : 'warnings'}` : ''}</p></>
                        : <span className="text-muted">—</span>}</td>
                      <td className="num text-right">{rs(d.paid)}<p className="text-[12px] text-muted">{d.last_paid_at ? `last ${date(d.last_paid_at)}` : 'nothing yet'}</p></td>
                      <td>
                        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                          <button className="btn-ghost btn-sm" onClick={() => setOpen(a)}>Details</button>
                          {a.account_status === 'active' && d.overdue_days != null && <button className={`${d.eligible ? 'btn-danger' : 'btn-secondary'} btn-sm`} onClick={() => setActing({ seller: a, suspend: true })}>Suspend</button>}
                          {a.account_status === 'suspended' && <button className="btn-primary btn-sm" onClick={() => setActing({ seller: a, suspend: false })}>Restore</button>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'bills' && (
        <Card className="mt-4" title="Bills" bodyClass="pt-3"
          action={<Segmented size="sm" value={view} onChange={setView} options={[
            { value: 'due', label: 'Due', count: data ? inv.filter((i) => i.status === 'due').length : null },
            { value: 'overdue', label: 'Overdue', count: data ? inv.filter(overdue).length : null },
            { value: 'paid', label: 'Paid' }, { value: 'all', label: 'All' }]} />}>
          <div className="overflow-x-auto">
            <table className="table min-w-[860px]">
              <thead><tr><th>Seller</th><th>Bill</th><th className="text-right">Amount</th><th>Due</th><th>Status</th><th className="text-right"></th></tr></thead>
              <tbody>
                {data && list.length === 0 && <tr><td colSpan={6}><EmptyState title="No bills here" /></td></tr>}
                {list.map((i) => (
                  <tr key={i.id}>
                    <td><p className="font-semibold">{i.center_name}</p><p className="text-[12.5px] text-muted">{i.city}</p></td>
                    <td><p className="font-medium">{i.kind === 'device' ? 'IoT device' : monthLabel(i.period_month)}</p>
                      <p className="text-[12.5px] text-muted">{i.kind === 'monthly' ? (i.discount_pct ? `${i.discount_pct}% discount` : 'monthly fee') : 'one-time'}</p></td>
                    <td className="num text-right font-semibold">{rs(i.amount)}</td>
                    <td className={`num ${overdue(i) ? 'font-semibold text-danger' : ''}`}>{date(i.due_date)}</td>
                    <td><BillStatus i={i} /></td>
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
      )}

      {tab === 'rules' && (
        <Card className="mt-4" title="Platform rules" subtitle="Changes apply to new offers, price checks, bills and warnings">
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
                        <input className={`input num h-10 text-right font-semibold ${unit === 'Rs' ? 'w-32' : 'w-24'}`} type="number" inputMode="decimal" min="0" step="any" value={s[k] ?? ''}
                          onChange={(e) => setForm({ ...s, [k]: e.target.value })} aria-label={label} />
                        {unit !== 'Rs' && <span className="w-12 text-[12px] text-muted">{unit}</span>}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-[12.5px] text-muted">“Can be suspended after” counts months from a bill’s due date. Sellers are warned every 30 days until then; suspending stays your decision.</p>
          <button className="btn-primary mt-5 w-full" disabled={!dirty || busy} onClick={saveSettings}>Save rules</button>
        </Card>
      )}

      {open && <SellerSheet seller={open} onClose={() => setOpen(null)} onAct={(suspend) => setActing({ seller: open, suspend })} />}
      {acting && <StatusSheet {...acting} onClose={() => setActing(null)} onDone={() => { setActing(null); setOpen(null); reload() }} />}
    </>
  )
}

function AccountBadge({ a }) {
  if (a.account_status === 'suspended') return <Badge tone="grey">Suspended</Badge>
  if (a.dues.eligible) return <Badge tone="red">Can be suspended</Badge>
  if (a.dues.overdue_days != null) return <Badge tone="amber">Overdue</Badge>
  return <Badge tone="green">Active</Badge>
}

function BillStatus({ i }) {
  if (i.status === 'paid') return <><Badge tone="green">Paid</Badge><p className="mt-1 text-[12px] text-muted">{paymentLabel[i.payment_method]} · {date(i.paid_at)}</p></>
  if (i.status === 'void') return <Badge tone="grey">Cancelled</Badge>
  if (i.submitted_at) return <><Badge tone="blue">Payment sent</Badge><p className="mt-1 text-[12px] text-muted">{paymentLabel[i.payment_method]} · {i.payment_ref}</p></>
  return <Badge tone={overdue(i) ? 'red' : 'amber'}>{overdue(i) ? 'Overdue' : 'Due'}</Badge>
}

const noticeTone = { warning: 'amber', suspended: 'red', restored: 'green' }

// one seller: totals, every bill and every warning
function SellerSheet({ seller, onClose, onAct }) {
  const d = seller.dues
  const { data, error } = useLoad(async () => {
    const [bills, notices] = await Promise.all([centerInvoices(seller.center_id), billingNotices(seller.center_id)])
    return { bills, notices }
  }, [seller.center_id])
  const stats = [
    ['Billed', rs(d.billed)], ['Paid', rs(d.paid)], ['Outstanding', rs(d.outstanding)],
    ['Due date', d.next_due ? date(d.next_due) : '—'],
    ['Overdue', d.overdue_days != null ? overdueText(d.overdue_days) : 'Nothing'],
    ['Warnings sent', d.warnings],
  ]
  return (
    <Sheet open onClose={onClose} title={seller.center_name} subtitle={`${sellerType[seller.type]}${seller.city ? `, ${seller.city}` : ''} · ${seller.owner_name ?? ''}${seller.phone ? `, ${seller.phone}` : ''}`}
      footer={<>
        <button className="btn-secondary" onClick={onClose}>Close</button>
        {seller.account_status === 'active' && d.overdue_days != null && <button className="btn-danger" onClick={() => onAct(true)}>Suspend</button>}
        {seller.account_status === 'suspended' && <button className="btn-primary" onClick={() => onAct(false)}>Restore</button>}
      </>}>
      <Alert>{error}</Alert>
      <div className="flex flex-wrap items-center gap-2"><AccountBadge a={seller} />
        {seller.account_status === 'active' && d.overdue_days != null && (
          <span className="text-[13px] text-muted">{d.eligible ? `Unpaid for ${d.suspend_after}+ months.` : `Can be suspended from ${date(d.suspend_from)}.`}</span>)}
      </div>
      {seller.account_status === 'suspended' && seller.reason && <p className="mt-3 rounded-2xl bg-cream px-4 py-3 text-[13px]"><b>Reason given: </b>{seller.reason}</p>}
      <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-2xl bg-cream px-3 py-2.5"><dt className="text-[12px] text-muted">{k}</dt><dd className={`num mt-0.5 font-semibold ${k === 'Overdue' && d.overdue_days != null ? 'text-danger' : ''}`}>{v}</dd></div>
        ))}
      </dl>

      <h3 className="mt-6 text-[14px] font-semibold text-forest-deep">Bills and payments</h3>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line">
        {!data && <li className="px-4 py-3 text-[13px] text-muted">Loading…</li>}
        {data?.bills.length === 0 && <li className="px-4 py-3 text-[13px] text-muted">No bills yet.</li>}
        {data?.bills.map((i) => (
          <li key={i.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0"><p className="text-[14px] font-medium">{i.kind === 'device' ? 'IoT device' : monthLabel(i.period_month)}</p>
              <p className={`text-[12px] ${overdue(i) ? 'font-semibold text-danger' : 'text-muted'}`}>Due {date(i.due_date)}{i.paid_at ? `, paid ${date(i.paid_at)}` : ''}</p></div>
            <div className="shrink-0 text-right"><p className="num font-semibold">{rs(i.amount)}</p><div className="mt-1"><BillStatus i={i} /></div></div>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-[14px] font-semibold text-forest-deep">Warnings and actions</h3>
      <ul className="mt-2 grid gap-2">
        {data?.notices.length === 0 && <li className="rounded-2xl bg-cream px-4 py-3 text-[13px] text-muted">No warnings sent.</li>}
        {data?.notices.map((n) => (
          <li key={n.id} className="rounded-2xl bg-cream px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge tone={noticeTone[n.kind]}>{n.kind === 'warning' ? `Warning ${n.level}` : n.kind === 'suspended' ? 'Suspended' : 'Restored'}</Badge>
              <span className="text-[12px] text-muted">{dateTime(n.created_at)}</span>
            </div>
            <p className="mt-1.5 text-[13.5px] font-semibold">{n.title}</p>
            {n.note && <p className="mt-0.5 text-[13px] text-muted">{n.note}</p>}
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

// suspend (reason required, shown to the seller) or restore
function StatusSheet({ seller, suspend, onClose, onDone }) {
  const { toast } = useUi()
  const d = seller.dues
  const [reason, setReason] = useState(suspend
    ? `Unpaid bills: ${rs(d.overdue_amount)} overdue since ${date(d.overdue_since)}.`
    : d.overdue_days == null ? 'Overdue bills paid.' : '')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (suspend && reason.trim().length < 5) return toast('Write the reason. The seller sees it.', 'error')
    setBusy(true)
    try { await setSellerStatus(seller.center_id, suspend, reason.trim()); toast(suspend ? `${seller.center_name} suspended. They were told why.` : `${seller.center_name} restored. They were told.`); onDone() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <Sheet open onClose={onClose} title={suspend ? `Suspend ${seller.center_name}?` : `Restore ${seller.center_name}?`}
      subtitle={suspend ? 'They lose access to the portal and the app until you restore them. Their bills stay, and they can still pay.' : 'Their portal opens again and they are told by email.'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className={suspend ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={save}>{busy ? 'Saving…' : suspend ? 'Suspend' : 'Restore account'}</button></>}>
      {!suspend && d.overdue_days != null && <p className="mb-4 rounded-2xl bg-haldi-soft px-4 py-3 text-[13px] text-amber">{rs(d.overdue_amount)} is still overdue. Bidding stays paused until it is paid.</p>}
      {suspend && !d.eligible && <p className="mb-4 rounded-2xl bg-haldi-soft px-4 py-3 text-[13px] text-amber">Overdue {overdueText(d.overdue_days)}, less than the {d.suspend_after}-month limit. You can still suspend if you need to.</p>}
      <div className="field">
        <label htmlFor="sr">{suspend ? 'Reason (the seller sees this)' : 'Note (optional, kept in the history)'}</label>
        <textarea id="sr" rows={3} maxLength={300} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </Sheet>
  )
}
