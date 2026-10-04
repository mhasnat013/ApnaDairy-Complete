import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { farmerCollections, payFarmer, dayKey, shortDay, weekday, timeOf, milkLabel, gradeLabel, gradeTone } from '../../lib/center'
import { rs, litres, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { TrendChart, C } from '../../components/charts'
import { FarmerForm } from './Farmers'

export default function FarmerDetail() {
  const { id } = useParams()
  const { toast, confirm } = useUi()
  const [editing, setEditing] = useState(null)
  const [paying, setPaying] = useState(false)
  const [shown, setShown] = useState(15)
  const { data, error, reload } = useLoad(async () => {
    const [{ data: farmer, error: e1 }, { data: stats }, rows] = await Promise.all([
      supabase.from('farmers').select('*').eq('id', id).single(),
      supabase.from('farmer_stats').select('*').eq('farmer_id', id).maybeSingle(),
      farmerCollections(id),
    ])
    if (e1) throw e1
    return { farmer, stats: stats ?? {}, rows }
  }, [id])

  const f = data?.farmer
  const s = data?.stats ?? {}
  const rows = data?.rows ?? []
  const unpaid = Number(s.unpaid_amount || 0)

  // litres accepted per day for the last 30 days
  const byDay = {}
  rows.filter((r) => r.status === 'accepted').forEach((r) => { const k = dayKey(r.collected_at); byDay[k] = (byDay[k] || 0) + Number(r.quantity_l) })
  const series = Array.from({ length: 30 }, (_, i) => { const k = dayKey(Date.now() - (29 - i) * 864e5); return { day: k, litres: +(byDay[k] || 0).toFixed(1) } })
  const recent30 = rows.filter((r) => Date.now() - new Date(r.collected_at) < 30 * 864e5)
  const accepted30 = recent30.filter((r) => r.status === 'accepted')
  const avgPrice = accepted30.length ? accepted30.reduce((n, r) => n + Number(r.total_amount), 0) / accepted30.reduce((n, r) => n + Number(r.quantity_l), 0) : 0
  const premium = s.tests_30d ? Math.round((s.premium_30d / s.tests_30d) * 100) : 0

  const pay = async () => {
    const ok = await confirm({ title: `Pay ${f.full_name}?`, body: `This marks ${rs(Math.round(unpaid))} for all accepted milk as paid. Hand over the cash or send it first.`, confirmLabel: `Mark ${rs(Math.round(unpaid))} paid` })
    if (!ok) return
    setPaying(true)
    try { const amt = await payFarmer(id); toast(`${rs(Math.round(amt))} marked as paid to ${f.full_name}.`); await reload() } catch (e) { toast(e.message, 'error') }
    setPaying(false)
  }

  return (
    <>
      <PageHeader title={f?.full_name ?? ' '} back={{ to: '/manager/farmers', label: 'Farmers' }}
        description={f ? `${milkLabel[f.milk_type]} milk · ${f.village ?? 'No village'} · ${f.cattle_count} animals${f.phone ? ` · ${f.phone}` : ''}` : ''}>
        {f && <button className="btn-secondary" onClick={() => setEditing(f)}><Icon name="edit" size={16} />Edit</button>}
        {f?.is_active && <Link to={`/manager/collection/new?farmer=${id}`} className="btn-primary"><Icon name="drop" size={17} />Record milk</Link>}
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="You owe" value={data ? rs(Math.round(unpaid)) : null} note={unpaid > 0 ? 'for accepted milk not yet paid' : 'All paid up'}>
          {unpaid > 0 && <button className="btn-haldi btn-sm w-full" onClick={pay} disabled={paying}>{paying ? 'Saving…' : 'Mark as paid'}</button>}
        </Kpi>
        <Kpi label="Milk in 30 days" value={data ? litres(Math.round(s.litres_30d || 0)) : null} note={`${accepted30.length} drop-offs`} />
        <Kpi label="Earned in 30 days" value={data ? rs(Math.round(s.earned_30d || 0)) : null} note={avgPrice ? `average ${rs(Math.round(avgPrice))} per litre` : ' '} />
        <Kpi label="Quality" value={data ? `${premium}%` : null} note={`premium${Number(s.failed_30d) ? ` · ${s.failed_30d} failed tests` : ' · no failed tests'}`} />
      </div>

      <Card className="mt-4 sm:mt-5" title="Milk supplied" subtitle="Litres accepted each day, last 30 days">
        <TrendChart data={series} height={200} ariaLabel="Litres supplied per day"
          series={[{ key: 'litres', label: 'Milk', color: C.green, type: 'bar' }]}
          xFormat={(v, i, full) => (full ? `${weekday(v)}, ${shortDay(v)}` : shortDay(v))}
          yFormat={(v, full) => (full ? litres(v) : `${Math.round(v)} L`)} />
      </Card>

      <Card className="mt-4 sm:mt-5" title="Recent drop-offs" bodyClass="pt-3">
        <div className="overflow-x-auto">
          <table className="table min-w-[720px]">
            <thead><tr><th>Date</th><th className="text-right">Milk</th><th>Grade</th><th className="text-right">Price</th><th className="text-right">Total</th><th>Status</th></tr></thead>
            <tbody>
              {data && rows.length === 0 && <tr><td colSpan={6}><EmptyState title="No milk yet">Record this farmer’s first collection.</EmptyState></td></tr>}
              {rows.slice(0, shown).map((r) => (
                <tr key={r.id}>
                  <td className="num">{date(r.collected_at)}<p className="text-[12.5px] capitalize text-muted">{r.shift}, {timeOf(r.collected_at)}</p></td>
                  <td className="num text-right font-semibold">{litres(r.quantity_l)}</td>
                  <td>{r.quality ? <Badge tone={gradeTone[r.quality]} dot={false}>{gradeLabel[r.quality]}</Badge> : <Badge tone="red" dot={false}>Failed</Badge>}</td>
                  <td className="num text-right">{r.price_per_l ? rs(r.price_per_l) : '—'}</td>
                  <td className="num text-right font-semibold">{r.status === 'accepted' ? rs(Math.round(r.total_amount)) : '—'}</td>
                  <td>
                    {r.status === 'accepted' && <Badge tone={r.payment === 'paid' ? 'green' : 'amber'}>{r.payment === 'paid' ? 'Paid' : 'Not paid'}</Badge>}
                    {r.status === 'offered' && <Badge tone="blue">Waiting for answer</Badge>}
                    {r.status === 'rejected' && <span className="text-[13px] text-muted">{r.reject_reason}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > shown && <div className="pt-4 text-center"><button className="btn-secondary btn-sm" onClick={() => setShown(shown + 30)}>Show older ({rows.length - shown})</button></div>}
      </Card>

      <FarmerForm key={editing ? editing.id : 'closed'} farmer={editing} onClose={() => setEditing(null)} onSaved={reload} />
    </>
  )
}
