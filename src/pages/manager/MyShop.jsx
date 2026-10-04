import { useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import {
  myCenter, milkListings, myPublicListings, myPublicShop, shopProfile, saveShopProfile, shopPhotos, uploadShopPhoto, deleteShopPhoto,
  setCoverPhoto, photoUrl, myReviews, replyReview, createListing, saveListing, milkStock, milkCost, platformSettings, stockLeft, milkLabel,
} from '../../lib/center'
import { rs, litres, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { HillsStrip } from '../../components/Farm'

const TYPES = ['buffalo', 'cow', 'mixed']

export default function MyShop() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('listings')
  const { data, error, reload } = useLoad(async () => {
    const center = await myCenter(profile.id)
    const [listings, pub, shop, prof, photos, reviews, stock, cost, platform] = await Promise.all([
      milkListings(), myPublicListings(center.id), myPublicShop(center.id), shopProfile(), shopPhotos(), myReviews(),
      milkStock(), milkCost(), platformSettings(),
    ])
    return { center, listings, pub, shop, prof, photos, reviews, stock, cost, platform }
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
              { value: 'reviews', label: 'Reviews', count: data?.reviews.length },
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
function Listings({ data, guide, reload }) {
  if (!data) return <div className="grid gap-4">{TYPES.map((t) => <div key={t} className="skeleton h-48 rounded-[20px]" />)}</div>
  return (
    <div className="grid gap-4">
      <p className="rounded-2xl bg-mint-soft px-4 py-3 text-[13.5px] text-forest">
        Milk you buy from farmers goes straight into these listings. Customers see the litres in stock, your price, your city and a freshness score from the AI.
      </p>
      {TYPES.map((t) => {
        const l = data.listings.find((x) => x.milk_type === t)
        const s = data.stock.find((x) => x.milk_type === t)
        const pub = data.pub.find((x) => x.milk_type === t)
        return l
          ? <ListingCard key={l.id} listing={l} pub={pub} stock={s ? stockLeft(s) : 0} guide={guide(t)} reload={reload} />
          : <NewListing key={t} type={t} stock={s ? stockLeft(s) : 0} guide={guide(t)} reload={reload} />
      })}
    </div>
  )
}

function ListingCard({ listing, pub, stock, guide, reload }) {
  const { toast } = useUi()
  const [l, setL] = useState(listing)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setL({ ...l, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const dirty = ['price', 'discount_pct', 'is_available', 'listed_l', 'min_order_l', 'delivers', 'description'].some((k) => String(l[k] ?? '') !== String(listing[k] ?? ''))
  const over = guide && Number(l.price) > guide.max
  const limited = l.listed_l != null && l.listed_l !== ''
  const save = async (patch) => {
    const next = { ...l, ...patch }
    if (guide && Number(next.price) > guide.max) return toast(`The most you can charge is ${rs(guide.max)} a litre (${guide.maxPct}% above what you pay farmers).`, 'error')
    setBusy(true)
    try { await saveListing(next); toast(patch?.is_available === false ? `${listing.name} hidden from the app.` : patch?.is_available ? `${listing.name} is on the app.` : 'Listing saved.'); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <section className={`panel animate-rise p-5 sm:p-6 ${listing.is_available ? '' : 'opacity-80'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="display text-[20px] text-forest-deep">{listing.name}</p>
          <p className="text-[13px] text-muted">{listing.is_available ? 'Customers can order it now' : 'Hidden from customers'}</p>
        </div>
        <button role="switch" aria-checked={listing.is_available} aria-label="Show on the app" disabled={busy}
          onClick={() => save({ is_available: !listing.is_available })}
          className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors ${listing.is_available ? 'bg-forest' : 'bg-line'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${listing.is_available ? 'left-[26px]' : 'left-0.5'}`} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <Stat label="On the app now" value={pub ? litres(+Number(pub.available_l).toFixed(1)) : litres(+stock.toFixed(1))} />
        <Stat label="Freshness" value={pub ? `${pub.freshness_score}/100` : '—'} hint={pub?.hours_left ? `about ${Math.round(pub.hours_left)} h left` : 'no milk in stock'} />
        <Stat label="Price on the app" value={rs(Math.round(l.price * (100 - (Number(l.discount_pct) || 0)) / 100))} hint="per litre" />
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor={`p-${listing.id}`}>Price per litre</label>
          <div className="flex items-center gap-2"><span className="text-muted">Rs</span>
            <input id={`p-${listing.id}`} className={`input num w-full ${over ? 'border-danger' : ''}`} type="number" min="1" value={l.price} onChange={set('price')} /></div>
          {guide && (
            <span className={`hint ${over ? 'font-semibold text-danger' : ''}`}>
              You pay farmers {rs(Math.round(guide.cost))}. Fair price {rs(guide.suggest)} (+{guide.suggestPct}%), at most {rs(guide.max)}.
              {Number(l.price) !== guide.suggest && <button type="button" className="ml-1 font-semibold text-forest underline" onClick={() => setL({ ...l, price: guide.suggest })}>Use {rs(guide.suggest)}</button>}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor={`d-${listing.id}`}>Discount %</label>
          <input id={`d-${listing.id}`} className="input num w-28" type="number" min="0" max="90" value={l.discount_pct} onChange={set('discount_pct')} />
          <span className="hint">Shown as a deal in the app</span>
        </div>
        <div className="field">
          <span className="label">Litres to show</span>
          <Segmented size="sm" value={limited ? 'limit' : 'all'} onChange={(v) => setL({ ...l, listed_l: v === 'all' ? null : Math.floor(stock) })}
            options={[{ value: 'all', label: 'All my stock' }, { value: 'limit', label: 'Up to a limit' }]} />
          {limited && <div className="mt-2 flex items-center gap-2"><input className="input num w-28" type="number" min="0" value={l.listed_l} onChange={set('listed_l')} aria-label="Litre limit" /><span className="text-[13px] text-muted">litres, keep the rest for the counter</span></div>}
        </div>
        <div className="field">
          <label htmlFor={`m-${listing.id}`}>Smallest order</label>
          <div className="flex items-center gap-2"><input id={`m-${listing.id}`} className="input num w-24" type="number" min="0.5" step="0.5" value={l.min_order_l} onChange={set('min_order_l')} /><span className="text-[13px] text-muted">litres</span></div>
          <label className="mt-2 flex items-center gap-2 text-[14px]"><input type="checkbox" className="h-4 w-4 accent-[#1f4d36]" checked={!!l.delivers} onChange={set('delivers')} />Home delivery</label>
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor={`x-${listing.id}`}>Short description</label>
          <input id={`x-${listing.id}`} className="input" maxLength={140} placeholder="e.g. Thick buffalo milk, collected this morning" value={l.description ?? ''} onChange={set('description')} />
        </div>
      </div>
      {dirty && (
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => setL(listing)}>Undo</button>
          <button className="btn-primary" onClick={() => save()} disabled={busy}>{busy ? 'Saving…' : 'Save listing'}</button>
        </div>
      )}
    </section>
  )
}

function NewListing({ type, stock, guide, reload }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState(false)
  const price = guide?.suggest ?? ({ cow: 205, buffalo: 240, mixed: 210 })[type]
  const add = async () => {
    setBusy(true)
    try { await createListing(type, price); toast(`${milkLabel[type]} milk is now on the app at ${rs(price)} a litre.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-[20px] border border-dashed border-line bg-surface/60 p-5">
      <div>
        <p className="font-semibold">{milkLabel[type]} milk is not on the app</p>
        <p className="text-[13px] text-muted">{stock > 0 ? `${Math.round(stock)} L in stock right now` : 'No stock yet. Listings fill up as you buy milk.'}</p>
      </div>
      <button className="btn-secondary" onClick={add} disabled={busy}><Icon name="plus" size={16} />List at {rs(price)} a litre</button>
    </section>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl bg-cream px-3 py-2.5">
      <p className="text-[12px] text-muted">{label}</p>
      <p className="display num text-[19px] sm:text-[21px]">{value}</p>
      {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
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

function Reviews({ data, reload }) {
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
          <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted"><Icon name="store" size={12} />{shop?.city ?? data?.center?.city}{shop?.delivery_radius_km ? ` · delivers ${Number(shop.delivery_radius_km)} km` : ''}</p>
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
                    <p className="text-[11.5px] text-muted">{Number(l.available_l) > 0 ? `${Math.floor(l.available_l)} L available` : 'Sold out for now'}</p>
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
