import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { readingsSince, settings, dayKey, shortDay, weekday, timeOf, milkLabel, gradeLabel, gradeTone, riskLabel, PARAMS, MODELS, inRange } from '../../lib/center'
import { litres, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { TrendChart, RangeBar, C } from '../../components/charts'

// a reading is a problem when the ai flagged it: failed, adulteration risk, or milk starting to sour
const flagged = (r) => !r.quality || r.adulteration_risk !== 'low' || (r.spoilage_risk && r.spoilage_risk !== 'low') || Number(r.ph) < 6.55
const avg = (rows, k) => (rows.length ? rows.reduce((n, r) => n + Number(r[k]), 0) / rows.length : null)

export default function IotReadings() {
  const { data, error } = useLoad(async () => {
    const [rows, s] = await Promise.all([readingsSince(14), settings()])
    return { rows, settings: s }
  })
  const [view, setView] = useState('flagged')
  const [shown, setShown] = useState(20)
  const rows = data?.rows ?? []
  const latest = rows[0]
  const today = rows.filter((r) => dayKey(r.collected_at) === dayKey(new Date()))
  const problems = rows.filter(flagged)
  const list = view === 'flagged' ? problems : rows

  // daily averages for the trend charts
  const days = Array.from({ length: 14 }, (_, i) => dayKey(Date.now() - (13 - i) * 864e5))
  const trend = days.map((d) => {
    const r = rows.filter((x) => dayKey(x.collected_at) === d)
    return { day: d, ph: avg(r, 'ph'), tds: avg(r.filter((x) => x.tds_ppm != null), 'tds_ppm'), tests: r.length, flagged: r.filter(flagged).length }
  })
  const fmtDay = (v, i, full) => (full ? `${weekday(v)}, ${shortDay(v)}` : shortDay(v))

  return (
    <>
      <PageHeader title="IoT readings" description="Every sample the milk tester reads: temperature, pH, conductivity and dissolved solids, and what the two AI models made of it.">
        <Link to="/manager/collection/new" className="btn-primary"><Icon name="chip" size={17} />Test milk</Link>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <section className="furrows relative overflow-hidden rounded-[24px] bg-forest-deep p-6 text-cream">
          <p className="text-[13px] text-cream/70">Milk tester</p>
          <p className="display mt-1 text-[26px]">{data?.settings?.device_serial ?? 'AD-IOT-0001'}</p>
          <span className="mt-3 inline-flex items-center gap-2 rounded-full bg-cream/10 px-3 py-1 text-[12.5px] font-semibold">
            <span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#7fd39b] opacity-60" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#7fd39b]" /></span>
            Online · simulated readings
          </span>
          <dl className="mt-6 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-cream/10 p-3"><dt className="text-[12px] text-cream/65">Tests today</dt><dd className="display num text-[26px]">{data ? today.length : '—'}</dd></div>
            <div className="rounded-2xl bg-cream/10 p-3"><dt className="text-[12px] text-cream/65">Flagged, 14 days</dt><dd className="display num text-[26px] text-haldi">{data ? problems.length : '—'}</dd></div>
          </dl>
          <p className="mt-5 text-[13px] text-cream/70">{latest ? `Last reading ${relative(latest.collected_at)}` : 'No readings yet'}</p>
          <ul className="mt-4 flex flex-wrap gap-1.5 text-[11.5px] text-cream/70">
            {PARAMS.map((p) => <li key={p.key} className="rounded-full bg-cream/10 px-2.5 py-1">{p.sensor}</li>)}
          </ul>
          <p className="mt-3 rounded-2xl bg-cream/5 p-3 text-[12.5px] leading-relaxed text-cream/70">The hardware is still being built. Until it is connected, the portal uses realistic simulated readings so the full flow can be tested.</p>
        </section>

        <Card title="Latest sample" subtitle={latest ? `${latest.farmer?.full_name}, ${litres(latest.quantity_l)} ${milkLabel[latest.milk_type].toLowerCase()} milk at ${timeOf(latest.collected_at)}` : 'No samples yet'}>
          {latest ? (
            <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
              {PARAMS.map((p) => (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[14px] font-semibold">{p.label}</span>
                    <span className={`num text-[20px] font-bold ${latest[p.key] == null || inRange(p, Number(latest[p.key])) ? '' : 'text-danger'}`}>{latest[p.key] == null ? '—' : Number(latest[p.key]).toFixed(p.digits)} <span className="text-[12px] font-medium text-muted">{p.unit}</span></span>
                  </div>
                  <RangeBar param={p} value={Number(latest[p.key])} />
                  <p className="mt-1 text-[12px] text-muted">{p.help}</p>
                </div>
              ))}
            </div>
          ) : <EmptyState title="No readings yet">Test a sample to see it here.</EmptyState>}
        </Card>
      </div>

      <Card className="mt-4 sm:mt-5" title="From sensors to AI" subtitle="Each reading is sent to two models. Their results decide the grade and the price.">
        <div className="grid gap-3 md:grid-cols-2">
          {MODELS.map((m) => (
            <div key={m.key} className="rounded-2xl border border-line bg-white p-4">
              <p className="font-semibold text-forest-deep">{m.name}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {m.inputs.map((k) => {
                  const p = PARAMS.find((x) => x.key === k)
                  return <span key={k} className="rounded-full bg-cream-2 px-2.5 py-1 text-[12px] font-medium">{p ? p.label : 'Timestamp'}<span className="text-muted"> · {p ? p.sensor : 'device clock'}</span></span>
                })}
              </div>
              <p className="mt-3 flex items-start gap-2 text-[13.5px] text-muted"><Icon name="arrow" size={15} className="mt-0.5 shrink-0 text-forest" />{m.outputs}</p>
            </div>
          ))}
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-2">
        <Card title="Average pH" subtitle="Green band is the normal range, 6.6 to 6.8">
          <TrendChart data={trend} height={190} yDomain={[6.3, 7.0]} band={[6.6, 6.8]} ariaLabel="Average pH per day"
            series={[{ key: 'ph', label: 'pH', color: C.green, type: 'line' }]} xFormat={fmtDay} yFormat={(v) => Number(v).toFixed(2)} />
        </Card>
        <Card title="Average TDS" subtitle="Green band is normal, 1900 to 2750 ppm. Lower suggests added water">
          <TrendChart data={trend} height={190} yDomain={[1400, 3200]} band={[1900, 2750]} ariaLabel="Average TDS per day"
            series={[{ key: 'tds', label: 'TDS', color: C.gold, type: 'line' }]} xFormat={fmtDay} yFormat={(v, full) => (full ? `${Math.round(v)} ppm` : Math.round(v))} />
        </Card>
      </div>

      <Card className="mt-4 sm:mt-5" title="Readings" subtitle="Last 14 days" bodyClass="pt-3"
        action={<Segmented size="sm" value={view} onChange={(v) => { setView(v); setShown(20) }} options={[{ value: 'flagged', label: 'Problems', count: data ? problems.length : null }, { value: 'all', label: 'All', count: data ? rows.length : null }]} />}>
        <div className="overflow-x-auto">
          <table className="table min-w-[820px]">
            <thead><tr><th>When</th><th>Farmer</th>{PARAMS.map((p) => <th key={p.key} className="text-right">{p.abbr}{p.unit ? ` (${p.unit})` : ''}</th>)}<th>Result</th></tr></thead>
            <tbody>
              {data && list.length === 0 && <tr><td colSpan={7}><EmptyState title={view === 'flagged' ? 'No problems found' : 'No readings'}>Every sample was in the normal range.</EmptyState></td></tr>}
              {list.slice(0, shown).map((r) => (
                <tr key={r.id}>
                  <td className="num">{date(r.collected_at)}<p className="text-[12.5px] text-muted">{timeOf(r.collected_at)}</p></td>
                  <td><p className="font-semibold">{r.farmer?.full_name}</p><p className="text-[12.5px] text-muted">{milkLabel[r.milk_type]}</p></td>
                  {PARAMS.map((p) => {
                    const v = Number(r[p.key])
                    return <td key={p.key} className={`num text-right ${r[p.key] == null || inRange(p, v) ? '' : 'font-bold text-danger'}`}>{r[p.key] == null ? '—' : v.toFixed(p.digits)}</td>
                  })}
                  <td>
                    {r.quality ? <Badge tone={gradeTone[r.quality]} dot={false}>{gradeLabel[r.quality]}</Badge> : <Badge tone="red" dot={false}>Failed</Badge>}
                    {r.adulteration_risk !== 'low' && <p className="mt-1 text-[12px] font-semibold text-danger">{riskLabel[r.adulteration_risk]} adulteration risk{r.suspected ? `, likely ${r.suspected}` : ''}</p>}
                    {r.spoilage_risk && r.spoilage_risk !== 'low' && <p className="mt-1 text-[12px] font-semibold text-amber">{riskLabel[r.spoilage_risk]} spoilage risk</p>}
                    <p className="mt-0.5 max-w-[240px] text-[12px] text-muted">{r.ai_notes?.[0]}</p>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.length > shown && <div className="pt-4 text-center"><button className="btn-secondary btn-sm" onClick={() => setShown(shown + 40)}>Show more ({list.length - shown} left)</button></div>}
      </Card>
    </>
  )
}
