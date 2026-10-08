import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useLoad'
import { milkLabel, qualityLabel, productLabel, qtyText, perUnit, GRADES } from '../lib/b2b'
import { dateTimeShort, spoilageBand } from '../lib/center'
import { rs, date } from '../lib/format'
import Segmented from './Segmented'
import Alert from './Alert'
import Icon from './Icon'
import ProductImage from './ProductImage'
import AppPrompt from './AppPrompt'
import { MilkChurn } from './Farm'

// the product catalog: what milk and dairy products are on sale right now. view only:
// "Order" explains that buying happens in the mobile app. businesses can turn a listing into a bulk request.
const gradeTone = { premium: 'bg-haldi-soft text-amber', fresh: 'bg-mint-soft text-forest', standard: 'bg-cream-2 text-muted' }
const hoursLeft = (d) => (d ? (new Date(d) - Date.now()) / 36e5 : null)
const leftText = (h) => (h == null ? '' : h < 1 ? 'under an hour left' : h < 48 ? `${Math.round(h)} h left` : `${Math.round(h / 24)} days left`)
const MILK_SORTS = {
  fresh: { label: 'Freshest', fn: (a, b) => (b.freshness_score ?? -1) - (a.freshness_score ?? -1) },
  cheap: { label: 'Lowest price', fn: (a, b) => a.price_per_l - b.price_per_l },
  most: { label: 'Most available', fn: (a, b) => b.available_l - a.available_l },
  newest: { label: 'Newest listing', fn: (a, b) => new Date(b.listed_at) - new Date(a.listed_at) },
  longest: { label: 'Sells longest', fn: (a, b) => new Date(b.expires_at ?? 0) - new Date(a.expires_at ?? 0) },
}
const PRODUCT_SORTS = {
  cheap: { label: 'Lowest price', fn: (a, b) => a.price - b.price },
  most: { label: 'Most available', fn: (a, b) => b.available_qty - a.available_qty },
  newest: { label: 'Newest listing', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
}

export default function Marketplace({ business = false }) {
  const [params, setParams] = useSearchParams()
  const { data, error, loading } = useLoad(async () => {
    const [m, p] = await Promise.all([supabase.from('marketplace_milk').select('*'), supabase.from('marketplace_products').select('*')])
    if (m.error || p.error) throw m.error || p.error
    return { milk: m.data, products: p.data }
  })
  const tab = params.get('tab') === 'products' ? 'products' : 'milk'
  const shop = params.get('shop')
  const setParam = (k, v) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }) }
  const [q, setQ] = useState('')
  const [type, setType] = useState('all')
  const [grade, setGrade] = useState('all')
  const [cat, setCat] = useState('all')
  const [sort, setSort] = useState('fresh')
  const [view, setView] = useState('cards')
  const [buying, setBuying] = useState(null)

  const milk = useMemo(() => data?.milk ?? [], [data])
  const products = useMemo(() => data?.products ?? [], [data])
  const match = (r) => (!shop || r.shop_id === shop) && (!q.trim() || `${r.city} ${r.shop_name}`.toLowerCase().includes(q.trim().toLowerCase()))
  const milkShown = useMemo(() => milk.filter(match).filter((r) => type === 'all' || r.milk_type === type).filter((r) => grade === 'all' || r.quality === grade)
    .sort((MILK_SORTS[sort] ?? MILK_SORTS.fresh).fn), [milk, q, type, grade, sort, shop])   // eslint-disable-line react-hooks/exhaustive-deps
  const productsShown = useMemo(() => products.filter(match).filter((r) => cat === 'all' || r.category === cat)
    .sort((PRODUCT_SORTS[sort] ?? PRODUCT_SORTS.cheap).fn), [products, q, cat, sort, shop])   // eslint-disable-line react-hooks/exhaustive-deps
  const shopName = shop && [...milk, ...products].find((r) => r.shop_id === shop)?.shop_name
  const cities = new Set([...milk, ...products].map((r) => r.city)).size
  const litres = milk.reduce((n, r) => n + Number(r.available_l), 0)
  const switchTab = (t) => { setParam('tab', t === 'milk' ? null : t); setSort(t === 'milk' ? 'fresh' : 'cheap') }
  const filtered = q || type !== 'all' || grade !== 'all' || cat !== 'all' || shop
  const clear = () => { setQ(''); setType('all'); setGrade('all'); setCat('all'); setParam('shop', null) }
  const shown = tab === 'milk' ? milkShown : productsShown

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {[[`${litres.toLocaleString('en-PK', { maximumFractionDigits: 0 })} L`, 'of tested milk on sale'], [`${milk.length}`, milk.length === 1 ? 'milk listing' : 'milk listings'],
          [`${products.length}`, products.length === 1 ? 'dairy product' : 'dairy products'], [`${cities}`, cities === 1 ? 'city' : 'cities']].map(([n, l]) => (
          <span key={l} className="num inline-flex items-baseline gap-1.5 rounded-full bg-surface px-4 py-2 text-[14px] ring-1 ring-line">
            <span className="font-bold text-forest-deep">{data ? n : '—'}</span><span className="text-muted">{l}</span>
          </span>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 rounded-[20px] border border-line bg-surface px-4 py-3">
        <Segmented value={tab} onChange={switchTab} options={[
          { value: 'milk', label: 'Milk', count: data ? milk.length : null },
          { value: 'products', label: 'Dairy products', count: data ? products.length : null },
        ]} />
        <div className="relative w-full sm:w-60">
          <input className="input h-10 w-full pl-10 text-[14px]" placeholder="City or seller" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by city or seller" />
          <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
        </div>
        {tab === 'milk' ? (
          <>
            <select className="input h-10 w-auto py-0 text-[14px]" value={type} onChange={(e) => setType(e.target.value)} aria-label="Milk type">
              <option value="all">Any milk</option>
              {Object.entries(milkLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="input h-10 w-auto py-0 text-[14px]" value={grade} onChange={(e) => setGrade(e.target.value)} aria-label="Grade">
              <option value="all">Any grade</option>
              {GRADES.map((g) => <option key={g} value={g}>{qualityLabel[g]}</option>)}
            </select>
          </>
        ) : (
          <select className="input h-10 w-auto py-0 text-[14px]" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Product">
            <option value="all">Any product</option>
            {Object.entries(productLabel).filter(([k]) => k !== 'milk').map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
        <label className="flex items-center gap-2 text-[14px] text-muted">Sort
          <select className="input h-10 w-auto py-0 text-[14px]" value={sort} onChange={(e) => setSort(e.target.value)}>
            {Object.entries(tab === 'milk' ? MILK_SORTS : PRODUCT_SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <div className="ml-auto hidden md:block">
          <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'cards', label: 'Cards' }, { value: 'compare', label: 'Compare' }]} />
        </div>
      </div>

      <Alert>{error}</Alert>
      {filtered && data && (
        <p className="mt-4 text-[14px] text-muted">
          {shopName ? <>Only <b className="text-ink">{shopName}</b>. </> : null}Showing {shown.length} of {tab === 'milk' ? milk.length : products.length}.{' '}
          <button onClick={clear} className="font-semibold text-forest hover:underline">Clear filters</button>
        </p>
      )}

      {view === 'compare' && shown.length > 0 ? (
        <div className="panel mt-5 overflow-x-auto">
          {tab === 'milk' ? <MilkTable rows={milkShown} business={business} onBuy={setBuying} /> : <ProductTable rows={productsShown} business={business} onBuy={setBuying} />}
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {loading && [0, 1, 2].map((i) => <div key={i} className="skeleton h-[380px] rounded-[20px]" />)}
          {tab === 'milk' && milkShown.map((r, i) => <MilkCard key={r.id} r={r} i={i} business={business} onBuy={setBuying} />)}
          {tab === 'products' && productsShown.map((r, i) => <ProductCard key={r.id} r={r} i={i} business={business} onBuy={setBuying} />)}
        </div>
      )}

      {!loading && shown.length === 0 && (
        <div className="panel mt-5 px-6 py-14 text-center">
          <MilkChurn size={48} className="mx-auto" />
          <p className="display mt-3 text-[20px]">{(tab === 'milk' ? milk : products).length ? 'Nothing matches these filters' : tab === 'milk' ? 'No milk on sale right now' : 'No dairy products on sale right now'}</p>
          <p className="mx-auto mt-1 max-w-sm text-muted">{(tab === 'milk' ? milk : products).length ? 'Try another city, milk or grade.' : 'Centers list fresh milk every day. Check back soon.'}</p>
          {filtered && <button onClick={clear} className="btn-secondary mt-5">Clear filters</button>}
        </div>
      )}

      <AppPrompt item={buying} onClose={() => setBuying(null)} />
    </>
  )
}

const bulkLink = (r, milk) => {
  const p = new URLSearchParams(milk ? { product: 'milk', milk_type: r.milk_type, quality: r.quality ?? 'standard', city: r.city } : { product: r.category, city: r.city })
  return `/business/requirements/new?${p}`
}

function Actions({ r, milk, business, onBuy, compact = false }) {
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? 'justify-end' : 'mt-auto pt-4'}`}>
      <button className={`btn-primary ${compact ? 'btn-sm' : 'flex-1'}`} onClick={() => onBuy({ ...r, category: milk ? 'milk' : r.category })}><Icon name="cart" size={15} />Order</button>
      {business && <Link to={bulkLink(r, milk)} className={`btn-secondary ${compact ? 'btn-sm' : 'flex-1'}`} title="Post a bulk requirement for this milk; sellers then bid"><Icon name="gavel" size={15} />Request in bulk</Link>}
    </div>
  )
}

function MilkCard({ r, i, business, onBuy }) {
  const h = hoursLeft(r.expires_at)
  const aiLeft = r.model_shelf_left_h == null ? null : Number(r.model_shelf_left_h)
  return (
    <article className="panel flex min-w-0 animate-rise flex-col p-5" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
      <div className="flex items-start gap-3">
        <ProductImage category="milk" size={52} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-ink">{milkLabel[r.milk_type]}</p>
          <p className="truncate text-[13.5px] text-muted">{r.shop_name} · {r.city}</p>
          {r.rating != null && <p className="text-[12.5px] text-muted"><span className="text-haldi">★</span> {Number(r.rating).toFixed(1)} ({r.review_count})</p>}
        </div>
        <div className="text-right">
          <p className="display num text-[24px] leading-none text-forest-deep">{rs(r.price_per_l)}</p>
          <p className="text-[12px] text-muted">per litre{Number(r.discount_pct) > 0 && <> · <span className="line-through">{rs(r.list_price)}</span></>}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {r.quality && <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${gradeTone[r.quality]}`}>{qualityLabel[r.quality]}</span>}
        {r.model_quality && <span className="rounded-full bg-cream px-2.5 py-1 text-[12.5px] font-medium"><Icon name="spark" size={12} className="mr-1 inline text-forest" />AI: {r.model_quality}</span>}
        {Number(r.discount_pct) > 0 && <span className="rounded-full bg-haldi px-2.5 py-1 text-[12.5px] font-bold text-forest-deep">{r.discount_pct}% off</span>}
      </div>
      <p className="display num mt-3 text-[30px] leading-none">{qtyText(r.available_l)} <span className="text-[14px] font-medium text-muted">available</span></p>
      {r.freshness_score != null && (
        <div className="mt-3 flex items-center gap-2">
          <span className="h-1.5 flex-1 rounded-full bg-cream-2"><span className="block h-1.5 rounded-full bg-forest-2" style={{ width: `${r.freshness_score}%` }} /></span>
          <span className="num text-[12.5px] font-semibold text-forest">Freshness {r.freshness_score}/100</span>
        </div>
      )}
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl bg-cream px-4 py-3 text-[13px]">
        <div><dt className="text-muted">Spoilage risk</dt><dd className="num font-semibold">{r.spoilage_pct != null ? `${Math.round(r.spoilage_pct)}% · ${spoilageBand(Number(r.spoilage_pct)).toLowerCase()}` : '—'}</dd></div>
        <div><dt className="text-muted">Tested at</dt><dd className="num font-semibold">{r.test_ph != null ? `pH ${Number(r.test_ph).toFixed(2)}` : '—'}{r.test_temperature_c != null ? ` · ${Number(r.test_temperature_c).toFixed(0)} °C` : ''}</dd></div>
        <div><dt className="text-muted">Listed</dt><dd className="num font-semibold">{r.listed_at ? dateTimeShort(r.listed_at) : '—'}</dd></div>
        <div><dt className="text-muted">Sells until</dt><dd className={`num font-semibold ${h != null && h < 12 ? 'text-amber' : ''}`}>{r.expires_at ? dateTimeShort(r.expires_at) : '—'}</dd>
          {h != null && <p className="text-[11.5px] text-muted">{leftText(h)}</p>}</div>
      </dl>
      {aiLeft != null && aiLeft <= 0 && <p className="mt-2 text-[12px] text-amber">Past the AI's predicted shelf life, still within its 2 days.</p>}
      {r.description && <p className="mt-3 line-clamp-2 text-[13px] text-muted">“{r.description}”</p>}
      <Actions r={r} milk business={business} onBuy={onBuy} />
    </article>
  )
}

function ProductCard({ r, i, business, onBuy }) {
  return (
    <article className="panel flex min-w-0 animate-rise flex-col p-5" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
      <div className="flex items-start gap-3">
        <ProductImage category={r.category} size={52} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight text-ink">{r.name}</p>
          <p className="truncate text-[13.5px] text-muted">{productLabel[r.category]}{r.milk_type ? `, ${milkLabel[r.milk_type].toLowerCase()}` : ''}</p>
          <p className="truncate text-[13px] text-muted">{r.shop_name} · {r.city}</p>
        </div>
        <div className="text-right">
          <p className="display num text-[24px] leading-none text-forest-deep">{rs(r.price)}</p>
          <p className="text-[12px] text-muted">per {perUnit(r.unit)}{Number(r.discount_pct) > 0 && <> · <span className="line-through">{rs(r.list_price)}</span></>}</p>
        </div>
      </div>
      <p className="display num mt-4 text-[30px] leading-none">{qtyText(r.available_qty, r.unit)} <span className="text-[14px] font-medium text-muted">available</span></p>
      <dl className="mt-4 grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-2xl bg-cream px-4 py-3 text-[13px]">
        <div><dt className="text-muted">Made on</dt><dd className="num font-semibold">{r.made_on ? date(r.made_on) : '—'}</dd></div>
        <div><dt className="text-muted">Best before</dt><dd className="num font-semibold">{r.expires_on ? date(r.expires_on) : '—'}</dd></div>
        <div><dt className="text-muted">Listed</dt><dd className="num font-semibold">{date(r.created_at)}</dd></div>
        <div><dt className="text-muted">Seller rating</dt><dd className="num font-semibold">{r.rating != null ? `★ ${Number(r.rating).toFixed(1)} (${r.review_count})` : 'New'}</dd></div>
      </dl>
      {r.description && <p className="mt-3 line-clamp-2 text-[13px] text-muted">“{r.description}”</p>}
      <Actions r={r} business={business} onBuy={onBuy} />
    </article>
  )
}

function MilkTable({ rows, business, onBuy }) {
  return (
    <table className="table min-w-[1180px]">
      <thead><tr><th>Milk</th><th>Seller</th><th className="text-right">Available</th><th>Grade</th><th className="text-right">Freshness</th><th className="text-right">Spoilage</th><th>Tested at</th><th className="text-right">Price / L</th><th>Listed</th><th>Sells until</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><div className="flex items-center gap-2.5"><ProductImage category="milk" size={34} /><span className="font-semibold">{milkLabel[r.milk_type]}</span></div></td>
            <td><p className="font-medium">{r.shop_name}</p><p className="text-[12.5px] text-muted">{r.city}</p></td>
            <td className="num text-right font-semibold">{qtyText(r.available_l)}</td>
            <td>{r.quality && <span className={`rounded-full px-2 py-0.5 text-[12px] font-semibold ${gradeTone[r.quality]}`}>{qualityLabel[r.quality]}</span>}{r.model_quality && <p className="mt-1 text-[12px] text-muted">AI: {r.model_quality}</p>}</td>
            <td className="num text-right">{r.freshness_score ?? '—'}</td>
            <td className="num text-right">{r.spoilage_pct != null ? `${Math.round(r.spoilage_pct)}%` : '—'}</td>
            <td className="num text-[13px]">{r.test_ph != null ? `pH ${Number(r.test_ph).toFixed(2)}` : '—'}{r.test_temperature_c != null ? ` · ${Number(r.test_temperature_c).toFixed(0)} °C` : ''}</td>
            <td className="num text-right font-semibold">{rs(r.price_per_l)}{Number(r.discount_pct) > 0 && <p className="text-[12px] font-normal text-muted">{r.discount_pct}% off</p>}</td>
            <td className="num text-[13px]">{r.listed_at ? dateTimeShort(r.listed_at) : '—'}</td>
            <td className="num text-[13px]">{r.expires_at ? dateTimeShort(r.expires_at) : '—'}<p className="text-[12px] text-muted">{leftText(hoursLeft(r.expires_at))}</p></td>
            <td><Actions r={r} milk business={business} onBuy={onBuy} compact /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ProductTable({ rows, business, onBuy }) {
  return (
    <table className="table min-w-[980px]">
      <thead><tr><th>Product</th><th>Seller</th><th className="text-right">Available</th><th className="text-right">Price</th><th>Made on</th><th>Best before</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <td><div className="flex items-center gap-2.5"><ProductImage category={r.category} size={34} /><div><p className="font-semibold">{r.name}</p><p className="text-[12.5px] text-muted">{productLabel[r.category]}</p></div></div></td>
            <td><p className="font-medium">{r.shop_name}</p><p className="text-[12.5px] text-muted">{r.city}</p></td>
            <td className="num text-right font-semibold">{qtyText(r.available_qty, r.unit)}</td>
            <td className="num text-right font-semibold">{rs(r.price)}<span className="text-[12px] font-normal text-muted"> / {perUnit(r.unit)}</span></td>
            <td className="num text-[13px]">{r.made_on ? date(r.made_on) : '—'}</td>
            <td className="num text-[13px]">{r.expires_on ? date(r.expires_on) : '—'}</td>
            <td><Actions r={r} business={business} onBuy={onBuy} compact /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
