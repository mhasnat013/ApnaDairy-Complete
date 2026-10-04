import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  adminInvoices, platformSettings, billingTiers, savePlatformSettings, saveTier, generateInvoices, voidInvoice, payInvoice,
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
  ['ApnaDairy commission on app and bulk orders', [['commission_pct', 'Commission', '%']]],
]

export default function AdminBilling() {
  const { toast, confirm } = useUi()
  const { data, error, reload } = useLoad(async () => {
    const [invoices, settings, tiers] = await Promise.all([adminInvoices(), platformSettings(), billingTiers()])
    return { invoices, settings, tiers }
  })
  const [view, setView] = useState('due')
  const [form, setForm] = useState(null)
  const [tierEdits, setTierEdits] = useState({})
  const [busy, setBusy] = useState(false)

  const inv = data?.invoices ?? []
  const s = form ?? data?.settings ?? {}
  const month = todayKey().slice(0, 7)
  const collected = inv.filter((i) => i.status === 'paid' && i.paid_at?.slice(0, 7) === month).reduce((n, i) => n + Number(i.amount), 0)
  const outstanding = inv.filter((i) => i.status === 'due').reduce((n, i) => n + Number(i.amount), 0)
  const late = inv.filter(overdue)
  const commission = inv.filter((i) => i.status !== 'void' && i.period_month?.slice(0, 7) === month).reduce((n, i) => n + Number(i.commission), 0)
  const list = inv.filter((i) => view === 'all' || (view === 'overdue' ? overdue(i) : i.status === view))

  const saveSettings = async () => {
    setBusy(true)
    try { await savePlatformSettings(s); toast('Settings saved. They apply to new offers, prices and bills.'); setForm(null); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const saveTiers = async () => {
    setBusy(true)
    try { for (const t of Object.values(tierEdits)) await saveTier(t); toast('Discount tiers saved.'); setTierEdits({}); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const bill = async () => {
    const label = monthLabel(`${month}-01`)
    if (!(await confirm({ title: `Create ${label} bills?`, body: 'Every approved center without a bill for this month gets one: the platform fee after its discount, plus commission on last month’s online orders.', confirmLabel: 'Create bills' }))) return
    try { const n = await generateInvoices(); toast(n ? `${n} bills created.` : 'Every center already has a bill for this month.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  const cash = async (i) => {
    if (!(await confirm({ title: `Record ${rs(i.amount)} from ${i.center_name}?`, body: 'Use this when the center paid in cash or by bank at the office.', confirmLabel: 'Mark paid' }))) return
    try { await payInvoice(i.id, 'cash'); toast('Marked as paid.'); await reload() } catch (e) { toast(e.message, 'error') }
  }
  const cancel = async (i) => {
    if (!(await confirm({ title: 'Cancel this bill?', body: `${i.description} for ${i.center_name}.`, confirmLabel: 'Cancel bill', danger: true, cancelLabel: 'Keep it' }))) return
    try { await voidInvoice(i.id); toast('Bill cancelled.'); await reload() } catch (e) { toast(e.message, 'error') }
  }

  const dirty = form && data?.settings && Object.keys(form).some((k) => String(form[k]) !== String(data.settings[k]))

  return (
    <>
      <PageHeader title="Billing" description="Device sales, monthly fees and commission from every milk center, plus the pricing rules the whole platform follows.">
        <button className="btn-primary" onClick={bill}><Icon name="plus" size={17} />Create {monthLabel(`${month}-01`).split(' ')[0]} bills</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Collected this month" value={data ? rs(Math.round(collected)) : null} icon={<Icon name="wallet" size={16} />} />
        <Kpi label="Waiting to be paid" value={data ? rs(Math.round(outstanding)) : null} note={(() => { const n = inv.filter((i) => i.status === 'due').length; return `${n} ${n === 1 ? 'bill' : 'bills'}` })()} />
        <Kpi label="Overdue centers" value={data ? new Set(late.map((i) => i.area_manager_id)).size : null} note="bidding and testing paused" />
        <Kpi label="Commission this month" value={data ? rs(Math.round(commission)) : null} note="billed on last month’s online orders" />
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
                    <p className="text-[12.5px] text-muted">{i.kind === 'monthly' ? `${i.tier}${i.discount_pct ? ` ${i.discount_pct}% off` : ''}${Number(i.commission) ? ` · commission ${rs(Math.round(i.commission))}` : ''}` : 'one-time'}</p></td>
                  <td className="num text-right font-semibold">{rs(i.amount)}</td>
                  <td className={`num ${overdue(i) ? 'font-semibold text-danger' : ''}`}>{date(i.due_date)}</td>
                  <td>{i.status === 'paid' ? <><Badge tone="green">Paid</Badge><p className="mt-1 text-[12px] text-muted">{paymentLabel[i.payment_method]} · {date(i.paid_at)}</p></>
                    : i.status === 'void' ? <Badge tone="grey">Cancelled</Badge> : <Badge tone={overdue(i) ? 'red' : 'amber'}>{overdue(i) ? 'Overdue' : 'Due'}</Badge>}</td>
                  <td>{i.status === 'due' && (
                    <div className="flex justify-end gap-2">
                      <button className="btn-secondary btn-sm" onClick={() => cash(i)}>Record payment</button>
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
                        <input className="input num h-10 w-24 text-right font-semibold" type="number" min="0" value={s[k] ?? ''}
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

        <Card title="Discount tiers" subtitle="Monthly fee discount by last month’s online orders (app and bulk). Counter sales do not count, since the platform cannot verify them.">
          <div className="grid gap-2">
            {(data?.tiers ?? []).map((t) => {
              const e = tierEdits[t.name] ?? t
              const set = (k) => (ev) => setTierEdits({ ...tierEdits, [t.name]: { ...e, [k]: ev.target.value } })
              return (
                <div key={t.name} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-2xl bg-cream px-4 py-2.5">
                  <span className="font-semibold">{t.name}</span>
                  <label className="flex items-center gap-1 text-[12px] text-muted">from Rs
                    <input className="input num h-9 w-28 text-right" type="number" min="0" value={e.min_monthly_sales} onChange={set('min_monthly_sales')} disabled={t.name === 'Standard'} aria-label={`${t.name} sales`} /></label>
                  <label className="flex items-center gap-1 text-[12px] text-muted">
                    <input className="input num h-9 w-16 text-right" type="number" min="0" max="100" value={e.discount_pct} onChange={set('discount_pct')} aria-label={`${t.name} discount`} />% off</label>
                </div>
              )
            })}
          </div>
          <p className="mt-3 text-[12.5px] text-muted">Example: a center with {rsShort(2500000)} of online orders last month pays the Gold fee this month.</p>
          <button className="btn-primary mt-4 w-full" disabled={!Object.keys(tierEdits).length || busy} onClick={saveTiers}>Save tiers</button>
        </Card>
      </div>
    </>
  )
}

