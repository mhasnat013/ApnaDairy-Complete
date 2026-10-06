import { useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import {
  myCenter, milkListings, myPublicListings, myPublicShop, shopProfile, saveShopProfile, shopPhotos, uploadShopPhoto, deleteShopPhoto,
  setCoverPhoto, photoUrl, myReviews, myBulkReviews, replyReview, createListing, saveListing, myMilkShelf, stockGrade, milkCost, platformSettings, milkLabel, gradeLabel,
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

const TYPES = ['buffalo', 'cow', 'mixed']

export default function MyShop() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('listings')
  const { data, error, reload } = useLoad(async () => {
    const center = await myCenter(profile.id)
    const [listings, pub, shop, prof, photos, reviews, bizReviews, shelf, cost, platform, ...g] = await Promise.all([
      milkListings(), myPublicListings(center.id), myPublicShop(center.id), shopProfile(), shopPhotos(), myReviews(), myBulkReviews().catch(() => []),
      myMilkShelf(), milkCost(), platformSettings(), ...TYPES.map((t) => stockGrade(center.id, t).catch(() => null)),
    ])
    return { center, listings, pub, shop, prof, photos, reviews, bizReviews, shelf, cost, platform, grades: Object.fromEntries(TYPES.map((t, i) => [t, g[i]])) }
  }, [profile.id])

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
      <PageHeader title="My shop" description="What customers see in the ApnaDairy app: your milk on sale, your shop and what other customers say about it." />
      <Alert>{error}</Alert>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] xl:gap-7">
        <div className="min-w-0">
          <div className="mb-5">
            <Segmented value={tab} onChange={setTab} options={[
              { value: 'listings', label: 'Milk on the app' },
              { value: 'profile', label: 'Shop profile' },
              { value: 'reviews', label: 'Reviews', count: data ? data.reviews.length + data.bizReviews.length : undefined },
            ]} />
          </div>
          {tab === 'listings' && <Listings data={data} guide={guide} reload={reload} />}
          {tab === 'profile' && <Profile key={data?.prof?.updated_at ?? 'p'} data={data} reload={reload} />}
          {tab === 'reviews' && <Reviews data={data} reload={reload} />}
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
  const listings = TYPES.map((t) => data.listings.find((x) => x.milk_type === t)).filter(Boolean)
  const open = (v) => setSheet(v)
  const close = () => { setSheet(null); if (focus) setParams({}) }
  const editing = sheet && (sheet.listing ?? data.listings.find((x) => x.milk_type === sheet.type))
  return (
    <div className="grid gap-4">
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
        taken={listings.map((l) => l.milk_type)} fresh={fresh} grades={data.grades} guide={guide} platform={data.platform}
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
      <p className="truncate text-[12px] text-muted">{label}</p>
      <p className="num mt-0.5 truncate text-[17px] font-bold text-forest-deep sm:text-[19px]">{value}</p>
      <p className="truncate text-[11.5px] text-muted">{hint}</p>
    </div>
  )
}

function ListingCard({ listing, pub, fresh, grade, reload, onEdit }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState(false)
  const onApp = pub ? Number(pub.available_l) : 0
  const price = Math.round(Number(listing.price) * (100 - (Number(listing.discount_pct) || 0)) / 100)
  const toggle = async () => {
    setBusy(true)
    try { await saveListing({ ...listing, listed_l: listing.listed_l ?? onApp, is_available: !listing.is_available }); toast(listing.is_available ? `${listing.name} hidden from the app.` : `${listing.name} is on the app.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const status = !listing.is_available ? ['grey', 'Hidden from customers'] : onApp > 0 ? ['green', 'Customers can order it'] : ['amber', 'Sold out on the app']
  return (
    <section className={`panel animate-rise p-5 sm:p-6 ${listing.is_available ? '' : 'opacity-80'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><p className="display text-[20px] text-forest-deep">{listing.name}</p><GradeChip grade={grade} /></div>
          <p className={`mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium ${status[0] === 'green' ? 'text-forest' : status[0] === 'amber' ? 'text-amber' : 'text-muted'}`}>
            <span className={`h-2 w-2 rounded-full ${status[0] === 'green' ? 'bg-forest-2' : status[0] === 'amber' ? 'bg-haldi' : 'bg-line'}`} />{status[1]}</p>
          {listing.description && <p className="mt-1 truncate text-[13px] text-muted">“{listing.description}”</p>}
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-secondary btn-sm" onClick={onEdit}><Icon name="edit" size={14} />Edit</button>
          <button role="switch" aria-checked={listing.is_available} aria-label="Show on the app" disabled={busy} onClick={toggle}
            className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors ${listing.is_available ? 'bg-forest' : 'bg-line'}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${listing.is_available ? 'left-[26px]' : 'left-0.5'}`} />
          </button>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="Available now" value={litres(onApp)} hint={`${litres(fresh)} fresh in stock`} />
        <Stat label="Price" value={rs(price)} hint={Number(listing.discount_pct) ? `per litre, ${listing.discount_pct}% off` : 'per litre'} />
        <Stat label="Freshness" value={pub ? `${pub.freshness_score}/100` : '—'} hint={pub?.hours_left ? `about ${Math.round(pub.hours_left)} h left` : 'no fresh milk'} />
      </div>
      {onApp <= 0 && listing.is_available && fresh > 0 && (
        <button className="mt-3 text-[13.5px] font-semibold text-forest underline" onClick={onEdit}>Add litres: {litres(fresh)} of fresh milk is in stock</button>
      )}
    </section>
  )
}

// one form to create a listing or change it
function ListingSheet({ open, listing, startType, taken, fresh, grades, guide, platform, pub, onClose, onSaved }) {
  const { toast } = useUi()
  const free = TYPES.filter((t) => !taken.includes(t))
  const first = listing?.milk_type ?? (free.includes(startType) ? startType : free.find((t) => fresh(t) > 0) ?? free[0])
  const [type, setType] = useState(first)
  const g = guide(type)
  const [f, setF] = useState(() => listing
    ? { litres: String(listing.listed_l == null ? Number(pub?.available_l ?? Math.floor(fresh(listing.milk_type))) : Number(listing.listed_l)), price: String(Number(listing.price)), discount: String(listing.discount_pct ?? 0), description: listing.description ?? '' }
    : { litres: String(fresh(first) || ''), price: String(guide(first)?.suggest ?? ({ cow: 205, buffalo: 240, mixed: 210 })[first] ?? ''), discount: '0', description: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const max = fresh(type)
  const pick = (t) => { setType(t); setF({ ...f, litres: String(fresh(t) || ''), price: String(guide(t)?.suggest ?? f.price) }) }
  const final = Math.round(Number(f.price || 0) * (100 - (Number(f.discount) || 0)) / 100)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    const l = Number(f.litres)
    if (!(l > 0) && !listing) return setErr('Say how many litres you have for the app.')
    if (l > max) return setErr(`You have ${litres(max)} of fresh ${milkLabel[type].toLowerCase()} milk. List that much or less.`)
    if (!(Number(f.price) > 0)) return setErr('Enter your price per litre.')
    if (g && Number(f.price) > g.max) return setErr(`The most you can charge is ${rs(g.max)} a litre (${g.maxPct}% above what you pay farmers).`)
    if (Number(f.discount) < 0 || Number(f.discount) > 90) return setErr('Discount can be 0 to 90%.')
    setBusy(true)
    try {
      if (listing) {
        await saveListing({ ...listing, listed_l: l, price: f.price, discount_pct: f.discount, description: f.description.trim() })
        toast('Listing saved.')
      } else {
        await createListing(type, f.price, l, f.description.trim())
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
              <span className="hint">Every order takes its litres off this number. When it reaches 0 the milk shows as sold out.</span></div>

            <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
              <div className="field"><label htmlFor="lp">Price per litre</label>
                <div className="flex items-center gap-2"><span className="text-muted">Rs</span>
                  <input id="lp" className={`input num w-full ${g && Number(f.price) > g.max ? 'border-danger' : ''}`} type="number" min="1" value={f.price} onChange={set('price')} /></div>
                {g && <span className="hint">You pay farmers {rs(Math.round(g.cost))}. Fair price {rs(g.suggest)}, at most {rs(g.max)}.
                  {Number(f.price) !== g.suggest && <button type="button" className="ml-1 font-semibold text-forest underline" onClick={() => setF({ ...f, price: String(g.suggest) })}>Use {rs(g.suggest)}</button>}</span>}
              </div>
              <div className="field"><label htmlFor="ld">Discount</label>
                <div className="flex items-center gap-2"><input id="ld" className="input num w-full" type="number" min="0" max="90" value={f.discount} onChange={set('discount')} /><span className="text-muted">%</span></div></div>
            </div>

            <div className="field"><label htmlFor="lx">Description <span className="font-normal text-muted">(optional)</span></label>
              <input id="lx" className="input" maxLength={140} placeholder="e.g. Thick buffalo milk, collected this morning" value={f.description} onChange={set('description')} /></div>

            <div className="rounded-2xl border border-line bg-cream px-4 py-3.5 text-[13.5px]">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Customers will see</p>
              <p className="mt-1.5"><b className="num">{litres(Number(f.litres) || 0)}</b> of {milkLabel[type].toLowerCase()} milk{grades[type] ? `, ${gradeLabel[grades[type]].toLowerCase()} grade` : ''}, at <b className="num">{rs(final)}</b> a litre{Number(f.discount) > 0 ? ` (${f.discount}% off)` : ''}.</p>
              {platform && <p className="mt-1 text-muted">They can order {Number(platform.order_min_l)} to {Number(platform.order_max_l)} L at a time, set by ApnaDairy.</p>}
            </div>
          </>
        )}
      </form>
    </Sheet>
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
    setBusy(true)
    try { await saveShopProfile(data.center.id, p); toast('Shop profile saved.'); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const upload = async (files) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'))
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
          <div className="field"><label htmlFor="ph">Phone</label><input id="ph" className="input" inputMode="tel" value={p.phone ?? ''} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="wa">WhatsApp</label><input id="wa" className="input" inputMode="tel" value={p.whatsapp ?? ''} onChange={set('whatsapp')} /></div>
          <div className="field"><label htmlFor="oh">Opening hours</label><input id="oh" className="input" placeholder="e.g. Every day, 6 am to 10 pm" value={p.opening_hours ?? ''} onChange={set('opening_hours')} /></div>
          <div className="field"><label htmlFor="dr">Delivery area</label>
            <div className="flex items-center gap-2"><input id="dr" className="input num w-24" type="number" min="0" max="50" step="0.5" value={p.delivery_radius_km ?? ''} onChange={set('delivery_radius_km')} /><span className="text-[13px] text-muted">km around the shop</span></div></div>
        </div>
        <p className="mt-4 text-[12.5px] text-muted">Your shop name, city and address come from registration. Contact support to change them.</p>
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
    setBusy(true)
    try { await replyReview(r.id, text); toast('Reply posted.'); setOpen(false); await reload() } catch (e) { toast(e.message, 'error') }
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
  const listings = (data?.pub ?? []).slice().sort((a, b) => TYPES.indexOf(a.milk_type) - TYPES.indexOf(b.milk_type))
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

          <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-muted">Milk today</p>
          <ul className="mt-2 grid gap-2">
            {listings.length === 0 && <li className="rounded-2xl bg-surface px-3 py-3 text-[12.5px] text-muted">No milk listed yet</li>}
            {listings.map((l) => (
              <li key={l.id} className="rounded-2xl border border-line bg-surface px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-semibold">{l.name}</p>
                    <p className="text-[11.5px] text-muted">{Number(l.available_l) > 0 ? `${Math.floor(l.available_l)} L available` : 'Sold out for now'}{l.quality ? ` · ${l.quality[0].toUpperCase()}${l.quality.slice(1)}` : ''}</p>
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
