import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { requirementForCenter, placeBid, withdrawBid, milkLabel, qualityLabel, qualityHint, myProductCapacity, isMilk, qtyText, perUnit, productLabel } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { bidCapacity, todayKey } from '../../lib/center'
import { useUi } from '../../context/UiContext'
import { rs, litres, date, dateTime, relative, cap } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Loader from '../../components/Loader'
import { MilkChurn } from '../../components/Farm'
import OffersList from '../../components/OffersList'

const freshPicks = [6, 12, 24, 48]

// fresh stock (if delivery is within 2 days) + about 2 days of collection − milk already promised
function Capacity({ cap, kind, over, onUse, useLabel }) {
  const r1 = (n) => Math.round(Number(n) * 10) / 10
  const none = Number(cap.max_l) < 1
  const rows = [
    Number(cap.days) < 2 && ['Fresh in stock now', `${litres(r1(cap.stock_l))}`],
    Number(cap.coming_l) > 0 && [`Collected by then (about ${litres(Math.round(cap.daily_l))} a day)`, `+ ${litres(r1(cap.coming_l))}`],
    Number(cap.promised_l) > 0 && ['Already promised around that day', `− ${litres(r1(cap.promised_l))}`],
  ].filter(Boolean)
  return (
    <div className={`-mt-2 rounded-2xl px-4 py-3 text-[13px] ${over || none ? 'bg-[#f8e2dc] text-danger' : 'bg-cream text-muted'}`}>
      <dl className="grid gap-1">
        {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt>{k}</dt><dd className="num shrink-0">{v}</dd></div>)}
        <div className={`mt-1 flex justify-between gap-3 border-t pt-1.5 font-semibold ${over || none ? 'border-danger/20' : 'border-line text-ink'}`}><dt>You can offer</dt><dd className="num shrink-0">{litres(cap.max_l)}</dd></div>
      </dl>
      {none && <p className="mt-2 text-[12.5px]">{Number(cap.daily_l) > 0 ? `Your ${kind} for that day is already promised. Pick another delivery date.` : `You have no ${kind} to offer yet. Buy and test milk from farmers first.`}</p>}
      {over && !none && <p className="mt-2 text-[12.5px]">You can’t offer more milk than you will have. <button type="button" className="font-semibold underline" onClick={onUse}>Use {useLabel}</button></p>}
      {!over && !none && Number(cap.days) >= 2 && <p className="mt-2 text-[12px]">Delivery is 2 or more days away, so only fresh milk from the 2 days before it counts.</p>}
    </div>
  )
}

// byproducts: stock not promised to anyone, plus what the seller says they will make by the delivery date
function ProductCapacity({ cap, unit, make, over }) {
  const Q = (n) => qtyText(Math.round(Number(n) * 100) / 100, unit)
  return (
    <div className={`-mt-2 rounded-2xl px-4 py-3 text-[13px] ${over ? 'bg-[#f8e2dc] text-danger' : 'bg-cream text-muted'}`}>
      <dl className="grid gap-1">
        <div className="flex justify-between gap-3"><dt>In stock now</dt><dd className="num shrink-0">{Q(cap.stock)}</dd></div>
        {Number(cap.promised) > 0 && <div className="flex justify-between gap-3"><dt>Already promised in other bids and orders</dt><dd className="num shrink-0">− {Q(cap.promised)}</dd></div>}
        {Number(make) > 0 && <div className="flex justify-between gap-3"><dt>You will make by the delivery date</dt><dd className="num shrink-0">+ {Q(make)}</dd></div>}
        <div className={`mt-1 flex justify-between gap-3 border-t pt-1.5 font-semibold ${over ? 'border-danger/20' : 'border-line text-ink'}`}><dt>You can offer</dt><dd className="num shrink-0">{Q(Number(cap.available) + Number(make || 0))}</dd></div>
      </dl>
      {over && <p className="mt-2 text-[12.5px]">You can't offer more than you have plus what you will make. Update your stock on the Products page if it has changed.</p>}
    </div>
  )
}

function BidForm({ req, onSaved }) {
  const milk = isMilk(req)
  const Q = (n) => qtyText(n, req.unit)
  const { toast, confirm } = useUi()
  const mine = req.my_bid
  const live = mine?.status === 'submitted'
  const [f, setF] = useState(() => ({
    price: live ? mine.price_per_l : '',
    quantity: live ? mine.quantity_l : (req.remaining_l ?? req.quantity_l),
    delivery_date: live ? mine.delivery_date : req.required_date,
    max_age: live ? mine.max_age_hours ?? '' : req.quality === 'fresh' ? 12 : '',
    notes: live ? mine.notes ?? '' : '',
    make: live ? String(Number(mine.make_qty ?? 0)) : '0',
  }))
  const [today] = useState(todayKey)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e?.target ? e.target.value : e }))
  // what the center can really supply on the delivery day; the database checks the same numbers
  const { data: capacity } = useLoad(() => (!milk ? myProductCapacity(req.product, req.id) : f.delivery_date >= today ? bidCapacity(req.milk_type, f.delivery_date, req.id) : Promise.resolve(null)), [req.milk_type, req.product, f.delivery_date, req.id])
  const make = milk ? 0 : Math.max(0, Number(f.make) || 0)
  const capMax = capacity ? (milk ? Number(capacity.max_l) : Number(capacity.available) + make) : null
  const need = req.remaining_l ?? Number(req.quantity_l)
  const maxBid = capacity ? Math.min(need, capMax) : need
  const overCap = capacity && Number(f.quantity) > capMax
  const makeBad = !milk && (make > Number(f.quantity) || (make > 0 && f.delivery_date <= today))
  const kind = req.milk_type === 'mixed' ? 'milk' : milkLabel[req.milk_type]?.toLowerCase()

  const total = Number(f.price || 0) * Number(f.quantity || 0)
  const t = Number(req.target_price)
  const pricePicks = t ? [t - 4, t - 2, t, t + 2] : []
  const diff = t && f.price ? Number(f.price) - t : null

  const warnings = []
  if (Number(f.quantity) > need) warnings.push(`Only ${Q(need)} is still needed.`)
  else if (Number(f.quantity) < need) warnings.push(`You're offering less than the ${Q(need)} needed. The buyer can combine bids.`)
  if (f.delivery_date > req.required_date) warnings.push(`You'd deliver after ${date(req.required_date)}.`)
  if (milk && req.quality === 'fresh' && (!f.max_age || Number(f.max_age) > 24)) warnings.push('Farm fresh means milk under 24 hours old.')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await placeBid({
        p_requirement: req.id, p_price: Number(f.price), p_quantity: Number(f.quantity), p_delivery_date: f.delivery_date,
        p_max_age_hours: milk && f.max_age ? Number(f.max_age) : null, p_notes: f.notes.trim() || null, p_make: make,
      })
      toast(live ? 'Bid updated. The buyer sees your new price.' : 'Bid sent. Good luck!')
      await onSaved()
    } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  const withdraw = async () => {
    const ok = await confirm({ title: 'Withdraw your bid?', body: 'You can bid again any time before bidding closes.', confirmLabel: 'Withdraw', danger: true, cancelLabel: 'Keep bid' })
    if (!ok) return
    setBusy(true)
    try { await withdrawBid(mine.id); toast('Bid withdrawn.'); await onSaved() } catch (err) { toast(err.message, 'error') }
    setBusy(false)
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="field">
        <label htmlFor="price">Your price per {milk ? 'litre' : perUnit(req.unit)}</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[18px] text-muted">Rs</span>
          <input id="price" type="number" min="1" step="0.5" required className="input num h-14 w-full pl-12 text-[22px] font-bold" value={f.price} onChange={set('price')} placeholder={t || '190'} />
        </div>
        {pricePicks.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {pricePicks.map((p) => (
              <button key={p} type="button" onClick={() => set('price')(String(p))}
                className={`num rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${Number(f.price) === p ? 'bg-forest text-cream' : 'bg-cream-2 hover:bg-mint-soft'}`}>
                {p}{p === t ? ' (target)' : ''}
              </button>
            ))}
          </div>
        )}
        {diff != null && (
          <p className={`text-[12.5px] font-medium ${diff <= 0 ? 'text-forest' : 'text-amber'}`}>
            {diff === 0 ? "Exactly the buyer's target." : `${rs(Math.abs(diff))} ${diff < 0 ? 'below' : 'above'} the buyer's target.`}
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="field">
          <label htmlFor="q">{milk ? 'Litres' : `Quantity (${perUnit(req.unit) === 'L' ? 'litres' : perUnit(req.unit) === 'pack' ? 'packs' : 'kg'})`}</label>
          <input id="q" type="number" min="1" max={maxBid || undefined} step="1" required className={`input num ${overCap ? 'border-danger' : ''}`} value={f.quantity} onChange={set('quantity')} />
        </div>
        <div className="field">
          <label htmlFor="d">Delivery date</label>
          <input id="d" type="date" required className="input num" min={today} value={f.delivery_date} onChange={set('delivery_date')} />
        </div>
      </div>
      {!milk && (
        <div className="field">
          <label htmlFor="mk">Of this, how much will you make by the delivery date?</label>
          <input id="mk" type="number" min="0" step="0.5" className={`input num w-40 ${makeBad ? 'border-danger' : ''}`} value={f.make} onChange={set('make')} />
          <span className={`hint ${makeBad ? 'font-semibold text-danger' : ''}`}>{make > 0 && f.delivery_date <= today ? 'For delivery today, offer only what you have in stock.' : make > Number(f.quantity) ? 'This cannot be more than you offer.' : 'Leave 0 if everything is already in stock. The buyer sees how much is in stock and how much will be made.'}</span>
        </div>
      )}
      {capacity && milk && <Capacity cap={capacity} kind={kind} over={overCap} onUse={() => set('quantity')(String(maxBid))} useLabel={Q(maxBid)} />}
      {capacity && !milk && <ProductCapacity cap={capacity} unit={req.unit} make={make} over={overCap} />}

      {milk && <div className="field">
        <span className="label">How fresh on arrival?</span>
        <div className="flex flex-wrap gap-1.5">
          {freshPicks.map((h) => (
            <button key={h} type="button" onClick={() => set('max_age')(Number(f.max_age) === h ? '' : h)}
              className={`num rounded-full border-[1.5px] px-3.5 py-1.5 text-[13.5px] font-medium transition-all active:scale-95 ${
                Number(f.max_age) === h ? 'border-forest bg-mint-soft text-forest' : 'border-line bg-white hover:border-[#cdbd98]'}`}>
              Under {h} h
            </button>
          ))}
        </div>
        <p className="hint">Hours since milking when it reaches the buyer.</p>
      </div>}

      <div className="field">
        <label htmlFor="n">Note to buyer <span className="font-normal text-muted">(optional)</span></label>
        <textarea id="n" rows={2} className="input" value={f.notes} onChange={set('notes')} placeholder="Chilled tanker, morning delivery…" />
      </div>

      {warnings.length > 0 && (
        <div className="animate-pop rounded-2xl bg-haldi-soft px-4 py-3 text-[13.5px] text-amber">
          {warnings.map((w) => <p key={w}>{w}</p>)}
          <p className="mt-1 text-ink/70">Your bid will still be sent, but not as one of the buyer's best matches.</p>
        </div>
      )}

      <div className="flex items-baseline justify-between rounded-2xl bg-cream-2 px-4 py-3">
        <span className="font-medium text-muted">Order value</span>
        <span className="display num text-[28px] text-forest-deep">{rs(total)}</span>
      </div>
      <button className="btn-primary h-12 w-full text-[15.5px]" disabled={busy || overCap || makeBad || (capacity && capMax < 1)}>{busy ? 'Sending…' : live ? 'Update my bid' : 'Send bid'}</button>
      {live && <button type="button" className="btn-danger w-full" disabled={busy} onClick={withdraw}>Withdraw bid</button>}
    </form>
  )
}

export default function RequestDetail() {
  const { id } = useParams()
  const { data: req, error, loading, reload } = useLoad(() => requirementForCenter(id), [id])

  if (loading && !req) return <Loader />
  if (error) return <Alert>{error}</Alert>

  const open = req.status === 'open' && new Date(req.bid_deadline) > new Date()
  const mine = req.my_bid

  return (
    <>
      <PageHeader back={{ to: '/manager/bulk-requests', label: 'Bulk requests' }}
        title={`${req.business?.business_name ?? 'A business'} needs ${qtyText(req.remaining_l ?? req.quantity_l, req.unit)}${req.remaining_l != null && req.remaining_l < Number(req.quantity_l) ? ' more' : ''}`}
        description={`${cap(req.business?.business_type)} in ${req.delivery_city}, needed on ${date(req.required_date)}.`} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <section className="space-y-5">
          <div className="furrows relative animate-rise overflow-hidden rounded-[24px] bg-forest-deep p-6 text-cream sm:p-7">
            <MilkChurn size={84} stroke="#fffcf4" className="absolute -bottom-2 right-5 opacity-90" />
            <p className="display num text-[54px] leading-none">{qtyText(req.quantity_l, req.unit)}</p>
            <p className="mt-2 text-[17px] font-semibold">{isMilk(req) ? milkLabel[req.milk_type] : `${productLabel[req.product]}, from ${milkLabel[req.milk_type].toLowerCase()}`}</p>
            {isMilk(req) && <span className="mt-4 inline-flex rounded-full bg-haldi px-3 py-1 text-[13px] font-bold text-forest-deep">{qualityLabel[req.quality]}</span>}
            {isMilk(req) && <p className="mt-1.5 text-[13.5px] text-cream/70">{qualityHint[req.quality]}</p>}
          </div>

          <dl className="panel divide-y divide-line">
            {[
              ['Needed on', date(req.required_date)],
              ['Deliver to', req.delivery_city],
              ["Buyer's target", req.target_price ? `${rs(req.target_price)} per ${isMilk(req) ? 'litre' : perUnit(req.unit)}` : 'No target, best offer wins'],
              ['Bidding closes', `${dateTime(req.bid_deadline)}${open ? `, ${relative(req.bid_deadline)}` : ''}`],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-6 px-5 py-4">
                <dt className="text-muted">{k}</dt><dd className="num text-right font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          {req.notes && (
            <div className="panel px-5 py-4">
              <p className="text-[13px] font-medium text-muted">Note from the buyer</p>
              <p className="mt-1 text-[15.5px]">“{req.notes}”</p>
            </div>
          )}
          <div className="panel p-5">
            <p className="mb-3 font-semibold">Offers on this request</p>
            <OffersList key={mine?.updated_at ?? 'none'} requirementId={req.id} target={req.target_price} unit={req.unit} highlight={mine?.status === 'submitted' ? mine.id : null} />
          </div>
          <p className="text-[13.5px] text-muted">Offers are public. The full delivery address is shared only with the seller whose bid is accepted.</p>
        </section>

        <aside className="lg:sticky lg:top-10 lg:self-start">
          <div className="panel animate-rise p-6">
            <div className="mb-5 flex items-center justify-between gap-3">
              <h2 className="display text-[26px]">{mine?.status === 'submitted' ? 'Your bid' : 'Place your bid'}</h2>
              {mine && mine.status !== 'withdrawn' && <Badge status={mine.status}>{mine.status === 'submitted' ? 'Sent' : mine.status === 'accepted' ? 'Won' : undefined}</Badge>}
            </div>
            {mine?.status === 'accepted' ? (
              <p className="text-[15.5px] text-forest">The buyer picked you at <strong className="num">{rs(mine.price_per_l)}/{perUnit(req.unit)}</strong>. It's in your bulk orders now.</p>
            ) : !open ? (
              <p className="text-muted">Bidding on this request has closed.</p>
            ) : (
              <BidForm key={`${mine?.id}-${mine?.updated_at}-${mine?.status}`} req={req} onSaved={reload} />
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
