import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { useAuth } from '../../context/AuthContext'
import {
  collectionsOn, myCenter, expireMyOffers, demoFarmerAnswer, cancelCollection, correctCollection, offerExpiresAt,
  todayKey, dayKey, shortDay, timeOf, milkLabel, gradeLabel, gradeTone, PARAMS, inRange,
} from '../../lib/center'
import Receipt from '../../components/Receipt'
import Sheet from '../../components/Sheet'
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
  const { profile } = useAuth()
  // unanswered offers older than 2 hours are closed first, so the list is never stale
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const { data, error, loading, reload } = useLoad(async () => { await expireMyOffers().catch(() => {}); return collectionsOn(day) }, [day])
  const { toast, confirm } = useUi()
  const [busy, setBusy] = useState(null)
  const [receipt, setReceipt] = useState(null)
  const [fixing, setFixing] = useState(null)

  const rows = (data ?? []).filter((c) => shift === 'all' || c.shift === shift)
  const accepted = rows.filter((c) => c.status === 'accepted')
  const waiting = rows.filter((c) => c.status === 'offered')
  const failed = rows.filter((c) => c.reject_reason === 'Failed the quality test')
  const byShift = (s) => (data ?? []).filter((c) => c.shift === s && c.status === 'accepted').reduce((n, c) => n + Number(c.quantity_l), 0)

  const run = async (c, fn, done) => {
    setBusy(c.id)
    try { const r = await fn(); toast(done(r)); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }
  // demo accounts only: the farmer's answer, as it would come from the app
  const demoAnswer = (c, accept) => run(c, () => demoFarmerAnswer(c.id, accept),
    (r) => r === 'expired' ? 'This offer had expired, so it was closed.' : accept ? `${c.farmer?.full_name} accepted. ${litres(c.quantity_l)} added to stock.` : `${c.farmer?.full_name} refused the offer.`)
  const cancel = async (c) => {
    const reason = await confirm({ title: c.status === 'offered' ? 'Cancel this offer?' : 'Cancel this collection?',
      body: `${litres(c.quantity_l)} from ${c.farmer?.full_name}. ${c.status === 'accepted' ? 'The milk leaves your stock. ' : ''}The reason is saved in the history and the farmer sees it.`,
      input: 'Reason (required)', confirmLabel: 'Cancel it', danger: true, cancelLabel: 'Keep it' })
    if (!reason) return
    if (reason === true) return toast('Give a reason for cancelling.', 'error')
    run(c, () => cancelCollection(c.id, reason), () => 'Cancelled. The reason is saved in the history.')
  }
  const canChange = (c) => c.status !== 'rejected' && !c.payout_id && c.payment !== 'paid' && Date.now() - new Date(c.collected_at) < 24 * 36e5
  const props = { busy, demo: center?.is_demo, onDemo: demoAnswer, onCancel: cancel, onFix: setFixing, onReceipt: setReceipt, canChange }

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
                  <td><Readings c={c} />{c.test_source === 'manual' && <Manual c={c} />}</td>
                  <td>{c.quality ? <Badge tone={gradeTone[c.quality]} dot={false}>{gradeLabel[c.quality]}</Badge> : <Badge tone="red" dot={false}>Failed</Badge>}</td>
                  <td className="num text-right">{c.price_per_l ? <>{rs(c.price_per_l)}<p className="text-[12.5px] text-muted">{rs(Math.round(c.total_amount))}</p></> : <span className="text-muted">—</span>}</td>
                  <td><Status c={c} {...props} /></td>
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
                <div><Readings c={c} />{c.test_source === 'manual' && <Manual c={c} />}</div>
                {c.price_per_l && <p className="num text-right text-[13px]"><b>{rs(Math.round(c.total_amount))}</b><br /><span className="text-muted">{rs(c.price_per_l)}/L</span></p>}
              </div>
              <div className="mt-3"><Status c={c} {...props} /></div>
            </li>
          ))}
        </ul>
      </div>
      {accepted.length > 0 && (
        <p className="mt-3 text-right text-[13.5px] text-muted">
          Bought <b className="text-ink">{litres(Math.round(accepted.reduce((n, c) => n + Number(c.quantity_l), 0)))}</b> for <b className="text-ink">{rs(Math.round(accepted.reduce((n, c) => n + Number(c.total_amount), 0)))}</b>
        </p>
      )}
      <Receipt kind="collection" data={receipt} center={center} onClose={() => setReceipt(null)} />
      <CorrectSheet key={fixing?.id ?? 'none'} c={fixing} onClose={() => setFixing(null)} onSaved={reload} />
    </>
  )
}

function Manual({ c }) {
  return (
    <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-haldi-soft px-1.5 py-0.5 text-[11.5px] font-semibold text-amber" title={c.manual_reason ?? 'Readings typed by hand'}>
      <Icon name="edit" size={11} />Typed by hand{c.manual_reason ? `: ${c.manual_reason}` : ''}
    </p>
  )
}

// litres typed wrong: correct them with a reason; the farmer accepts the corrected offer again
function CorrectSheet({ c, onClose, onSaved }) {
  const { toast } = useUi()
  const [qty, setQty] = useState(c ? String(Number(c.quantity_l)) : '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    if (!reason.trim()) return toast('Give a reason for the correction.', 'error')
    setBusy(true)
    try { await correctCollection(c.id, qty, reason); toast('Corrected. The farmer gets the new offer to accept in the app.'); onSaved(); onClose() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <Sheet open={!!c} onClose={onClose} title="Correct the litres" subtitle={c ? `${c.farmer?.full_name}, recorded at ${timeOf(c.collected_at)}` : ''}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save correction'}</button></>}>
      {c && (
        <div className="grid gap-4">
          <div className="field"><label htmlFor="cq">Correct litres</label>
            <div className="flex items-center gap-2"><input id="cq" className="input num w-32" type="number" min="0.5" step="0.5" value={qty} onChange={(e) => setQty(e.target.value)} /><span className="text-muted">was {litres(c.quantity_l)}</span></div></div>
          <div className="field"><label htmlFor="cr">Reason</label><input id="cr" className="input" placeholder="e.g. typed 21 instead of 12" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <p className="rounded-2xl bg-cream px-4 py-3 text-[13px] text-muted">The test result and price stay the same. The change and your reason are saved in the history, and the farmer must accept the corrected offer in the app.</p>
        </div>
      )}
    </Sheet>
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

function Status({ c, busy, demo, onDemo, onCancel, onFix, onReceipt, canChange }) {
  const off = busy === c.id ? 'pointer-events-none opacity-50' : ''
  if (c.status === 'offered') {
    const mins = Math.max(0, Math.round((offerExpiresAt(c) - Date.now()) / 6e4))
    return (
      <div className={off}>
        <span className="flex items-center gap-1 text-[12.5px] font-semibold text-amber"><Icon name="clock" size={14} />Waiting for farmer</span>
        <p className="text-[12px] text-muted">answers in the app · {mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`} left</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {demo && <button className="btn-primary btn-sm" onClick={() => onDemo(c, true)}>Accepts (demo)</button>}
          {demo && <button className="btn-secondary btn-sm" onClick={() => onDemo(c, false)}>Refuses (demo)</button>}
          <button className="btn-ghost btn-sm" onClick={() => onFix(c)}>Correct</button>
          <button className="btn-ghost btn-sm text-danger" onClick={() => onCancel(c)}>Cancel</button>
        </div>
      </div>
    )
  }
  if (c.status === 'rejected') return <div><Badge tone={c.reject_reason === 'Failed the quality test' ? 'red' : 'grey'}>Not bought</Badge><p className="mt-1 max-w-[200px] text-[12px] text-muted">{c.reject_reason}</p></div>
  return (
    <div className={off}>
      <Badge status="accepted">In stock</Badge>
      <p className="mt-1 text-[12px] text-muted">{c.payment === 'paid' ? 'Farmer paid' : c.payout_id ? 'Payment sent, waiting for farmer' : 'Not paid yet'}</p>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {c.receipt_no && <button className="text-[12.5px] font-semibold text-forest hover:underline" onClick={() => onReceipt(c)}>Receipt {c.receipt_no}</button>}
        {canChange(c) && <button className="text-[12.5px] font-semibold text-muted hover:text-ink" onClick={() => onFix(c)}>Correct</button>}
        {canChange(c) && <button className="text-[12.5px] font-semibold text-danger hover:underline" onClick={() => onCancel(c)}>Cancel</button>}
      </div>
    </div>
  )
}
