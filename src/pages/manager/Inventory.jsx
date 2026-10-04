import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { Link } from 'react-router-dom'
import {
  milkStock, stockBatches, usageLog, recordUsage, undoUsage, shelfBatches, stockLeft, milkLabel, usageLabel, timeOf,
} from '../../lib/center'
import { litres, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'

const TYPES = ['buffalo', 'cow', 'mixed']

export default function Inventory() {
  const { data, error, reload } = useLoad(async () => {
    const [stock, batches, usage] = await Promise.all([milkStock(), stockBatches(), usageLog()])
    return { stock, batches, usage }
  })
  const [usage, setUsage] = useState(null)

  return (
    <>
      <PageHeader title="Inventory" description="Milk on your shelf, which milk to sell first, and milk that left stock without a sale.">
        <Link to="/manager/shop" className="btn-secondary"><Icon name="store" size={17} />Listings on the app</Link>
        <button className="btn-primary" onClick={() => setUsage({})}><Icon name="minus" size={17} />Take milk out</button>
      </PageHeader>
      <Alert>{error}</Alert>
      <MilkStock data={data} onUse={setUsage} onChanged={reload} />
      <UsageForm key={usage ? 'usage-' + (usage.milk_type ?? '') : 'usage-closed'} value={usage} stock={data?.stock} onClose={() => setUsage(null)} onSaved={reload} />
    </>
  )
}

function MilkStock({ data, onUse, onChanged }) {
  const { toast, confirm } = useUi()
  // a wrong entry can be taken back for 15 minutes, after that it stays in the history
  const canUndo = (u) => Date.now() - new Date(u.created_at) < 15 * 6e4
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
          const soon = mine.filter((b) => b.hoursLeft < 12).reduce((n, b) => n + b.remaining, 0)
          return (
            <div key={t} className="panel animate-rise p-5">
              <p className="text-[13px] font-semibold text-muted">{milkLabel[t]} milk</p>
              <p className="display num mt-2 text-[34px]">{data ? litres(Math.round(left)) : '—'}</p>
              <p className="text-[13px] text-muted">{left <= 0 ? 'Nothing in stock' : soon > 0 ? <span className="font-semibold text-amber">{Math.round(soon)} L to sell within 12 h</span> : `freshest from ${mine[mine.length - 1] ? relative(mine[mine.length - 1].collected_at) : 'today'}`}</p>
              {s && (
                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-line pt-3 text-[12px] text-muted">
                  <div><dt>Bought</dt><dd className="num font-semibold text-ink">{Math.round(s.bought_l)} L</dd></div>
                  <div><dt>Sold</dt><dd className="num font-semibold text-ink">{Math.round(Number(s.sold_l) + Number(s.bulk_l))} L</dd></div>
                  <div><dt>Used</dt><dd className="num font-semibold text-ink">{Math.round(s.used_l)} L</dd></div>
                </dl>
              )}
            </div>
          )
        })}
      </div>

      <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Card title="Sell first" subtitle="Milk on the shelf, oldest shelf life first. Based on each collection’s AI freshness estimate.">
          {data && shelf.length === 0 && <EmptyState title="The shelf is empty">Accepted milk shows up here until it is sold.</EmptyState>}
          <ul className="grid gap-3">
            {shelf.slice(0, 8).map((b) => {
              const life = Math.max(0, Math.min(1, b.hoursLeft / (b.freshness_hours || 24)))
              const tone = b.hoursLeft <= 0 ? 'bg-danger' : b.hoursLeft < 6 ? 'bg-danger' : b.hoursLeft < 12 ? 'bg-haldi' : 'bg-forest-2'
              return (
                <li key={b.id} className="rounded-2xl border border-line bg-white px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{litres(+b.remaining.toFixed(1))} {milkLabel[b.milk_type].toLowerCase()}</p>
                      <p className="truncate text-[12.5px] text-muted">from {b.farmer?.full_name}, {relative(b.collected_at)}</p>
                    </div>
                    {b.hoursLeft <= 0 ? (
                      <button className="btn-danger btn-sm shrink-0" onClick={() => onUse({ milk_type: b.milk_type, litres: +b.remaining.toFixed(1), reason: 'spoiled' })}>Past shelf life</button>
                    ) : (
                      <span className={`num shrink-0 text-[13px] font-semibold ${b.hoursLeft < 12 ? 'text-amber' : 'text-forest'}`}>{Math.round(b.hoursLeft)} h left</span>
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
        <div className="field"><label htmlFor="ul">Litres</label><input id="ul" className="input w-40" type="number" min="0.5" step="0.5" value={u.litres} onChange={(e) => setU({ ...u, litres: e.target.value })} /></div>
        <div className="field"><span className="label">Reason</span>
          <Segmented value={u.reason} onChange={(v) => setU({ ...u, reason: v })} options={[{ value: 'spoiled', label: 'Spoiled' }, { value: 'own_use', label: 'Own use' }]} /></div>
        <div className="field"><label htmlFor="un">Note</label><input id="un" className="input" placeholder="e.g. turned sour overnight" value={u.note} onChange={(e) => setU({ ...u, note: e.target.value })} /></div>
      </form>
    </Sheet>
  )
}

