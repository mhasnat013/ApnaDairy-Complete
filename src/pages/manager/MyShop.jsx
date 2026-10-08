import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import {
  myCenter, milkListings, myPublicListings, myPublicShop, shopProfile, saveShopProfile, shopPhotos, uploadShopPhoto, deleteShopPhoto,
  setCoverPhoto, photoUrl, myReviews, runMilkExpiry, dateTimeShort, milkDay, myBulkReviews, myPublicProducts, replyReview, createListing, saveListing, myMilkShelf, stockGrade, milkCost, platformSettings, milkLabel, gradeLabel, spoilageBand,
} from '../../lib/center'
import { rs, litres, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import Sheet from '../../components/Sheet'
import { HillsStrip } from '../../components/Farm'
import { qtyText, perUnit } from '../../lib/b2b'
import { phoneError, numberError, firstError, prettyPhone } from '../../lib/validate'
import ProductImage from '../../components/ProductImage'
import { STAGES, stageNow, priceAt } from '../../lib/pricing'

const TYPES = ['buffalo', 'cow', 'mixed']

export default function MyShop() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('listings')
  const { data, error, reload } = useLoad(async () => {
    const center = await myCenter(profile.id)
    // dairy products sellers: products live on the Products page, here only the shop and its reviews
    if (center.type === 'byproduct') {
      const [shop, prof, photos, reviews, bizReviews, pub] = await Promise.all([
        myPublicShop(center.id), shopProfile(), shopPhotos(), myReviews(), myBulkReviews().catch(() => []), myPublicProducts(center.id),
      ])
      return { center, shop, prof, photos, reviews, bizReviews, pub, byproduct: true }
    }
    await runMilkExpiry().catch(() => null)   // listings whose milk passed its 2 days end first
    const [listings, pub, shop, prof, photos, reviews, bizReviews, shelf, cost, platform, ...g] = await Promise.all([
      milkListings(), myPublicListings(center.id), myPublicShop(center.id), shopProfile(), shopPhotos(), myReviews(), myBulkReviews().catch(() => []),
      myMilkShelf(), milkCost(), platformSettings(), ...TYPES.map((t) => stockGrade(center.id, t).catch(() => null)),
    ])
    return { center, listings, pub, shop, prof, photos, reviews, bizReviews, shelf, cost, platform, grades: Object.fromEntries(TYPES.map((t, i) => [t, g[i]])) }
  }, [profile.id])

  const view = data?.byproduct && tab === 'listings' ? 'profile' : tab

  // fair price: what this center paid farmers, plus the suggested and maximum markup
  const guide = (type) => {
    const c = data?.cost?.find((x) => x.milk_type === type)
    if (!c?.avg_cost || !data?.platform) return null
    const cost = Number(c.avg_cost)
    return { cost, suggest: Math.round(cost * (100 + Number(data.platform.markup_suggest_pct)) / 100),
      max: Math.floor(cost * (100 + Number(data.platform.markup_max_pct)) / 100),
      suggestPct: Number(data.platform.markup_suggest_pct), maxPct: Number(data.platform.markup_max_pct) }
  }

  return (
    <>
      <PageHeader title="My shop" description={data?.byproduct ? "What customers see in the ApnaDairy app and the website marketplace: your shop, your products and what customers and businesses say about you." : "What customers see in the ApnaDairy app and the website marketplace: your milk on sale, your shop and what other customers say about it."}>
        {data?.center && <Link to={`/marketplace?shop=${data.center.id}${data.byproduct ? '&tab=products' : ''}`} className="btn-secondary"><Icon name="store" size={17} />See it on the marketplace</Link>}
      </PageHeader>
      <Alert>{error}</Alert>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-7">
        <div className="min-w-0">
          <div className="mb-5">
            <Segmented value={view} onChange={setTab} options={[
              ...(data?.byproduct ? [] : [{ value: 'listings', label: 'Milk on the app' }]),
              { value: 'profile', label: 'Shop profile' },
              { value: 'reviews', label: 'Reviews', count: data ? data.reviews.length + data.bizReviews.length : undefined },
            ]} />
          </div>
          {view === 'listings' && <Listings data={data} guide={guide} reload={reload} />}
          {view === 'profile' && <Profile key={data?.prof?.updated_at ?? 'p'} data={data} reload={reload} />}
          {view === 'reviews' && <Reviews data={data} reload={reload} />}
        </div>
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted"><Icon name="chip" size={15} />In the customer app</p>
          <PhonePreview data={data} />
        </aside>
      </div>
    </>
  )
}

// ---------- listings ----------
// the area manager creates a listing: which milk, how many litres, the price. every app order takes its
// litres off the listing. quality comes from the ai tests; litres per order are set by apnadairy.
function Listings({ data, guide, reload }) {
  const [params, setParams] = useSearchParams()
  const focus = params.get('list')
  const [sheet, setSheet] = useState(() => (focus ? { type: focus } : null))
  if (!data) return <div className="grid gap-4">{[1, 2].map((t) => <div key={t} className="skeleton h-48 rounded-[20px]" />)}</div>
  const fresh = (t) => Math.floor(Number(data.shelf.find((x) => x.milk_type === t)?.sellable_l ?? 0) * 2) / 2
  // when the oldest fresh milk of this type expires (48 h after its test), for the dynamic pricing times
  const oldestEnds = (t) => { const h = data.shelf.find((x) => x.milk_type === t)?.oldest_hours; return h == null ? null : new Date(Date.now() + (48 - Number(h)) * 36e5) }
  const listings = TYPES.map((t) => data.listings.find((x) => x.milk_type === t)).filter(Boolean)
  const open = (v) => setSheet(v)
  const close = () => { setSheet(null); if (focus) setParams({}) }
  const editing = sheet && (sheet.listing ?? data.listings.find((x) => x.milk_type === sheet.type))
  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display text-[22px] text-forest-deep">Your milk on the app</h2>
          <p className="text-[13.5px] text-muted">{listings.length ? `${listings.filter((l) => l.is_available).length} of ${listings.length} listings showing to customers` : 'Nothing listed yet'}</p>
        </div>
        <button className="btn-primary" onClick={() => open({})} disabled={listings.length === TYPES.length}><Icon name="plus" size={17} />Create a listing</button>
      </div>
      <OrderRule platform={data.platform} />

      {listings.length === 0 && (
        <div className="panel">
          <EmptyState title="List milk on the app" action={<button className="btn-primary btn-sm" onClick={() => open({})}><Icon name="plus" size={15} />Create a listing</button>}>
            Say which milk you are selling, how many litres and your price. Customers near you can then order it in the ApnaDairy app.
          </EmptyState>
        </div>
      )}
      {listings.map((l) => (
        <ListingCard key={l.id} listing={l} pub={data.pub.find((x) => x.milk_type === l.milk_type)} fresh={fresh(l.milk_type)}
          grade={data.grades[l.milk_type]} reload={reload} onEdit={() => open({ listing: l })} />
      ))}

      {sheet && (editing || listings.length < TYPES.length) && <ListingSheet key={`${editing?.id ?? 'new'}-${sheet.type ?? ''}`} open listing={editing} startType={sheet?.type}
        taken={listings.map((l) => l.milk_type)} fresh={fresh} oldestEnds={oldestEnds} grades={data.grades} guide={guide} platform={data.platform}
        pub={editing ? data.pub.find((x) => x.milk_type === editing.milk_type) : null} onClose={close} onSaved={reload} />}
    </div>
  )
}

// litres per order are the same for every shop, set by the super admin
function OrderRule({ platform }) {
  if (!platform) return null
  return (
    <p className="flex items-start gap-2.5 rounded-2xl bg-mint-soft px-4 py-3 text-[13.5px] text-forest">
      <Icon name="cart" size={16} className="mt-0.5 shrink-0" />
      <span>Customers can order <b className="num">{Number(platform.order_min_l)} to {Number(platform.order_max_l)} L</b> at a time. ApnaDairy sets this for every shop, so the app stops smaller or bigger orders for you.</span>
    </p>
  )
}

function GradeChip({ grade }) {
  if (!grade) return <span className="rounded-full bg-cream-2 px-2.5 py-0.5 text-[12px] font-semibold text-muted">No fresh milk</span>
  return <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${grade === 'premium' ? 'bg-haldi-soft text-forest-deep' : 'bg-mint-soft text-forest'}`}>{gradeLabel[grade]} · AI tested</span>
}

function Stat({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-2xl bg-cream px-3 py-2.5">
      <p className="text-[12px] leading-tight text-muted">{label}</p>
      <p className="num mt-0.5 truncate text-[17px] font-bold text-forest-deep sm:text-[19px]">{value}</p>
      <p className="text-[11.5px] leading-tight text-muted">{hint}</p>
    </div>
  )
}

function ListingCard({ listing, pub, fresh, grade, reload, onEdit }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState(false)
  const expired = !!listing.expired_at || (listing.milk_expires_at && new Date(listing.milk_expires_at) <= new Date())
  const onApp = pub && !expired ? Number(pub.available_l) : 0
  const hoursLeft = listing.milk_expires_at ? (new Date(listing.milk_expires_at) - Date.now()) / 36e5 : null
  const day = listing.milk_from ? milkDay(listing.milk_from) : null
  const dyn = listing.pricing_mode === 'dynamic'
  const st = dyn && !expired ? stageNow(listing.milk_expires_at) : null
  const price = dyn ? (pub && !expired ? Number(pub.price_per_l) : priceAt(listing.price, st?.pct ?? 0))
    : Math.round(Number(listing.price) * (100 - (Number(listing.discount_pct) || 0)) / 100)
  const toggle = async () => {
    setBusy(true)
    try { await saveListing({ ...listing, listed_l: listing.listed_l ?? onApp, is_available: !listing.is_available }); toast(listing.is_available ? `${listing.name} hidden from the app.` : `${listing.name} is on the app.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const status = expired ? ['red', 'Expired: its milk passed 2 days and was discarded']
    : !listing.is_available ? ['grey', 'Hidden from customers'] : onApp > 0 ? ['green', 'Customers can order it'] : ['amber', 'Sold out on the app']
  return (
    <section className={`panel animate-rise p-5 sm:p-6 ${listing.is_available ? '' : 'opacity-80'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
        <ProductImage category="milk" size={56} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="display text-[20px] text-forest-deep">{listing.name}</p><GradeChip grade={grade} /></div>
          <p className={`mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium ${status[0] === 'green' ? 'text-forest' : status[0] === 'amber' ? 'text-amber' : status[0] === 'red' ? 'text-danger' : 'text-muted'}`}>
            <span className={`h-2 w-2 rounded-full ${status[0] === 'green' ? 'bg-forest-2' : status[0] === 'amber' ? 'bg-haldi' : status[0] === 'red' ? 'bg-danger' : 'bg-line'}`} />{status[1]}</p>
          {(listing.listed_at || listing.created_at) && <p className="mt-0.5 text-[12.5px] text-muted">Listed {dateTimeShort(listing.listed_at ?? listing.created_at)}</p>}
          {listing.description && <p className="mt-1 truncate text-[13px] text-muted">“{listing.description}”</p>}
        </div>
        </div>
        <div className="flex items-center gap-3">
          <button className={expired ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={onEdit}><Icon name={expired ? 'plus' : 'edit'} size={14} />{expired ? 'List fresh milk' : 'Edit'}</button>
          <button role="switch" aria-checked={listing.is_available} aria-label="Show on the app" disabled={busy} onClick={toggle}
            className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors ${listing.is_available ? 'bg-forest' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${listing.is_available ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="On the app" value={litres(onApp)} hint={`${litres(fresh)} fresh in stock`} />
        <Stat label="Price" value={rs(price)} hint={dyn ? (st?.pct ? `per litre, ${st.pct}% off now` : 'per litre, dynamic') : Number(listing.discount_pct) ? `per litre, ${listing.discount_pct}% off` : 'per litre'} />
        <Stat label={expired ? 'Expired' : 'Sells until'} value={listing.milk_expires_at ? dateTimeShort(listing.milk_expires_at) : '—'}
          hint={expired ? 'list fresh milk again' : hoursLeft == null ? 'no fresh milk' : `${day ? `day ${Math.min(day, 2)} · ` : ''}${Math.max(1, Math.round(hoursLeft))} h left`} />
      </div>
      {st && !st.expired && <DynamicLine st={st} price={listing.price} />}
      {!expired && pub?.model_quality && <ModelLine pub={pub} />}
      {!expired && !dyn && day >= 2 && !Number(listing.discount_pct) && (
        <button className="mt-3 text-left text-[13.5px] font-semibold text-amber underline" onClick={onEdit}>Day 2: give a discount to sell it before it expires</button>
      )}
      {!expired && onApp <= 0 && listing.is_available && fresh > 0 && (
        <button className="mt-3 text-[13.5px] font-semibold text-forest underline" onClick={onEdit}>Add litres: {litres(fresh)} of fresh milk is in stock</button>
      )}
    </section>
  )
}

// dynamic pricing: the stage now and the next drop
function DynamicLine({ st, price }) {
  const next = STAGES[STAGES.findIndex((s) => s.key === st.key) + 1]
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-2xl bg-mint-soft px-4 py-3 text-[13px]">
      <span className="flex items-center gap-1.5 font-semibold text-forest-deep"><Icon name="clock" size={14} className="text-forest" />Dynamic pricing</span>
      <span className="font-semibold text-forest">{st.label}{st.pct ? ` · ${st.pct}% off` : ' · full price'}</span>
      <span className="text-muted">{next && st.next ? `· drops to ${rs(priceAt(price, next.pct))} at ${dateTimeShort(st.next)}` : '· lowest price until the milk expires'}</span>
    </div>
  )
}

// what ai model 1 found in the milk this listing sells (customers see the same)
function ModelLine({ pub }) {
  const left = pub.model_shelf_left_h == null ? null : Number(pub.model_shelf_left_h)
  return (
    <div className="mt-3 rounded-2xl border border-line px-4 py-3 text-[13px]">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 font-semibold text-forest-deep"><Icon name="spark" size={14} className="text-forest" />AI Model 1</span>
        <span className="font-semibold">{pub.model_quality}</span>
        {pub.freshness_score != null && <span className="num text-muted">· freshness {pub.freshness_score}/100</span>}
        {pub.spoilage_pct != null && <span className="num text-muted">· {Math.round(pub.spoilage_pct)}% spoilage risk ({spoilageBand(Number(pub.spoilage_pct)).toLowerCase()})</span>}
      </p>
      {left != null && (left > 0
        ? <p className="mt-1 text-muted">AI shelf life of the oldest milk: about {Math.max(1, Math.round(left))} h left</p>
        : <p className="mt-1 font-medium text-amber">The oldest milk is past the AI's predicted shelf life. It is still usable until its 2 days are up, so sell it first.</p>)}
    </div>
  )
}

// one form to create a listing or change it
function ListingSheet({ open, listing, startType, taken, fresh, oldestEnds, grades, guide, platform, pub, onClose, onSaved }) {
  const { toast } = useUi()
  const free = TYPES.filter((t) => !taken.includes(t))
  const first = listing?.milk_type ?? (free.includes(startType) ? startType : free.find((t) => fresh(t) > 0) ?? free[0])
  const [type, setType] = useState(first)
  const g = guide(type)
  const [f, setF] = useState(() => listing
    ? { litres: String(listing.expired_at ? Math.floor(fresh(listing.milk_type)) : listing.listed_l == null ? Number(pub?.available_l ?? Math.floor(fresh(listing.milk_type))) : Number(listing.listed_l)), price: String(Number(listing.price)), discount: String(listing.expired_at ? 0 : listing.discount_pct ?? 0), description: listing.description ?? '', mode: listing.pricing_mode ?? 'manual' }
    : { litres: String(fresh(first) || ''), price: String(guide(first)?.suggest ?? ({ cow: 205, buffalo: 240, mixed: 210 })[first] ?? ''), discount: '0', description: '', mode: 'manual' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const max = fresh(type)
  const pick = (t) => { setType(t); setF({ ...f, litres: String(fresh(t) || ''), price: String(guide(t)?.suggest ?? f.price) }) }
  const dyn = f.mode === 'dynamic'
  // the listing keeps its milk's expiry; a new listing (or more litres) takes the oldest fresh milk in stock
  const live = listing && !listing.expired_at && listing.milk_expires_at && new Date(listing.milk_expires_at) > new Date()
  const st = stageNow(live && !(Number(f.litres) > Number(listing.listed_l ?? 0)) ? listing.milk_expires_at : oldestEnds(type))
  const pctNow = dyn ? (st && !st.expired ? st.pct : 0) : Number(f.discount) || 0
  const final = priceAt(f.price, pctNow)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const l = Number(f.litres)
    if (!(l > 0) && !listing) return setErr('Say how many litres you have for the app.')
    if (l > max) return setErr(`You have ${litres(max)} of fresh ${milkLabel[type].toLowerCase()} milk. List that much or less.`)
    if (!(Number(f.price) > 0)) return setErr('Enter your price per litre.')
    if (g && Number(f.price) > g.max) return setErr(`The most you can charge is ${rs(g.max)} a litre (${g.maxPct}% above what you pay farmers).`)
    const d = dyn ? 0 : Number(f.discount || 0)
    if (!(d >= 0 && d <= 90) || !Number.isInteger(d)) return setErr('The discount can be 0 to 90%.')
    setBusy(true)
    try {
      if (listing) {
        await saveListing({ ...listing, listed_l: l, price: f.price, description: f.description.trim(), discount_pct: d, pricing_mode: f.mode })
        toast('Listing saved.')
      } else {
        await createListing(type, f.price, l, f.description.trim(), d, f.mode)
        toast(`${litres(l)} of ${milkLabel[type].toLowerCase()} milk is on the app.`)
      }
      onSaved(); onClose()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <Sheet open={open} onClose={onClose} wide title={listing ? `Edit ${listing.name.toLowerCase()}` : 'Create a listing'}
      subtitle={listing ? 'Change the litres, price or description customers see.' : 'Tell customers what milk you have, how much and at what price.'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="listing-form" disabled={busy || (!listing && max <= 0)}>{busy ? 'Saving…' : listing ? 'Save listing' : `List ${litres(Number(f.litres) || 0)} on the app`}</button></>}>
      <form id="listing-form" onSubmit={submit} className="grid gap-5">
        <Alert>{err}</Alert>
        {!listing && (
          <div className="field"><span className="label">Which milk?</span>
            <div className="grid gap-2 sm:grid-cols-3">
              {TYPES.map((t) => {
                const used = taken.includes(t), have = fresh(t)
                return (
                  <button key={t} type="button" disabled={used} onClick={() => pick(t)}
                    className={`rounded-2xl border-[1.5px] px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-50 ${type === t ? 'border-forest bg-mint-soft' : 'border-line bg-white hover:border-[#cdbd98]'}`}>
                    <span className="block font-semibold">{milkLabel[t]}</span>
                    <span className="block text-[12px] text-muted">{used ? 'Already listed' : have > 0 ? `${litres(have)} fresh` : 'None in stock'}</span>
                  </button>
                )
              })}
            </div>
            {grades[type] && <span className="hint">Quality customers will see: <b className="text-forest">{gradeLabel[grades[type]]}</b>, from the AI tests of this milk.</span>}
          </div>
        )}

        {!listing && max <= 0 ? (
          <p className="rounded-2xl bg-haldi-soft px-4 py-3 text-[13.5px] text-amber">You have no fresh {milkLabel[type].toLowerCase()} milk in stock. Buy and test milk from farmers first, then list it here.</p>
        ) : (
          <>
            <div className="field"><label htmlFor="ll">Litres available on the app</label>
              <div className="flex flex-wrap items-center gap-2">
                <input id="ll" className={`input num w-32 ${Number(f.litres) > max ? 'border-danger' : ''}`} type="number" min="0" step="0.5" value={f.litres} onChange={set('litres')} />
                <span className="text-[13px] text-muted">of {litres(max)} fresh in stock</span>
                {max > 0 && Number(f.litres) !== max && <button type="button" className="text-[13px] font-semibold text-forest underline" onClick={() => setF({ ...f, litres: String(max) })}>List all</button>}
              </div>
              <span className="hint">Every order takes its litres off this number. Milk sells for 2 days at most after it was collected; then the listing ends and the milk is discarded automatically.</span></div>

            <div className="field"><span className="label">How should the price change?</span>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Pricing">
                {[['manual', 'Free discount', 'You give any discount, any time, to sell your milk quickly.'],
                  ['dynamic', 'Dynamic pricing', 'The price drops by itself as the milk gets older, until it expires.']].map(([k, t, d]) => (
                  <button key={k} type="button" role="radio" aria-checked={f.mode === k} onClick={() => setF({ ...f, mode: k })}
                    className={`rounded-2xl border-[1.5px] px-3.5 py-3 text-left transition-all ${f.mode === k ? 'border-forest bg-mint-soft' : 'border-line bg-white hover:border-[#cdbd98]'}`}>
                    <span className="block font-semibold">{t}</span>
                    <span className="block text-[12.5px] text-muted">{d}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-4 ${dyn ? '' : 'sm:grid-cols-[1fr_140px]'}`}>
              <div className="field"><label htmlFor="lp">Price per litre</label>
                <div className="flex items-center gap-2"><span className="text-muted">Rs</span>
                  <input id="lp" className={`input num w-full ${g && Number(f.price) > g.max ? 'border-danger' : ''}`} type="number" min="1" value={f.price} onChange={set('price')} /></div>
                {g && <span className="hint">You pay farmers {rs(Math.round(g.cost))}. Fair price {rs(g.suggest)}, at most {rs(g.max)}.
                  {Number(f.price) !== g.suggest && <button type="button" className="ml-1 font-semibold text-forest underline" onClick={() => setF({ ...f, price: String(g.suggest) })}>Use {rs(g.suggest)}</button>}</span>}
              </div>
              {!dyn && <div className="field"><label htmlFor="ld">Discount</label>
                <div className="flex items-center gap-2"><input id="ld" className="input num w-20" type="number" min="0" max="90" step="1" value={f.discount} onChange={set('discount')} /><span className="text-muted">%</span></div>
                <span className="hint">Usually on day 2, to sell the milk before it expires.</span></div>}
            </div>

            {dyn && <Schedule price={f.price} st={st} />}

            <div className="field"><label htmlFor="lx">Description <span className="font-normal text-muted">(optional)</span></label>
              <input id="lx" className="input" maxLength={140} placeholder="e.g. Thick buffalo milk, collected this morning" value={f.description} onChange={set('description')} /></div>

            <div className="rounded-2xl border border-line bg-cream px-4 py-3.5 text-[13.5px]">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Customers will see</p>
              <div className="mt-2 flex items-start gap-3"><ProductImage category="milk" size={44} /><p><b className="num">{litres(Number(f.litres) || 0)}</b> of {milkLabel[type].toLowerCase()} milk{grades[type] ? `, ${gradeLabel[grades[type]].toLowerCase()} grade` : ''}, at <b className="num">{rs(final)}</b> a litre{pctNow > 0 ? ` (${pctNow}% off)` : ''}{dyn ? ', dropping by itself as the milk gets older' : ''}.</p></div>
              {platform && <p className="mt-1 text-muted">They can order {Number(platform.order_min_l)} to {Number(platform.order_max_l)} L at a time, set by ApnaDairy.</p>}
            </div>
          </>
        )}
      </form>
    </Sheet>
  )
}

// the dynamic pricing steps, with the real times for this milk
function Schedule({ price, st }) {
  const steps = st?.steps
  return (
    <div className="overflow-hidden rounded-2xl border border-line">
      <table className="w-full text-[13px]">
        <thead className="bg-cream text-left text-[12px] text-muted"><tr>
          <th className="px-3 py-2 font-semibold">{steps ? 'From' : 'After the test'}</th><th className="px-3 py-2 font-semibold">Customers see</th>
          <th className="px-3 py-2 text-right font-semibold">Off</th><th className="px-3 py-2 text-right font-semibold">Price / L</th></tr></thead>
        <tbody>
          {(steps ?? STAGES).map((s) => {
            const now = st && !st.expired && st.key === s.key
            return (
              <tr key={s.key} className={`border-t border-line ${now ? 'bg-mint-soft font-semibold' : ''}`}>
                <td className="num px-3 py-2">{s.starts ? dateTimeShort(s.starts) : `${s.from} h`}{now && <span className="ml-1.5 rounded-full bg-forest px-1.5 py-0.5 text-[10.5px] text-cream">now</span>}</td>
                <td className="px-3 py-2">{s.label}</td>
                <td className="num px-3 py-2 text-right">{s.pct ? `${s.pct}%` : '—'}</td>
                <td className="num px-3 py-2 text-right">{rs(priceAt(price, s.pct))}</td>
              </tr>
            )
          })}
          <tr className="border-t border-line text-muted"><td className="num px-3 py-2">{steps ? dateTimeShort(steps[steps.length - 1].ends) : '48 h'}</td><td className="px-3 py-2" colSpan={3}>Expires and is discarded</td></tr>
        </tbody>
      </table>
      <p className="border-t border-line bg-cream px-3 py-2 text-[12px] text-muted">Times count from the test of the oldest milk on this listing. The tested grade stays the same; the stage shows how fresh it is now.</p>
    </div>
  )
}

// ---------- shop profile ----------
function Profile({ data, reload }) {
  const { toast, confirm } = useUi()
  const file = useRef(null)
  const [p, setP] = useState(() => ({ tagline: '', description: '', phone: '', whatsapp: '', opening_hours: '', delivery_radius_km: '', ...(data?.prof ?? {}) }))
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(0)
  const photos = data?.photos ?? []
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value })

  const save = async () => {
    const bad = firstError(
      phoneError(p.phone), p.whatsapp ? phoneError(p.whatsapp).replace('Phone', 'WhatsApp') : '',
      (p.opening_hours ?? '').length > 80 ? 'Opening hours are too long.' : '',
      numberError(p.delivery_radius_km, { min: 0, max: 50, what: 'delivery area', required: false }),
    )
    if (bad) return toast(bad, 'error')
    setBusy(true)
    try { await saveShopProfile(data.center.id, { ...p, phone: p.phone?.trim() ? prettyPhone(p.phone) : null, whatsapp: p.whatsapp?.trim() ? prettyPhone(p.whatsapp) : null, opening_hours: p.opening_hours?.trim() || null }); toast('Shop profile saved.'); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const upload = async (files) => {
    const list = [...files].filter((f) => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type))
    if (list.length < files.length) toast('Only JPG, PNG or WebP photos can be added.', 'error')
    const big = list.find((f) => f.size > 5 * 1024 * 1024)
    if (big) return toast(`${big.name} is larger than 5 MB.`, 'error')
    if (photos.length + list.length > 8) return toast('A shop can have up to 8 photos.', 'error')
    setUploading(list.length)
    try {
      for (let i = 0; i < list.length; i++) { await uploadShopPhoto(data.center.id, list[i], photos.length + i); setUploading(list.length - i - 1) }
      toast(list.length === 1 ? 'Photo added.' : `${list.length} photos added.`); await reload()
    } catch (e) { toast(e.message, 'error') }
    setUploading(0)
  }
  const remove = async (ph) => {
    if (!(await confirm({ title: 'Remove this photo?', confirmLabel: 'Remove', danger: true }))) return
    try { await deleteShopPhoto(ph); await reload() } catch (e) { toast(e.message, 'error') }
  }
  const cover = async (ph) => { try { await setCoverPhoto(photos, ph.id); toast('Cover photo changed.'); await reload() } catch (e) { toast(e.message, 'error') } }

  return (
    <div className="grid gap-4">
      <Card title="Photos" subtitle="The first photo is your cover. Show the shop front, the counter and your chiller. Up to 8 photos, 5 MB each.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
          {photos.map((ph, i) => (
            <figure key={ph.id} className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-cream-2">
              <img src={photoUrl(ph.path)} alt={ph.caption ?? 'Shop photo'} className="h-full w-full object-cover" />
              {i === 0 && <span className="absolute left-2 top-2 rounded-full bg-forest-deep/85 px-2 py-0.5 text-[11.5px] font-semibold text-cream">Cover</span>}
              <div className="absolute inset-x-2 bottom-2 flex justify-end gap-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                {i > 0 && <button className="rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-forest-deep" onClick={() => cover(ph)}>Make cover</button>}
                <button className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-danger" onClick={() => remove(ph)} aria-label="Remove photo"><Icon name="x" size={14} /></button>
              </div>
            </figure>
          ))}
          {photos.length < 8 && (
            <button type="button" onClick={() => file.current?.click()} disabled={uploading > 0}
              className="grid aspect-[4/3] place-items-center rounded-2xl border-2 border-dashed border-line text-muted transition-colors hover:border-forest hover:text-forest">
              <span className="text-center"><Icon name="plus" size={22} className="mx-auto" /><span className="mt-1 block text-[13px] font-semibold">{uploading ? `Uploading ${uploading}…` : 'Add photos'}</span></span>
            </button>
          )}
        </div>
        <input ref={file} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = '' }} />
      </Card>

      <Card title="About your shop" subtitle={data ? `${data.center.center_name}, ${data.center.city}${data.center.address ? ` · ${data.center.address}` : ''}` : ' '}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field sm:col-span-2"><label htmlFor="tg">Tagline</label><input id="tg" className="input" maxLength={90} placeholder="e.g. Khalis doodh, tested every morning" value={p.tagline ?? ''} onChange={set('tagline')} /></div>
          <div className="field sm:col-span-2"><label htmlFor="ds">Description</label><textarea id="ds" className="input" rows={4} maxLength={600} placeholder="Where your milk comes from and why customers trust you" value={p.description ?? ''} onChange={set('description')} />
            <span className="hint">{(p.description ?? '').length}/600</span></div>
          <div className="field"><label htmlFor="ph">Phone</label><input id="ph" className="input num" type="tel" inputMode="tel" maxLength={16} placeholder="0300 1234567" value={p.phone ?? ''} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="wa">WhatsApp</label><input id="wa" className="input num" type="tel" inputMode="tel" maxLength={16} placeholder="0300 1234567" value={p.whatsapp ?? ''} onChange={set('whatsapp')} /></div>
          <div className="field"><label htmlFor="oh">Opening hours</label><input id="oh" className="input" maxLength={80} placeholder="e.g. Every day, 6 am to 10 pm" value={p.opening_hours ?? ''} onChange={set('opening_hours')} /></div>
          <div className="field"><label htmlFor="dr">Delivery area</label>
            <div className="flex items-center gap-2"><input id="dr" className="input num w-24" type="number" inputMode="decimal" min="0" max="50" step="0.5" value={p.delivery_radius_km ?? ''} onChange={set('delivery_radius_km')} /><span className="text-[13px] text-muted">km around the shop</span></div></div>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">Your shop name, city and address come from registration. <Link to="/manager/support?new=1" className="font-semibold text-forest hover:underline">Ask support</Link> to change them.</p>
        <button className="btn-primary mt-4" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </Card>
    </div>
  )
}

// ---------- reviews ----------
export function Stars({ value, size = 15 }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const fill = Math.max(0, Math.min(1, value - i + 1))
        return (
          <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
            <defs><linearGradient id={`st${i}${size}${Math.round(value * 10)}`}><stop offset={fill} stopColor="#e2a93b" /><stop offset={fill} stopColor="#e6dbc2" /></linearGradient></defs>
            <path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z" fill={`url(#st${i}${size}${Math.round(value * 10)})`} />
          </svg>
        )
      })}
    </span>
  )
}

// customers rate the shop in the app; businesses rate each delivered bulk order
function Reviews({ data, reload }) {
  const [from, setFrom] = useState('customers')
  const biz = data?.bizReviews ?? []
  return (
    <div className="grid gap-4">
      <Segmented size="sm" value={from} onChange={setFrom} options={[
        { value: 'customers', label: 'From customers', count: data?.reviews.length },
        { value: 'businesses', label: 'From businesses', count: biz.length },
      ]} />
      {from === 'customers' ? <CustomerReviews data={data} reload={reload} /> : <BusinessReviews list={biz} loading={!data} />}
    </div>
  )
}

function BusinessReviews({ list, loading }) {
  if (loading) return <div className="skeleton h-40 rounded-[20px]" />
  if (list.length === 0) return <div className="panel"><EmptyState title="No ratings from businesses yet">After you deliver a bulk order, the business can rate it. Their ratings show next to your bids, so good ones help you win more orders.</EmptyState></div>
  const avg = list.reduce((n, r) => n + r.rating, 0) / list.length
  return (
    <div className="grid gap-4">
      <section className="panel flex flex-wrap items-center gap-5 p-5 sm:p-6">
        <p className="display num text-[52px] leading-none text-forest-deep">{avg.toFixed(1)}</p>
        <div>
          <Stars value={avg} size={18} />
          <p className="mt-1 text-[13px] text-muted">{list.length} {list.length === 1 ? 'rating' : 'ratings'} from bulk orders. Businesses see this next to your bids.</p>
        </div>
      </section>
      <ul className="grid gap-3">
        {list.map((r) => (
          <li key={r.order_id} className="panel p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-haldi-soft text-[13px] font-bold text-forest-deep">{(r.business?.business_name ?? 'B').charAt(0)}</span>
                <div className="min-w-0">
                  <p className="truncate font-semibold">{r.business?.business_name ?? 'A business'}</p>
                  <p className="text-[12px] text-muted">{r.order ? `${litres(Number(r.order.quantity_l))} ${r.order.requirement ? milkLabel[r.order.requirement.milk_type].toLowerCase() + ' milk' : ''}, delivered ${date(r.order.delivered_at ?? r.order.delivery_date)}` : relative(r.created_at)}</p>
                </div>
              </div>
              <Stars value={r.rating} />
            </div>
            {r.comment && <p className="mt-3 text-[14.5px]">{r.comment}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function CustomerReviews({ data, reload }) {
  const reviews = data?.reviews ?? []
  const [filter, setFilter] = useState('all')
  const avg = reviews.length ? reviews.reduce((n, r) => n + r.rating, 0) / reviews.length : 0
  const list = reviews.filter((r) => filter === 'all' || (filter === 'reply' ? !r.reply : r.rating <= 3))
  if (data && reviews.length === 0) return <div className="panel"><EmptyState title="No reviews yet">After a customer’s order is delivered, they can rate your shop in the app.</EmptyState></div>
  return (
    <div className="grid gap-4">
      <section className="panel grid gap-5 p-5 sm:grid-cols-[180px_1fr] sm:p-6">
        <div className="text-center sm:text-left">
          <p className="display num text-[52px] leading-none text-forest-deep">{avg.toFixed(1)}</p>
          <div className="mt-2"><Stars value={avg} size={18} /></div>
          <p className="mt-1 text-[13px] text-muted">{reviews.length} reviews</p>
        </div>
        <ul className="grid gap-1.5 self-center">
          {[5, 4, 3, 2, 1].map((n) => {
            const c = reviews.filter((r) => r.rating === n).length
            return (
              <li key={n} className="flex items-center gap-3 text-[13px]">
                <span className="w-8 text-muted">{n} ★</span>
                <span className="h-2 flex-1 rounded-full bg-cream-2"><span className="block h-2 rounded-full bg-haldi" style={{ width: `${reviews.length ? (c / reviews.length) * 100 : 0}%` }} /></span>
                <span className="num w-8 text-right text-muted">{c}</span>
              </li>
            )
          })}
        </ul>
      </section>
      <Segmented size="sm" value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All' }, { value: 'low', label: '3 stars or less', count: reviews.filter((r) => r.rating <= 3).length },
        { value: 'reply', label: 'Not answered', count: reviews.filter((r) => !r.reply).length },
      ]} />
      <ul className="grid gap-3">
        {list.slice(0, 30).map((r) => <ReviewItem key={r.id} r={r} reload={reload} />)}
      </ul>
    </div>
  )
}

function ReviewItem({ r, reload }) {
  const { toast } = useUi()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(r.reply ?? '')
  const [busy, setBusy] = useState(false)
  const send = async () => {
    if (text.trim().length < 2) return toast('Write a reply first.', 'error')
    setBusy(true)
    try { await replyReview(r.id, text.trim()); toast('Reply posted.'); setOpen(false); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <li className="panel p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-full bg-cream-2 text-[13px] font-bold text-forest">{r.reviewer_name.charAt(0)}</span>
          <div><p className="font-semibold">{r.reviewer_name}</p><p className="text-[12px] text-muted">{relative(r.created_at)}</p></div>
        </div>
        <Stars value={r.rating} />
      </div>
      {r.comment && <p className="mt-3 text-[14.5px]">{r.comment}</p>}
      {r.reply && !open && (
        <div className="mt-3 rounded-2xl bg-cream px-4 py-3 text-[13.5px]">
          <p className="text-[12px] font-semibold text-forest">Your reply · {date(r.replied_at)}</p>
          <p className="mt-0.5">{r.reply}</p>
        </div>
      )}
      {open ? (
        <div className="mt-3">
          <textarea className="input w-full" rows={2} maxLength={500} placeholder="Thank the customer or explain what you will do better" value={text} onChange={(e) => setText(e.target.value)} autoFocus />
          <div className="mt-2 flex justify-end gap-2"><button className="btn-ghost btn-sm" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary btn-sm" onClick={send} disabled={busy || !text.trim()}>Post reply</button></div>
        </div>
      ) : (
        <button className="mt-3 text-[13px] font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>{r.reply ? 'Edit reply' : 'Reply'}</button>
      )}
    </li>
  )
}

// ---------- how the shop looks in the customer app ----------
function PhonePreview({ data }) {
  const shop = data?.shop
  const cover = data?.photos?.[0]
  const listings = data?.byproduct ? (data?.pub ?? []) : (data?.pub ?? []).slice().sort((a, b) => TYPES.indexOf(a.milk_type) - TYPES.indexOf(b.milk_type))
  const top = (data?.reviews ?? []).filter((r) => r.rating >= 4 && r.comment).slice(0, 2)
  return (
    <div className="mx-auto w-full max-w-[340px] rounded-[44px] border-[10px] border-forest-deep bg-forest-deep shadow-[0_30px_60px_-30px_rgb(23_58_40/.7)]">
      <div className="overflow-hidden rounded-[34px] bg-cream">
        <div className="relative h-36 bg-forest-deep">
          {cover ? <img src={photoUrl(cover.path)} alt="" className="h-full w-full object-cover" />
            : <HillsStrip className="absolute bottom-0 right-0 h-full w-full opacity-90" />}
          <span className="absolute left-1/2 top-2 h-5 w-24 -translate-x-1/2 rounded-full bg-black/80" />
        </div>
        <div className="px-4 pb-5 pt-4">
          <p className="display text-[20px] leading-tight text-forest-deep">{shop?.center_name ?? data?.center?.center_name ?? 'Your shop'}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted"><Icon name="store" size={12} />{shop?.city ?? data?.center?.city}</p>
          <div className="mt-2 flex items-center gap-2 text-[12px]">
            {shop?.rating ? <><Stars value={Number(shop.rating)} size={13} /><b>{Number(shop.rating).toFixed(1)}</b><span className="text-muted">({shop.review_count})</span></> : <span className="text-muted">No reviews yet</span>}
          </div>
          {shop?.tagline && <p className="mt-2 text-[12.5px] italic text-ink/80">“{shop.tagline}”</p>}

          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">{data?.byproduct ? 'Products' : 'Milk today'}</p>
          <ul className="mt-2 grid gap-2">
            {listings.length === 0 && <li className="rounded-2xl bg-surface px-3 py-3 text-[12.5px] text-muted">{data?.byproduct ? 'No products on sale yet' : 'No milk listed yet'}</li>}
            {data?.byproduct && listings.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 rounded-2xl border border-line bg-surface px-3 py-2.5">
                <ProductImage category={l.category} size={38} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{l.name}</p>
                  <p className="text-[11.5px] text-muted">{qtyText(l.available_qty, l.unit)} available{l.expires_on ? ` · best before ${date(l.expires_on)}` : ''}</p>
                </div>
                <div className="text-right">
                  <p className="num text-[14px] font-bold">{rs(l.price)}<span className="text-[11px] font-medium text-muted">/{perUnit(l.unit)}</span></p>
                  {l.discount_pct > 0 && <p className="num text-[11px] text-muted line-through">{rs(l.list_price)}</p>}
                </div>
              </li>
            ))}
            {!data?.byproduct && listings.map((l) => (
              <li key={l.id} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <ProductImage category="milk" size={38} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold">{l.name}</p>
                    <p className="text-[11.5px] text-muted">{Number(l.available_l) > 0 ? `${Math.floor(l.available_l)} L available` : 'Sold out for now'}{l.quality ? ` · ${gradeLabel[l.quality]}` : ''}{l.model_quality ? ` · AI: ${l.model_quality}` : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="num text-[14px] font-bold">{rs(l.price_per_l)}<span className="text-[11px] font-medium text-muted">/L</span></p>
                    {l.discount_pct > 0 && <p className="num text-[11px] text-muted line-through">{rs(l.list_price)}</p>}
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <span className="h-1.5 flex-1 rounded-full bg-cream-2"><span className="block h-1.5 rounded-full bg-forest-2" style={{ width: `${l.freshness_score}%` }} /></span>
                  <span className="text-[11px] font-semibold text-forest">Freshness {l.freshness_score}</span>
                </div>
                {l.spoilage_pct != null && <p className="num mt-1 text-[11px] text-muted">{Math.round(l.spoilage_pct)}% spoilage risk{l.expires_at ? ` · sells until ${dateTimeShort(l.expires_at)}` : ''}</p>}
              </li>
            ))}
          </ul>

          {top.length > 0 && (
            <>
              <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">What customers say</p>
              <ul className="mt-2 grid gap-2">
                {top.map((r) => (
                  <li key={r.id} className="rounded-2xl bg-surface px-3 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between"><b>{r.reviewer_name}</b><Stars value={r.rating} size={11} /></div>
                    <p className="mt-1 text-ink/80">{r.comment}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-4 rounded-full bg-forest py-2.5 text-center text-[13px] font-semibold text-cream">Order milk</div>
        </div>
      </div>
    </div>
  )
}
