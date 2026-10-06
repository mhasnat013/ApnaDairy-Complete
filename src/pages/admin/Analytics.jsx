import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { adminAnalytics, rsShort, shortDay, weekday, monthLabel } from '../../lib/center'
import { rs, litres } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { TrendChart, Legend, Donut, C } from '../../components/charts'

const sum = (rows, k) => (rows ?? []).reduce((n, r) => n + Number(r[k] || 0), 0)

// the last six months, so a month without payments still shows as zero
function lastMonths(income) {
  const now = new Date()
  return Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 5 + i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const hit = (income ?? []).find((x) => String(x.month).slice(0, 7) === key.slice(0, 7))
    return { month: key, device: Number(hit?.device ?? 0), subscription: Number(hit?.subscription ?? 0) }
  })
}

export default function Analytics() {
  const [range, setRange] = useState('30')
  const { data, error } = useLoad(() => adminAnalytics(Number(range)), [range])
  const daily = (data?.daily ?? []).map((d) => ({ ...d, sales: Number(d.sales), paid: Number(d.paid) }))
  const t = data?.totals ?? {}
  const tests = sum(daily, 'tests'), failed = sum(daily, 'failed')
  const months = lastMonths(data?.income)
  const income6 = months.reduce((n, m) => n + m.device + m.subscription, 0)

  return (
    <>
      <PageHeader title="Analytics" description="The whole platform at a glance: milk bought from farmers, what centers sold, milk quality and what ApnaDairy earns.">
        <Segmented size="sm" value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }]} />
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Milk bought from farmers" value={data ? litres(Math.round(sum(daily, 'collected_l'))) : null} icon={<Icon name="drop" size={16} />} note={data ? `${rs(Math.round(sum(daily, 'paid')))} paid to farmers` : ''} />
        <Kpi label="Sold by centers" value={data ? rsShort(sum(daily, 'sales')) : null} note="delivered app and bulk orders" />
        <Kpi label="Passed the quality test" value={data ? `${tests ? Math.round(((tests - failed) / tests) * 100) : 0}%` : null} note={data ? `${tests} tests, ${failed} failed` : ''} />
        <Kpi label="ApnaDairy income" value={data ? rsShort(income6) : null} note="devices and fees, last 6 months" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 sm:mt-5 sm:grid-cols-6 sm:gap-3">
        {[['Centers', t.centers], ['Businesses', t.businesses], ['Farmers', t.farmers], ['Customers', t.customers], ['Devices in use', t.devices], ['Unpaid bills', t.outstanding != null ? rsShort(t.outstanding) : null]].map(([k, v]) => (
          <div key={k} className="rounded-[18px] border border-line bg-surface px-3 py-3 sm:px-4">
            <p className="truncate text-[12px] text-muted">{k}</p>
            <p className="display num mt-0.5 truncate text-[19px] text-forest-deep sm:text-[22px]">{v ?? '—'}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Sales and payments to farmers" subtitle="Every center together, per day">
          <Legend items={[{ label: 'Sold by centers', color: C.green }, { label: 'Paid to farmers', color: C.gold, line: true }]} />
          <div className="mt-3">
            {data ? (
              <TrendChart data={daily} ariaLabel="Daily sales and payments to farmers"
                series={[{ key: 'sales', label: 'Sold', color: C.green, type: 'bar' }, { key: 'paid', label: 'Paid to farmers', color: C.gold, type: 'line' }]}
                xFormat={(v, i, full) => (full ? `${weekday(v)}, ${shortDay(v)}` : Number(range) <= 7 ? weekday(v) : shortDay(v))}
                yFormat={(v, full) => (full ? rs(Math.round(v)) : rsShort(v))}
                tooltipExtra={(d) => (
                  <p className="mt-1 flex justify-between gap-3 border-t border-line pt-1 text-muted">Milk bought<span className="num font-semibold text-ink">{litres(Math.round(d.collected_l))}</span></p>
                )} />
            ) : <div className="skeleton h-[240px]" />}
          </div>
        </Card>
        <QualityCard quality={data?.quality} loading={!data} />
      </div>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Milk centers" subtitle={`Ranked by milk bought in the last ${range} days`} bodyClass="pt-3">
          <div className="overflow-x-auto">
            <table className="table min-w-[640px]">
              <thead><tr><th>Center</th><th className="text-right">Milk bought</th><th className="text-right">Sold</th><th className="text-right">Premium</th><th className="text-right">Farmers</th><th>Account</th></tr></thead>
              <tbody>
                {!data && <tr><td colSpan={6}><div className="skeleton h-24" /></td></tr>}
                {data && data.centers.length === 0 && <tr><td colSpan={6}><EmptyState title="No approved centers yet" /></td></tr>}
                {(data?.centers ?? []).map((c) => (
                  <tr key={c.id}>
                    <td><p className="font-semibold">{c.center_name}</p><p className="whitespace-nowrap text-[12.5px] text-muted">{c.city}{c.device ? ` · ${c.device}` : ' · no device'}</p></td>
                    <td className="num whitespace-nowrap text-right">{litres(Math.round(c.collected_l))}</td>
                    <td className="num whitespace-nowrap text-right font-semibold">{rs(Math.round(c.sales))}</td>
                    <td className="num text-right">{c.premium_pct != null ? `${c.premium_pct}%` : '—'}</td>
                    <td className="num text-right">{c.farmers}</td>
                    <td className="whitespace-nowrap">{c.billing_ok ? <Badge tone="green">Paid up</Badge> : <Badge tone="red">Bill overdue</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="ApnaDairy income" subtitle="Paid bills by month: IoT devices and monthly fees. No cut from milk sales.">
          <Legend items={[{ label: 'Monthly fees', color: C.green }, { label: 'Devices', color: C.gold }]} />
          <div className="mt-3">
            {data ? (
              <TrendChart data={months} xKey="month" height={220} ariaLabel="ApnaDairy income by month"
                series={[{ key: 'subscription', label: 'Monthly fees', color: C.green, type: 'bar' }, { key: 'device', label: 'Devices', color: C.gold, type: 'bar' }]}
                xFormat={(v, i, full) => (full ? monthLabel(v) : new Date(`${v.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { month: 'short' }))}
                yFormat={(v, full) => (full ? rs(Math.round(v)) : rsShort(v))} />
            ) : <div className="skeleton h-[220px]" />}
          </div>
        </Card>
      </div>
    </>
  )
}

function QualityCard({ quality, loading }) {
  const q = quality ?? {}
  const seg = [
    { label: 'Premium', value: Number(q.premium ?? 0), color: C.g1 },
    { label: 'Fresh', value: Number(q.fresh ?? 0), color: C.g2 },
    { label: 'Standard', value: Number(q.standard ?? 0), color: C.g3 },
    { label: 'Failed test', value: Number(q.failed ?? 0), color: C.danger },
  ]
  const total = seg.reduce((n, s) => n + s.value, 0)
  return (
    <Card title="Milk quality" subtitle="AI grade of every test">
      {loading ? <div className="skeleton h-[200px]" /> : total === 0 ? <EmptyState title="No tests in this period" /> : (
        <div className="flex flex-col items-center gap-5 sm:flex-row lg:flex-col">
          <Donut segments={seg} size={152} thickness={18} center={total} sub="tests" />
          <ul className="grid w-full gap-2.5">
            {seg.map((s) => (
              <li key={s.label} className="flex items-center gap-3">
                <span className="h-3 w-3 shrink-0 rounded-[4px]" style={{ background: s.color }} />
                <span className="flex-1 text-[14px]">{s.label}</span>
                <span className="num text-[14px] font-semibold">{s.value}</span>
                <span className="num w-11 text-right text-[13px] text-muted">{Math.round((s.value / total) * 100)}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}
