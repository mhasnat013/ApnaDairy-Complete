import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { adminAudit, adminDisputes, adminUsageAudit, auditLabel, milkLabel, usageLabel, paymentLabel } from '../../lib/center'
import { rs, litres, dateTime } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'

const tone = { cancelled: 'red', corrected: 'amber', expired: 'grey', usage_undone: 'blue' }

// every change a center makes after the fact, so a farmer's complaint can be checked against the record
export default function Audit() {
  const { data, error } = useLoad(async () => {
    const [audit, disputes, usage] = await Promise.all([adminAudit(), adminDisputes(), adminUsageAudit()])
    return { audit, disputes, usage }
  })
  const [view, setView] = useState('changes')
  const week = (d) => Date.now() - new Date(d) < 7 * 864e5
  const a = data?.audit ?? []
  const changed = (r) => r.action === 'corrected' && r.before && r.after
    ? `${litres(r.before.quantity_l)} → ${litres(r.after.quantity_l)}` : null

  return (
    <>
      <PageHeader title="Audit log" description="Cancelled and corrected collections, expired offers, undone stock entries and payments farmers say they never received." />
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Open disputes" value={data ? data.disputes.length : null} note="payments farmers did not receive" />
        <Kpi label="Cancelled, 7 days" value={data ? a.filter((r) => r.action === 'cancelled' && week(r.created_at)).length : null} />
        <Kpi label="Corrected, 7 days" value={data ? a.filter((r) => r.action === 'corrected' && week(r.created_at)).length : null} />
        <Kpi label="Offers expired, 7 days" value={data ? a.filter((r) => r.action === 'expired' && week(r.created_at)).length : null} note="farmer did not answer in 2 hours" />
      </div>

      <Card className="mt-5" bodyClass="pt-3" title="History"
        action={<Segmented size="sm" value={view} onChange={setView} options={[
          { value: 'changes', label: 'Collections', count: data ? a.length : null },
          { value: 'disputes', label: 'Disputes', count: data ? data.disputes.length : null },
          { value: 'stock', label: 'Stock', count: data ? data.usage.length : null }]} />}>
        <div className="overflow-x-auto">
          {view === 'changes' && (
            <table className="table min-w-[820px]">
              <thead><tr><th>When</th><th>Center</th><th>Farmer and milk</th><th>Change</th><th>Reason</th></tr></thead>
              <tbody>
                {data && a.length === 0 && <tr><td colSpan={5}><EmptyState title="No changes yet" /></td></tr>}
                {a.map((r) => (
                  <tr key={r.id}>
                    <td className="num whitespace-nowrap">{dateTime(r.created_at)}</td>
                    <td><p className="font-semibold">{r.center?.center_name}</p><p className="text-[12.5px] text-muted">{r.center?.city}</p></td>
                    <td><p className="font-medium">{r.collection?.farmer?.full_name ?? '—'}</p>
                      <p className="text-[12.5px] text-muted">{r.collection ? `${litres(r.collection.quantity_l)} ${milkLabel[r.collection.milk_type]?.toLowerCase()} milk` : ''}</p></td>
                    <td><Badge tone={tone[r.action]}>{auditLabel[r.action]}</Badge>{changed(r) && <p className="num mt-1 text-[12.5px] text-muted">{changed(r)}</p>}</td>
                    <td className="max-w-[280px] text-[13.5px]">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'disputes' && (
            <table className="table min-w-[820px]">
              <thead><tr><th>Answered</th><th>Center</th><th>Farmer</th><th className="text-right">Amount</th><th>Payment</th><th>Farmer says</th></tr></thead>
              <tbody>
                {data && data.disputes.length === 0 && <tr><td colSpan={6}><EmptyState title="No disputes">Every payment sent so far was confirmed by the farmer.</EmptyState></td></tr>}
                {data?.disputes.map((p) => (
                  <tr key={p.id}>
                    <td className="num whitespace-nowrap">{dateTime(p.answered_at)}</td>
                    <td><p className="font-semibold">{p.center?.center_name}</p><p className="text-[12.5px] text-muted">{p.center?.city}</p></td>
                    <td><p className="font-medium">{p.farmer?.full_name}</p><p className="num text-[12.5px] text-muted">{p.farmer?.phone ?? ''}</p></td>
                    <td className="num text-right font-semibold">{rs(p.amount)}</td>
                    <td className="text-[13.5px]">{paymentLabel[p.method]}{p.reference ? <p className="num text-[12.5px] text-muted">{p.reference}</p> : null}</td>
                    <td className="max-w-[240px] text-[13.5px]">{p.farmer_note ?? 'Money not received'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {view === 'stock' && (
            <table className="table min-w-[720px]">
              <thead><tr><th>When</th><th>Center</th><th>Entry undone</th><th className="text-right">Litres</th></tr></thead>
              <tbody>
                {data && data.usage.length === 0 && <tr><td colSpan={4}><EmptyState title="No undone entries" /></td></tr>}
                {data?.usage.map((u) => (
                  <tr key={u.id}>
                    <td className="num whitespace-nowrap">{dateTime(u.created_at)}</td>
                    <td><p className="font-semibold">{u.center?.center_name}</p><p className="text-[12.5px] text-muted">{u.center?.city}</p></td>
                    <td><p className="font-medium">{usageLabel[u.entry?.reason] ?? u.entry?.reason}</p><p className="text-[12.5px] text-muted">{milkLabel[u.entry?.milk_type]} milk{u.entry?.note ? ` · ${u.entry.note}` : ''}</p></td>
                    <td className="num text-right font-semibold">{litres(u.entry?.litres)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </>
  )
}
