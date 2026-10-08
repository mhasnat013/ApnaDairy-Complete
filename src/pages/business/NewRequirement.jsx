import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useUi } from '../../context/UiContext'
import { milkLabel, qualityLabel, qualityHint, productLabel, PRODUCTS, defaultUnit, qtyText, perUnit, GRADES } from '../../lib/b2b'
import { rs, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import ChoiceCards from '../../components/ChoiceCards'
import Alert from '../../components/Alert'
import ProductImage from '../../components/ProductImage'
import { numberError, cityError, firstError, tidyCity, CITIES } from '../../lib/validate'

const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d }
const milkHint = { cow: 'Lighter, everyday milk', buffalo: 'Thicker, more cream', mixed: 'Either is fine' }
const quickQty = { milk: [100, 250, 500, 1000], product: [5, 10, 25, 50] }
const productHint = { ghee: 'Pure desi ghee', butter: 'White or yellow butter', yogurt: 'Fresh dahi', cheese: 'Paneer or cheese', cream: 'Fresh malai', lassi: 'Sweet or salted', other: 'Khoya and more' }

export default function NewRequirement() {
  const nav = useNavigate()
  const { toast } = useUi()
  const [params] = useSearchParams()
  const [today] = useState(() => iso(new Date()))
  // "request in bulk" on a marketplace listing fills in its milk, grade and city
  const [f, setF] = useState(() => {
    const product = PRODUCTS.includes(params.get('product')) ? params.get('product') : 'milk'
    return {
      product, unit: product === 'milk' ? 'litre' : defaultUnit[product],
      milk_type: Object.keys(milkLabel).includes(params.get('milk_type')) ? params.get('milk_type') : 'cow',
      quantity_l: '', required_date: iso(plusDays(7)),
      quality: GRADES.includes(params.get('quality')) ? params.get('quality') : 'standard',
      target_price: '', deadline_date: iso(plusDays(5)), deadline_time: '18:00',
      delivery_city: (params.get('city') ?? '').slice(0, 60), delivery_address: '', notes: '',
    }
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((prev) => ({ ...prev, [k]: e?.target ? e.target.value : e }))

  const deadline = useMemo(() => new Date(`${f.deadline_date}T${f.deadline_time}:00+05:00`), [f.deadline_date, f.deadline_time])

  const onSubmit = async (e) => {
    e.preventDefault()
    const milkReq = f.product === 'milk'
    const bad = firstError(
      numberError(f.quantity_l, { min: milkReq ? 10 : 1, max: 50000, whole: f.unit === 'pack', what: 'quantity' }),
      numberError(f.target_price, { min: 1, max: 100000, what: 'target price', required: false }),
      !f.required_date ? 'Pick the delivery date.' : '',
      !f.deadline_date || !f.deadline_time ? 'Pick when bidding closes.' : '',
      cityError(f.delivery_city),
      f.delivery_address.length > 200 ? 'The address is too long.' : '',
      f.notes.length > 500 ? 'The note is too long.' : '',
    )
    if (bad) return setError(bad)
    if (f.required_date < today) return setError('The delivery date is in the past.')
    if (deadline.getTime() <= Date.now()) return setError('Bidding has to close in the future.')
    if (f.deadline_date > f.required_date) return setError('Bidding has to close on or before the delivery date.')
    setError(''); setBusy(true)
    const { data: businessId } = await supabase.rpc('my_business_id')
    if (!businessId) { setBusy(false); return setError('Your business account has to be approved before you can post.') }

    const { data, error } = await supabase.from('bulk_requirements').insert({
      business_id: businessId,
      product: f.product,
      unit: f.product === 'milk' ? 'litre' : f.unit,
      milk_type: f.milk_type,
      quantity_l: Number(f.quantity_l),
      required_date: f.required_date,
      quality: f.product === 'milk' ? f.quality : 'standard',
      target_price: f.target_price ? Number(f.target_price) : null,
      bid_deadline: deadline.toISOString(),
      delivery_city: tidyCity(f.delivery_city),
      delivery_address: f.delivery_address.trim() || null,
      notes: f.notes.trim() || null,
    }).select('id').single()
    setBusy(false)
    if (error) return setError(error.message)
    toast('Requirement posted. Collection centers can bid now.')
    nav(`/business/requirements/${data.id}`, { replace: true })
  }

  return (
    <>
      <PageHeader title="What do you need?" back={{ to: '/business/requirements', label: 'My requirements' }}
        description="Verified milk centers and dairy product sellers see this and send their best price. You choose who supplies you, and can split a large order between sellers." />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <form onSubmit={onSubmit} className="panel space-y-7 p-6 sm:p-8">
          <Alert>{error}</Alert>

          <div className="field">
            <span className="label">What do you need?</span>
            <div className="flex flex-wrap gap-1.5">
              {['milk', ...PRODUCTS].map((v) => (
                <button key={v} type="button" onClick={() => setF((p) => ({ ...p, product: v, unit: v === 'milk' ? 'litre' : defaultUnit[v], quality: v === 'milk' ? (p.quality || 'standard') : 'standard', quantity_l: '' }))}
                  className={`inline-flex items-center gap-2 rounded-full border-[1.5px] py-1 pl-1 pr-3.5 text-[14px] font-medium transition-all ${f.product === v ? 'border-forest bg-mint-soft text-forest' : 'border-line bg-white hover:border-[#cdbd98]'}`}>
                  <ProductImage category={v} size={28} className="rounded-full" />
                  {productLabel[v]}
                </button>
              ))}
            </div>
            <p className="hint">{f.product === 'milk' ? 'Fresh milk comes from milk collection centers, tested by their IoT device.' : `${productHint[f.product]}. Dairy products come from approved byproduct sellers.`}</p>
          </div>

          <div className="field">
            <span className="label">{f.product === 'milk' ? 'Milk' : 'Made from'}</span>
            <ChoiceCards name="Milk" value={f.milk_type} onChange={set('milk_type')}
              options={Object.keys(milkLabel).map((v) => ({ value: v, label: milkLabel[v], hint: milkHint[v] }))} />
          </div>

          {f.product === 'milk' && (
            <div className="field">
              <span className="label">Quality</span>
              <ChoiceCards name="Quality" value={f.quality} onChange={set('quality')}
                options={GRADES.map((v) => ({ value: v, label: qualityLabel[v], hint: qualityHint[v] }))} />
              <p className="hint">The grade comes from the center's IoT milk test and AI Model 1 when the milk is bought. Bulk milk goes out of the center's tested stock, of this grade or better.</p>
            </div>
          )}

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="qty">{f.product === 'milk' ? 'How many litres?' : 'How much?'}</label>
              <div className="flex gap-2">
                <input id="qty" type="number" inputMode="decimal" min="1" max="50000" step="1" className="input num min-w-0 flex-1" required value={f.quantity_l} onChange={set('quantity_l')} placeholder={f.product === 'milk' ? '500' : '20'} />
                {f.product !== 'milk' && (
                  <select className="input w-[110px]" aria-label="Unit" value={f.unit} onChange={set('unit')}>
                    <option value="kg">kg</option><option value="litre">litres</option><option value="pack">packs</option>
                  </select>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {quickQty[f.product === 'milk' ? 'milk' : 'product'].map((q) => (
                  <button key={q} type="button" onClick={() => set('quantity_l')(String(q))}
                    className={`num rounded-full px-3 py-1 text-[13px] font-medium transition-colors ${Number(f.quantity_l) === q ? 'bg-forest text-cream' : 'bg-cream-2 text-ink hover:bg-mint-soft'}`}>
                    {qtyText(q, f.unit)}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label htmlFor="req-date">Needed on</label>
              <input id="req-date" type="date" className="input num" required min={today} value={f.required_date} onChange={set('required_date')} />
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="field">
              <label htmlFor="target">Your target price per {f.product === 'milk' ? 'litre' : perUnit(f.unit)} <span className="font-normal text-muted">(optional)</span></label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted">Rs</span>
                <input id="target" type="number" inputMode="decimal" min="1" step="0.5" className="input num w-full pl-11" value={f.target_price} onChange={set('target_price')} placeholder={f.product === 'milk' ? '190' : f.product === 'ghee' ? '2400' : '600'} />
              </div>
              <p className="hint">A guide for sellers. You can still accept a higher bid.</p>
            </div>
            <div className="field">
              <span className="label">Bidding closes</span>
              <div className="flex gap-2">
                <input type="date" aria-label="Bidding closes on" className="input num min-w-0 flex-1" required min={today} max={f.required_date} value={f.deadline_date} onChange={set('deadline_date')} />
                <input type="time" aria-label="at" className="input num w-[140px]" required value={f.deadline_time} onChange={set('deadline_time')} />
              </div>
            </div>
          </div>

          <div className="grid gap-5 sm:grid-cols-[1fr_1.6fr]">
            <div className="field">
              <label htmlFor="city">Delivery city</label>
              <input id="city" className="input" required maxLength={40} list="nr-cities" value={f.delivery_city} onChange={set('delivery_city')} placeholder="Islamabad" />
              <datalist id="nr-cities">{CITIES.map((c) => <option key={c} value={c} />)}</datalist>
            </div>
            <div className="field">
              <label htmlFor="addr">Delivery address</label>
              <input id="addr" className="input" maxLength={200} value={f.delivery_address} onChange={set('delivery_address')} placeholder="Only shared with the center you choose" />
            </div>
          </div>

          <div className="field">
            <label htmlFor="notes">Anything centers should know? <span className="font-normal text-muted">(optional)</span></label>
            <textarea id="notes" rows={3} maxLength={500} className="input" value={f.notes} onChange={set('notes')} placeholder="Morning delivery, two drops of 250 L, chilled transport…" />
          </div>

          <div className="flex justify-end gap-2 border-t border-line pt-6">
            <button type="button" className="btn-secondary" onClick={() => nav(-1)}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Post requirement'}</button>
          </div>
        </form>

        {/* live preview of how the request looks on the board */}
        <aside className="lg:sticky lg:top-10 lg:self-start">
          <p className="mb-2 text-[13px] font-medium text-muted">Preview on the request board</p>
          <div className="furrows overflow-hidden rounded-[24px] bg-forest-deep text-cream">
            <div className="flex items-start justify-between p-6 pb-4">
              <div>
                <p className="display num text-[42px] leading-none">{f.quantity_l ? qtyText(f.quantity_l, f.unit) : qtyText(0, f.unit).replace('0', '—')}</p>
                <p className="mt-2 font-semibold">{f.product === 'milk' ? milkLabel[f.milk_type] : `${productLabel[f.product]}, from ${milkLabel[f.milk_type].toLowerCase()}`}</p>
              </div>
              <ProductImage category={f.product} size={60} className="ring-4 ring-cream/15" />
            </div>
            {f.product === 'milk' ? <div className="mx-6 mb-5 inline-flex rounded-full bg-haldi px-3 py-1 text-[13px] font-semibold text-forest-deep">{qualityLabel[f.quality]}</div> : <div className="mb-5" />}
            <dl className="space-y-2.5 bg-cream/5 px-6 py-5 text-[14px]">
              <div className="flex justify-between gap-4"><dt className="text-cream/65">Needed on</dt><dd className="num">{date(f.required_date)}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-cream/65">Deliver to</dt><dd>{f.delivery_city || '—'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-cream/65">Target</dt><dd className="num">{f.target_price ? `${rs(f.target_price)} / ${perUnit(f.unit)}` : 'Best offer'}</dd></div>
              <div className="flex justify-between gap-4"><dt className="text-cream/65">Bids close</dt><dd className="num">{date(f.deadline_date)}, {f.deadline_time}</dd></div>
            </dl>
            {f.quantity_l && f.target_price && (
              <p className="px-6 py-4 text-[14px] text-cream/75">
                Around <span className="num font-semibold text-haldi">{rs(Number(f.quantity_l) * Number(f.target_price))}</span> at your target.
              </p>
            )}
          </div>
        </aside>
      </div>
    </>
  )
}
