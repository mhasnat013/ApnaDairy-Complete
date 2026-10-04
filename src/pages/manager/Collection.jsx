import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  collectionsOn, decideCollection, todayKey, dayKey, shortDay, timeOf, milkLabel, gradeLabel, gradeTone, PARAMS, inRange,
} from '../../lib/center'
import { rs, litres } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import { SkeletonRows } from '../../components/Skeleton'

const days = () => [0, 1, 2].map((n) => dayKey(Date.now() - n * 864e5))

export default function Collection() {
  const [day, setDay] = useState(todayKey())
  const [shift, setShift] = useState('all')
  const { data, error, loading, reload } = useLoad(() => collectionsOn(day), [day])
  const { toast, confirm } = useUi()
  const [busy, setBusy] = useState(null)

  const rows = (data ?? []).filter((c) => shift === 'all' || c.shift === shift)
  const accepted = rows.filter((c) => c.status === 'accepted')
  const waiting = rows.filter((c) => c.status === 'offered')
  const failed = rows.filter((c) => c.reject_reason === 'Failed the quality test')
  const byShift = (s) => (data ?? []).filter((c) => c.shift === s && c.status === 'accepted').reduce((n, c) => n + Number(c.quantity_l), 0)

  const decide = async (c, accept) => {
    if (!accept) {
      const ok = await confirm({ title: 'Farmer refused the offer?', body: `${c.farmer?.full_name} will take back ${litres(c.quantity_l)}. You can note why.`, input: 'Reason (optional)', confirmLabel: 'Record refusal', danger: true })
      if (!ok) return
      setBusy(c.id)
      try { await decideCollection(c.id, false, typeof ok === 'string' ? ok : null); toast('Recorded as refused.'); await reload() } catch (e) { toast(e.message, 'error') }
    } else {
      setBusy(c.id)
      try { await decideCollection(c.id, true); toast(`${litres(c.quantity_l)} added to stock.`); await reload() } catch (e) { toast(e.message, 'error') }
    }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Milk collection" description="Every drop-off is tested, priced and offered to the farmer. Accepted milk goes straight into your stock.">
        <Link to="/manager/collection/new" className="btn-primary"><Icon name="plus" size={17} />Record milk</Link>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Mini label="Morning shift" value={litres(Math.round(byShift('morning')))} />
        <Mini label="Evening shift" value={litres(Math.round(byShift('evening')))} />
        <Mini label="Waiting for farmer" value={waiting.length} tone={waiting.length ? 'haldi' : ''} />
        <Mini label="Failed the test" value={failed.length} tone={failed.length ? 'red' : ''} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented value={day} onChange={setDay} options={days().map((d, i) => ({ value: d, label: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : shortDay(d) }))} />
        <Segmented size="sm" value={shift} onChange={setShift} options={[{ value: 'all', label: 'Both shifts' }, { value: 'morning', label: 'Morning' }, { value: 'evening', label: 'Evening' }]} />
      </div>
      <Alert>{error}</Alert>

      <div className="panel overflow-hidden">
        {/* desktop table */}
        <div className="hidden overflow-x-auto md:block">
          <table className="table min-w-[860px]">
            <thead><tr><th>Time</th><th>Farmer</th><th className="text-right">Milk</th><th>Test</th><th>Grade</th><th className="text-right">Price</th><th>Status</th></tr></thead>
            <tbody>
              {loading && <SkeletonRows cols={7} />}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={7}><EmptyState title="No milk recorded" action={<Link to="/manager/collection/new" className="btn-primary btn-sm">Record milk</Link>}>Collections for this day will show up here.</EmptyState></td></tr>
              )}
              {!loading && rows.map((c) => (
                <tr key={c.id}>
                  <td className="num text-muted">{timeOf(c.collected_at)}<p className="text-[12px] capitalize">{c.shift}</p></td>
                  <td><Link to={`/manager/farmers/${c.farmer?.id}`} className="font-semibold hover:text-forest">{c.farmer?.full_name}</Link><p className="text-[12.5px] text-muted">{milkLabel[c.milk_type]} · {c.farmer?.village}</p></td>
                  <td className="num text-right font-semibold">{litres(c.quantity_l)}</td>
                  <td><Readings c={c} /></td>
                  <td>{c.quality ? <Badge tone={gradeTone[c.quality]} dot={false}>{gradeLabel[c.quality]}</Badge> : <Badge tone="red" dot={false}>Failed</Badge>}</td>
                  <td className="num text-right">{c.price_per_l ? <>{rs(c.price_per_l)}<p className="text-[12.5px] text-muted">{rs(Math.round(c.total_amount))}</p></> : <span className="text-muted">—</span>}</td>
                  <td><Status c={c} busy={busy === c.id} onDecide={decide} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* phone cards */}
        <ul className="divide-y divide-line md:hidden">
          {loading && <li className="p-5"><div className="skeleton h-16" /></li>}
          {!loading && rows.length === 0 && <li><EmptyState title="No milk recorded">Collections for this day will show up here.</EmptyState></li>}
          {!loading && rows.map((c) => (
            <li key={c.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{c.farmer?.full_name}</p>
                  <p className="text-[12.5px] text-muted">{timeOf(c.collected_at)} · {milkLabel[c.milk_type]} · {litres(c.quantity_l)}</p>
                </div>
                {c.quality ? <Badge tone={gradeTone[c.quality]} dot={false}>{gradeLabel[c.quality]}</Badge> : <Badge tone="red" dot={false}>Failed</Badge>}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3">
                <Readings c={c} />
                {c.price_per_l && <p className="num text-right text-[13px]"><b>{rs(Math.round(c.total_amount))}</b><br /><span className="text-muted">{rs(c.price_per_l)}/L</span></p>}
              </div>
              <div className="mt-3"><Status c={c} busy={busy === c.id} onDecide={decide} /></div>
            </li>
          ))}
        </ul>
      </div>
      {accepted.length > 0 && (
        <p className="mt-3 text-right text-[13.5px] text-muted">
          Bought <b className="text-ink">{litres(Math.round(accepted.reduce((n, c) => n + Number(c.quantity_l), 0)))}</b> for <b className="text-ink">{rs(Math.round(accepted.reduce((n, c) => n + Number(c.total_amount), 0)))}</b>
        </p>
      )}
    </>
  )
}

function Mini({ label, value, tone }) {
  const t = tone === 'haldi' ? 'bg-haldi-soft border-[#efd59a]' : tone === 'red' ? 'bg-[#f8e2dc] border-[#efc6bb]' : 'bg-surface border-line'
  return (
    <div className={`rounded-2xl border px-4 py-3 ${t}`}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="display num mt-0.5 text-[22px]">{value}</p>
    </div>
  )
}

const short = { ph: 'pH', ec_ms: 'EC', tds_ppm: 'TDS' }
const fixed = { ph: 2, ec_ms: 1, tds_ppm: 0 }

// compact pH / EC / TDS chips, red when outside the normal range
function Readings({ c }) {
  return (
    <div className="flex flex-wrap gap-1">
      {PARAMS.filter((p) => short[p.key] && c[p.key] != null).map((p) => {
        const v = Number(c[p.key])
        const ok = inRange(p, v)
        return (
          <span key={p.key} title={p.help} className={`num rounded-md px-1.5 py-0.5 text-[11.5px] font-medium ${ok ? 'bg-cream-2 text-muted' : 'bg-[#f8e2dc] text-danger'}`}>
            {short[p.key]} {v.toFixed(fixed[p.key])}
          </span>
        )
      })}
    </div>
  )
}

function Status({ c, busy, onDecide }) {
  if (c.status === 'offered') {
    return (
      <div className={`flex flex-wrap items-center gap-2 ${busy ? 'pointer-events-none opacity-50' : ''}`}>
        <span className="flex items-center gap-1 text-[12.5px] font-semibold text-amber"><Icon name="clock" size={14} />Waiting</span>
        <button className="btn-primary btn-sm" onClick={() => onDecide(c, true)}>Accepted</button>
        <button className="btn-secondary btn-sm" onClick={() => onDecide(c, false)}>Refused</button>
      </div>
    )
  }
  if (c.status === 'rejected') return <div><Badge tone={c.reject_reason === 'Failed the quality test' ? 'red' : 'grey'}>Not bought</Badge><p className="mt-1 max-w-[180px] text-[12px] text-muted">{c.reject_reason}</p></div>
  return <div><Badge status="accepted">In stock</Badge><p className="mt-1 text-[12px] text-muted">{c.payment === 'paid' ? 'Farmer paid' : 'Not paid yet'}</p></div>
}
