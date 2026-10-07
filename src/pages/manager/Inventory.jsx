import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { Link } from 'react-router-dom'
import {
  milkStock, myMilkShelf, stockBatches, usageLog, recordUsage, undoUsage, shelfBatches, stockLeft, milkLabel, usageLabel, timeOf,
  dayBook, myFirstDay, todayKey, runMilkExpiry, shelfHours, modelShelfLeft, milkDay, gradeLabel, dateTimeShort,
} from '../../lib/center'
import { litres, date, relative, rs } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'
import DayPicker from '../../components/DayPicker'

const TYPES = ['buffalo', 'cow', 'mixed']

export default function Inventory() {
  const { data, error, reload } = useLoad(async () => {
    await runMilkExpiry().catch(() => null)   // milk past its 2 days leaves the stock first
    const [stock, batches, usage, shelf] = await Promise.all([milkStock(), stockBatches(), usageLog(), myMilkShelf()])
    return { stock, batches, usage, shelf }
  })
  const [usage, setUsage] = useState(null)

  return (
    <>
      <PageHeader title="Inventory" description="Your tested milk: how much, its grade and freshness, when it was tested and when it expires. Milk can be sold for 2 days at most, then it is discarded automatically.">
        <Link to="/manager/shop" className="btn-secondary"><Icon name="store" size={17} />Listings on the app</Link>
        <button className="btn-primary" onClick={() => setUsage({})}><Icon name="minus" size={17} />Take milk out</button>
      </PageHeader>
      <Alert>{error}</Alert>
      <MilkStock data={data} onChanged={reload} />
      <DayBook stamp={data} />
      <UsageForm key={usage ? 'usage-' + (usage.milk_type ?? '') : 'usage-closed'} value={usage} stock={data?.stock} onClose={() => setUsage(null)} onSaved={reload} />
    </>
  )
}

function MilkStock({ data, onChanged }) {
  const { toast, confirm } = useUi()
  // a wrong entry can be taken back for 15 minutes, after that it stays in the history
  const auto = (u) => (u.note ?? '').startsWith('Expired:')
  const canUndo = (u) => !auto(u) && Date.now() - new Date(u.created_at) < 15 * 6e4
  const undo = async (u) => {
    if (!(await confirm({ title: 'Undo this entry?', body: `${litres(u.litres)} ${usageLabel[u.reason].toLowerCase()} goes back into stock. The undo is saved in the history.`, confirmLabel: 'Undo' }))) return
    try { await undoUsage(u.id); toast(`${litres(u.litres)} back in stock.`); onChanged() } catch (e) { toast(e.message, 'error') }
  }
  const shelf = shelfBatches(data?.batches, data?.stock)
  return (
    <div className="grid gap-4 sm:gap-5">
      <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        {TYPES.map((t) => {
          const s = data?.stock.find((x) => x.milk_type === t)
          const left = s ? stockLeft(s) : 0
          const mine = shelf.filter((b) => b.milk_type === t)
          const soon = mine.filter((b) => b.hoursLeft > 0 && b.hoursLeft < 12).reduce((n, b) => n + b.remaining, 0)
          // from the database: milk past its shelf life cannot be sold on the app or in bulk
          const sh = data?.shelf?.find((x) => x.milk_type === t)
          const expired = Math.round(Number(sh?.expired_l ?? 0) * 10) / 10
          return (
            <div key={t} className="panel animate-rise p-5">
              <p className="text-[13px] font-semibold text-muted">{milkLabel[t]} milk</p>
              <p className="display num mt-2 text-[34px]">{data ? litres(Math.round(left)) : '—'}</p>
              <p className="text-[13px] text-muted">{left <= 0 ? 'Nothing in stock' : expired > 0 ? `${litres(Math.round(Number(sh.sellable_l) * 10) / 10)} fresh to sell` : soon > 0 ? <span className="font-semibold text-amber">{Math.round(soon)} L to sell within 12 h</span> : `freshest from ${mine[mine.length - 1] ? relative(mine[mine.length - 1].collected_at) : 'today'}`}</p>
              {expired > 0 && (
                <p className="mt-3 rounded-2xl bg-[#f8e2dc] px-3 py-2.5 text-[13px] text-danger"><b>{litres(expired)} expired.</b> It is being discarded automatically and cannot be sold.</p>
              )}
              {s && (
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px] text-muted">
                  <div><dt>Bought</dt><dd className="num font-semibold text-ink">{Math.round(s.bought_l)} L</dd></div>
                  <div><dt>Sold or ordered</dt><dd className="num font-semibold text-ink">{Math.round(Number(s.sold_l) + Number(s.bulk_l))} L</dd></div>
                  <div><dt>Used</dt><dd className="num font-semibold text-ink">{Math.round(s.used_l)} L</dd></div>
                </dl>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Milk in stock" subtitle="Each tested batch still on your shelf, the one that expires first at the top. Milk sells for 2 days. AI Model 1's quality and shelf life are shown for each batch.">
          {data && shelf.length === 0 && <EmptyState title="The shelf is empty">Accepted milk shows up here until it is sold.</EmptyState>}
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3">
            {shelf.slice(0, 8).map((b) => {
              const life = Math.max(0, Math.min(1, b.hoursLeft / shelfHours()))
              const m1Left = modelShelfLeft(b)
              const tone = b.hoursLeft <= 0 ? 'bg-danger' : b.hoursLeft < 6 ? 'bg-danger' : b.hoursLeft < 12 ? 'bg-haldi' : 'bg-forest-2'
              const day = milkDay(b.collected_at)
              return (
                <li key={b.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{litres(+b.remaining.toFixed(1))} {milkLabel[b.milk_type].toLowerCase()}
                        {b.quality && <span className="ml-2 rounded-full bg-mint-soft px-2 py-0.5 text-[11.5px] font-semibold text-forest">{gradeLabel[b.quality]}{b.model_quality ? ` · ${b.model_quality}` : ''}</span>}</p>
                      <p className="truncate text-[12.5px] text-muted">from {b.farmer?.full_name} · tested {dateTimeShort(b.reading_at ?? b.collected_at)}{b.freshness_score != null ? ` · freshness ${b.freshness_score}/100` : ''}{b.spoilage_pct != null ? ` · ${Math.round(b.spoilage_pct)}% spoilage risk` : ''}</p>
                      {m1Left != null && b.hoursLeft > 0 && (m1Left > 0
                        ? <p className="truncate text-[12px] text-muted">AI shelf life: about {Math.max(1, Math.round(m1Left))} h left</p>
                        : <p className="truncate text-[12px] font-medium text-amber">Past the AI's predicted shelf life. Still usable for its 2 days, sell it first.</p>)}
                    </div>
                    {b.hoursLeft <= 0 ? (
                      <span className="shrink-0 rounded-full bg-[#f8e2dc] px-2.5 py-1 text-[12px] font-semibold text-danger">Expired</span>
                    ) : (
                      <span className="shrink-0 text-right">
                        <span className={`block rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${day >= 2 ? 'bg-haldi-soft text-amber' : 'bg-mint-soft text-forest'}`}>Day {Math.min(day, 2)}</span>
                        <span className={`num mt-0.5 block text-[12.5px] font-semibold ${b.hoursLeft < 12 ? 'text-amber' : 'text-muted'}`}>{Math.round(b.hoursLeft)} h left</span>
                      </span>
                    )}
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-cream-2"><div className={`h-1.5 rounded-full ${tone}`} style={{ width: `${life * 100}%` }} /></div>
                </li>
              )
            })}
          </ul>
          {shelf.length > 8 && <p className="mt-3 text-[13px] text-muted">and {shelf.length - 8} fresher batches</p>}
        </Card>

        <Card title="Taken out of stock" subtitle="Milk that spoiled or was used at home">
          {data && data.usage.length === 0 && <p className="py-6 text-center text-muted">Nothing recorded yet.</p>}
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line">
            {data?.usage.slice(0, 10).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{usageLabel[u.reason]}</p>
                  <p className="truncate text-[12.5px] text-muted">{u.note ?? milkLabel[u.milk_type]} · {date(u.created_at)}, {timeOf(u.created_at)}</p>
                </div>
                <span className="flex shrink-0 items-center gap-3">
                  {canUndo(u) && <button className="text-[12.5px] font-semibold text-forest hover:underline" onClick={() => undo(u)}>Undo</button>}
                  <span className={`num text-[14px] font-semibold ${u.reason === 'spoiled' ? 'text-danger' : ''}`}>−{litres(u.litres)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

// one day of the center: milk bought from farmers against milk sold, sent in bulk or lost
function DayBook({ stamp }) {
  const [day, setDay] = useState(todayKey)
  const first = useLoad(myFirstDay)
  const book = useLoad(() => dayBook(day), [day, stamp])
  const rows = (book.data ?? []).slice().sort((a, b) => TYPES.indexOf(a.milk_type) - TYPES.indexOf(b.milk_type))
  const sum = (k) => rows.reduce((n, r) => n + Number(r[k] ?? 0), 0)
  const r1 = (n) => Math.round(Number(n) * 10) / 10
  const bought = sum('bought_l'), paid = sum('paid_farmers'), app = sum('sold_l'), bulk = sum('bulk_l'), lost = sum('spoiled_l') + sum('used_l')
  const quiet = book.data && bought + app + bulk + lost === 0
  return (
    <Card className="mt-4 sm:mt-5" title="Day book" subtitle="Pick any day since your center opened. Sales count when the milk is delivered."
      action={<DayPicker value={day} onChange={setDay} min={first.data ?? undefined} />}>
      <Alert>{book.error}</Alert>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ['Bought from farmers', litres(r1(bought)), `${rs(Math.round(paid))} paid`],
          ['App orders delivered', litres(r1(app)), `${rs(Math.round(sum('sales')))} earned`],
          ['Bulk orders delivered', litres(r1(bulk)), `${rs(Math.round(sum('bulk_sales')))} earned`],
          ['Spoiled or used', litres(r1(lost)), lost > 0 ? `${litres(r1(sum('spoiled_l')))} spoiled` : 'nothing lost'],
        ].map(([k, v, n]) => (
          <div key={k} className="rounded-[18px] bg-cream px-4 py-3">
            <p className="text-[12.5px] text-muted">{k}</p>
            <p className="display num mt-0.5 truncate text-[20px] text-forest-deep sm:text-[24px]">{book.data ? v : '—'}</p>
            <p className="truncate text-[12px] text-muted">{book.data ? n : ''}</p>
          </div>
        ))}
      </div>
      {quiet ? <p className="mt-5 rounded-2xl border border-dashed border-line px-4 py-6 text-center text-[13.5px] text-muted">No milk came in or went out on this day.</p> : (
        <div className="mt-5 overflow-x-auto">
          <table className="table min-w-[620px] [&_td]:whitespace-nowrap">
            <thead><tr><th>Milk</th><th className="text-right">Bought</th><th className="text-right">Paid</th><th className="text-right">App orders</th><th className="text-right">Bulk orders</th><th className="text-right">Sales</th><th className="text-right">Spoiled / used</th></tr></thead>
            <tbody>
              {!book.data && <tr><td colSpan={7}><div className="skeleton h-24" /></td></tr>}
              {rows.map((r) => (
                <tr key={r.milk_type}>
                  <td className="font-semibold">{milkLabel[r.milk_type]}</td>
                  <td className="num text-right">{litres(r1(r.bought_l))}</td>
                  <td className="num text-right text-muted">{rs(Math.round(r.paid_farmers))}</td>
                  <td className="num text-right">{litres(r1(r.sold_l))}</td>
                  <td className="num text-right">{litres(r1(r.bulk_l))}</td>
                  <td className="num text-right font-semibold">{rs(Math.round(Number(r.sales) + Number(r.bulk_sales)))}</td>
                  <td className={`num text-right ${Number(r.spoiled_l) > 0 ? 'text-danger' : 'text-muted'}`}>{litres(r1(Number(r.spoiled_l) + Number(r.used_l)))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function UsageForm({ value, stock, onClose, onSaved }) {
  const { toast } = useUi()
  const [u, setU] = useState(() => ({ milk_type: 'buffalo', reason: 'spoiled', litres: '', note: '', ...value }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const avail = stock?.find((s) => s.milk_type === u.milk_type)
  const max = avail ? stockLeft(avail) : 0
  const submit = async (e) => {
    e.preventDefault()
    const l = Number(u.litres)
    if (!(l > 0)) return setErr('Enter how many litres.')
    if (l > max + 0.01) return setErr(`Only ${Math.round(max)} L of ${milkLabel[u.milk_type].toLowerCase()} milk is in stock.`)
    setBusy(true)
    try { await recordUsage(u); toast(`${litres(l)} taken out of stock.`); onSaved(); onClose() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <Sheet open={value !== null} onClose={onClose} title="Take milk out of stock" subtitle="For milk that left stock without a sale, for example milk that went sour."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="usage-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="usage-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><span className="label">Milk</span>
          <Segmented value={u.milk_type} onChange={(v) => setU({ ...u, milk_type: v })} options={TYPES.map((t) => ({ value: t, label: milkLabel[t] }))} />
          <span className="hint">{Math.round(max)} L in stock</span></div>
        <div className="field"><label htmlFor="ul">Litres</label><input id="ul" className="input w-40" type="number" inputMode="decimal" min="0.5" step="0.5" value={u.litres} onChange={(e) => setU({ ...u, litres: e.target.value })} /></div>
        <div className="field"><span className="label">Reason</span>
          <Segmented value={u.reason} onChange={(v) => setU({ ...u, reason: v })} options={[{ value: 'spoiled', label: 'Spoiled' }, { value: 'own_use', label: 'Own use' }]} /></div>
        <div className="field"><label htmlFor="un">Note</label><input id="un" className="input" maxLength={200} placeholder="e.g. turned sour overnight" value={u.note} onChange={(e) => setU({ ...u, note: e.target.value })} /></div>
      </form>
    </Sheet>
  )
}

