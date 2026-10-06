import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import {
  farmerCollections, sendPayout, demoAnswerPayout, farmerPayouts, myCenter, payoutStatusLabel, payoutTone, paymentLabel, dayKey, shortDay, weekday, timeOf, milkLabel, gradeLabel, gradeTone,
} from '../../lib/center'
import { rs, litres, date, dateTime } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card, { Kpi } from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import Sheet from '../../components/Sheet'
import Receipt from '../../components/Receipt'
import { TrendChart, C } from '../../components/charts'
import { FarmerForm } from './Farmers'
import { refError } from '../../lib/validate'

export default function FarmerDetail() {
  const { id } = useParams()
  const { toast } = useUi()
  const { profile } = useAuth()
  const [editing, setEditing] = useState(null)
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(null)
  const [busy, setBusy] = useState(null)
  const [shown, setShown] = useState(15)
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const { data, error, reload } = useLoad(async () => {
    const [{ data: farmer, error: e1 }, { data: stats }, rows, payouts] = await Promise.all([
      supabase.from('farmers').select('*').eq('id', id).single(),
      supabase.from('farmer_stats').select('*').eq('farmer_id', id).maybeSingle(),
      farmerCollections(id),
      farmerPayouts(id),
    ])
    if (e1) throw e1
    return { farmer, stats: stats ?? {}, rows, payouts }
  }, [id])

  const f = data?.farmer
  const s = data?.stats ?? {}
  const rows = data?.rows ?? []
  const awaiting = Number(s.awaiting_confirmation || 0)
  const unpaid = Math.max(0, Number(s.unpaid_amount || 0) - awaiting)
  const payouts = data?.payouts ?? []
  const pending = payouts.find((p) => p.status === 'sent')

  // litres accepted per day for the last 30 days
  const byDay = {}
  rows.filter((r) => r.status === 'accepted').forEach((r) => { const k = dayKey(r.collected_at); byDay[k] = (byDay[k] || 0) + Number(r.quantity_l) })
  const series = Array.from({ length: 30 }, (_, i) => { const k = dayKey(Date.now() - (29 - i) * 864e5); return { day: k, litres: +(byDay[k] || 0).toFixed(1) } })
  const recent30 = rows.filter((r) => Date.now() - new Date(r.collected_at) < 30 * 864e5)
  const accepted30 = recent30.filter((r) => r.status === 'accepted')
  const avgPrice = accepted30.length ? accepted30.reduce((n, r) => n + Number(r.total_amount), 0) / accepted30.reduce((n, r) => n + Number(r.quantity_l), 0) : 0
  const premium = s.tests_30d ? Math.round((s.premium_30d / s.tests_30d) * 100) : 0

  // demo accounts only: the farmer's answer, as it would come from the app
  const demoAnswer = async (p, yes) => {
    setBusy(p.id)
    try {
      await demoAnswerPayout(p.id, yes)
      const fresh = await farmerPayouts(id)
      await reload()
      if (yes) { toast(`${f.full_name} confirmed the payment.`); setReceipt(fresh.find((x) => x.id === p.id)) }
      else toast(`${f.full_name} says the money did not arrive. The milk is back to unpaid.`, 'error')
    } catch (e) { toast(e.message, 'error') }
    setBusy(null)
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
        <Kpi accent label="You owe" value={data ? rs(Math.round(unpaid)) : null}
          note={awaiting > 0 ? `${rs(Math.round(awaiting))} sent, waiting for the farmer to confirm` : unpaid > 0 ? 'for accepted milk not yet paid' : 'All paid up'}>
          {unpaid > 0 && !pending && <button className="btn-haldi btn-sm w-full" onClick={() => setPaying(true)}>Send payment</button>}
        </Kpi>
        <Kpi label="Milk in 30 days" value={data ? litres(Math.round(s.litres_30d || 0)) : null} note={`${accepted30.length} drop-offs`} />
        <Kpi label="Earned in 30 days" value={data ? rs(Math.round(s.earned_30d || 0)) : null} note={avgPrice ? `average ${rs(Math.round(avgPrice))} per litre` : ' '} />
        <Kpi label="Quality" value={data ? `${premium}%` : null} note={`rated Good${Number(s.failed_30d) ? ` · ${s.failed_30d} failed tests` : ' · no failed tests'}`} />
      </div>

      <Card className="mt-4 sm:mt-5" title="Milk supplied" subtitle="Litres accepted each day, last 30 days">
        <TrendChart data={series} height={200} ariaLabel="Litres supplied per day"
          series={[{ key: 'litres', label: 'Milk', color: C.green, type: 'bar' }]}
          xFormat={(v, i, full) => (full ? `${weekday(v)}, ${shortDay(v)}` : shortDay(v))}
          yFormat={(v, full) => (full ? litres(v) : `${Math.round(v)} L`)} />
      </Card>

      <Card className="mt-4 sm:mt-5" title="Payments" subtitle="Each payment is final only when the farmer confirms it in the app" bodyClass="pt-3">
        {data && payouts.length === 0 && <p className="py-6 text-center text-[14px] text-muted">No payments yet.</p>}
        <ul className="grid gap-2">
          {payouts.slice(0, 8).map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold"><span className="num">{rs(Math.round(p.amount))}</span> <span className="text-[13px] font-normal text-muted">by {paymentLabel[p.method]}{p.reference ? ` · ${p.reference}` : ''}</span></p>
                <p className="text-[12.5px] text-muted">{p.collections} {p.collections === 1 ? 'drop-off' : 'drop-offs'}, {litres(p.litres)} · sent {dateTime(p.created_at)}{p.farmer_note ? ` · “${p.farmer_note}”` : ''}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={payoutTone[p.status]}>{payoutStatusLabel[p.status]}</Badge>
                {p.receipt_no && <button className="text-[12.5px] font-semibold text-forest hover:underline" onClick={() => setReceipt(p)}>Receipt {p.receipt_no}</button>}
                {p.status === 'sent' && center?.is_demo && <>
                  <button className="btn-primary btn-sm" disabled={busy === p.id} onClick={() => demoAnswer(p, true)}>Farmer confirms (demo)</button>
                  <button className="btn-secondary btn-sm" disabled={busy === p.id} onClick={() => demoAnswer(p, false)}>Not received (demo)</button>
                </>}
              </div>
            </li>
          ))}
        </ul>
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
                    {r.status === 'accepted' && <Badge tone={r.payment === 'paid' ? 'green' : r.payout_id ? 'blue' : 'amber'}>{r.payment === 'paid' ? 'Paid' : r.payout_id ? 'Payment sent' : 'Not paid'}</Badge>}
                    {r.receipt_no && <button className="ml-2 text-[12px] font-semibold text-forest hover:underline" onClick={() => setReceipt({ ...r, farmer: f, _kind: 'collection' })}>{r.receipt_no}</button>}
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
      {paying && <PaySheet farmer={f} amount={unpaid} onClose={() => setPaying(false)} onSent={reload} />}
      <Receipt kind={receipt?._kind ?? 'payout'} data={receipt} center={center} farmer={f} onClose={() => setReceipt(null)} />
    </>
  )
}

function PaySheet({ farmer, amount, onClose, onSent }) {
  const { toast } = useUi()
  const [method, setMethod] = useState('jazzcash')
  const [ref, setRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    if (method !== 'cash' && refError(ref)) return setErr(refError(ref))
    setBusy(true); setErr('')
    try { await sendPayout(farmer.id, method, method === 'cash' ? '' : ref.trim()); toast(`${rs(Math.round(amount))} sent. ${farmer.full_name} confirms it in the app.`); onSent(); onClose() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Sheet open onClose={onClose} title={`Pay ${farmer.full_name}`} subtitle={`${rs(Math.round(amount))} for accepted milk not yet paid`}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : `Send ${rs(Math.round(amount))}`}</button></>}>
      <Alert>{err}</Alert>
      <p className="text-[13px] font-semibold">How are you paying?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {['jazzcash', 'easypaisa', 'bank', 'cash'].map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)}
            className={`rounded-2xl border px-4 py-3 text-left font-semibold transition-all ${method === m ? 'border-forest bg-mint-soft ring-2 ring-forest/15' : 'border-line bg-white hover:border-forest/40'}`}>{paymentLabel[m]}</button>
        ))}
      </div>
      {method !== 'cash' && (
        <div className="field mt-5"><label htmlFor="pref">Transaction ID</label><input id="pref" className="input num" maxLength={30} placeholder="e.g. 0123456789" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      )}
      <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-[12.5px] text-muted">
        {farmer.full_name.split(' ')[0]} gets a message in the ApnaDairy app to confirm the money arrived. The milk counts as paid only after they confirm, and a receipt is generated. If they say it did not arrive, it goes back to unpaid.
      </p>
    </Sheet>
  )
}
