import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad } from '../lib/useLoad'
import { useAuth } from '../context/AuthContext'
import { homeFor } from '../lib/roles'
import { milkLabel, qualityLabel, qualityHint, productQualityHint, qtyText, perUnit, isMilk, productLabel } from '../lib/b2b'
import { rs, date, dateTime, relative } from '../lib/format'
import PublicHeader from '../components/landing/PublicHeader'
import Footer from '../components/landing/Footer'
import Segmented from '../components/Segmented'
import Alert from '../components/Alert'
import { MilkChurn } from '../components/Farm'
import OffersList from '../components/OffersList'

const sorts = {
  closing: { label: 'Closing soon', fn: (a, b) => new Date(a.bid_deadline) - new Date(b.bid_deadline) },
  litres: { label: 'Largest', fn: (a, b) => b.quantity_l - a.quantity_l },
  newest: { label: 'Newest first', fn: (a, b) => new Date(b.created_at) - new Date(a.created_at) },
  price: { label: 'Highest target price', fn: (a, b) => (b.target_price ?? 0) - (a.target_price ?? 0) },
}
const qualityTone = { fresh: 'bg-mint-soft text-forest', premium: 'bg-haldi-soft text-amber', standard: 'bg-cream-2 text-muted' }
const who = (type) => (type === 'other' ? 'A business' : `${/^[aeiou]/i.test(type) ? 'An' : 'A'} ${type}`)
const hoursLeft = (r) => (new Date(r.bid_deadline) - Date.now()) / 36e5

// what the main button says depends on who is looking
function useAction() {
  const { profile } = useAuth()
  if (profile?.role === 'area_manager') return { label: 'Place a bid', to: (r) => `/manager/bulk-requests/${r.id}` }
  if (profile?.role === 'business') return { label: 'Post your own requirement', to: () => '/business/requirements/new' }
  if (profile) return { label: 'Open your portal', to: () => homeFor(profile.role) }
  return { label: 'Sign in to bid', to: () => '/login' }
}

function TimeLeft({ r }) {
  const h = hoursLeft(r)
  const urgent = h < 24
  const total = (new Date(r.bid_deadline) - new Date(r.created_at)) / 36e5
  const used = clampPct(1 - h / total)
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]">
        <span className={`font-semibold ${urgent ? 'text-danger' : 'text-ink'}`}>{urgent ? 'Closing ' : 'Closes '}{relative(r.bid_deadline)}</span>
        <span className="text-muted">{date(r.bid_deadline)}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-2">
        <div className={`h-full rounded-full ${urgent ? 'bg-danger' : 'bg-haldi'}`} style={{ width: `${used * 100}%` }} />
      </div>
    </div>
  )
}
const clampPct = (v) => Math.max(0.04, Math.min(1, v))

function RequestCard({ r, onOpen, i }) {
  return (
    <button onClick={() => onOpen(r)} style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}
      className="panel group flex animate-rise flex-col p-5 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-[0_24px_40px_-30px_rgb(23_58_40/.7)] focus-visible:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <span className={`rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${qualityTone[r.quality]}`}>{qualityLabel[r.quality]}</span>
        <span className="num rounded-full bg-cream-2 px-2.5 py-1 text-[12.5px] font-medium text-muted">{r.bid_count} {r.bid_count === 1 ? 'offer' : 'offers'}</span>
      </div>
      <p className="display num mt-4 text-[38px] leading-none text-forest-deep">{qtyText(r.quantity_l, r.unit)}</p>
      <p className="mt-1.5 text-[15.5px] font-semibold">{isMilk(r) ? milkLabel[r.milk_type] : productLabel[r.product]}</p>
      <p className="mt-1 text-[14.5px] text-muted">{who(r.business_type)} in {r.delivery_city}</p>

      <dl className="mt-4 grid grid-cols-3 gap-3 rounded-2xl bg-cream px-4 py-3 text-[14px]">
        <div><dt className="text-[12.5px] text-muted">Needed by</dt><dd className="num font-semibold">{date(r.required_date).replace(/ \d{4}$/, '')}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Target</dt><dd className="num font-semibold">{r.target_price ? rs(r.target_price) : 'Open'}</dd></div>
        <div><dt className="text-[12.5px] text-muted">Lowest offer</dt><dd className={`num font-semibold ${r.lowest_offer ? 'text-forest' : 'text-muted'}`}>{r.lowest_offer ? rs(r.lowest_offer) : 'None yet'}</dd></div>
      </dl>

      <div className="mt-4"><TimeLeft r={r} /></div>
      <span className="mt-4 text-[14px] font-semibold text-forest group-hover:underline">See details</span>
    </button>
  )
}

function DetailPanel({ r, onClose }) {
  const action = useAction()
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])
  if (!r) return null
  const total = r.target_price ? Number(r.target_price) * Number(r.quantity_l) : null
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Request details">
      <div className="absolute inset-0 bg-forest-deep/40 backdrop-blur-[2px]" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[460px] animate-rise flex-col overflow-y-auto bg-surface shadow-2xl">
        <div className="furrows relative bg-forest-deep p-6 text-cream">
          <button onClick={onClose} className="absolute right-4 top-4 rounded-full bg-cream/10 px-3 py-1 text-[13px] font-medium hover:bg-cream/20">Close</button>
          <MilkChurn size={56} stroke="#fffcf4" className="mb-3" />
          <p className="display num text-[44px] leading-none">{qtyText(r.quantity_l, r.unit)}</p>
          <p className="mt-2 text-[17px] font-semibold">{isMilk(r) ? milkLabel[r.milk_type] : `${productLabel[r.product]}, from ${milkLabel[r.milk_type].toLowerCase()}`}</p>
          <span className="mt-3 inline-flex rounded-full bg-haldi px-3 py-1 text-[13px] font-bold text-forest-deep">{qualityLabel[r.quality]}</span>
          <p className="mt-1.5 text-[13.5px] text-cream/70">{isMilk(r) ? qualityHint[r.quality] : productQualityHint[r.quality]}</p>
        </div>

        <dl className="divide-y divide-line px-6">
          {[
            ['Buyer', `${who(r.business_type)} (verified)`],
            ['Deliver to', r.delivery_city],
            ['Needed by', date(r.required_date)],
            ['Target price', r.target_price ? `${rs(r.target_price)} per ${isMilk(r) ? 'litre' : perUnit(r.unit)}` : 'No target, best offer'],
            ['Order value at target', total ? rs(total) : '—'],
            ['Offers so far', `${r.bid_count}`],
            ['Bidding closes', dateTime(r.bid_deadline)],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between gap-6 py-3.5 text-[15px]"><dt className="text-muted">{k}</dt><dd className="num text-right font-semibold">{v}</dd></div>
          ))}
        </dl>

        <div className="px-6 pb-4 pt-2"><TimeLeft r={r} /></div>

        <section className="px-6 pb-5">
          <p className="mb-3 font-semibold">Offers so far</p>
          <OffersList requirementId={r.id} target={r.target_price} unit={r.unit} />
        </section>

        <div className="mx-6 rounded-2xl bg-cream px-5 py-4 text-[14.5px]">
          <p className="font-semibold">What happens next</p>
          <ol className="mt-2 space-y-1.5 text-muted">
            <li>1. Verified collection centers post their price here.</li>
            <li>2. The buyer compares bids and picks one.</li>
            <li>3. The chosen center delivers by the date above.</li>
          </ol>
        </div>

        <div className="mt-auto flex flex-col gap-2 p-6">
          <Link to={action.to(r)} className="btn-primary h-12 w-full">{action.label}</Link>
          <p className="text-center text-[13px] text-muted">Buyer names and addresses are only shared with verified centers.</p>
        </div>
      </aside>
    </div>
  )
}

export default function PublicRequests() {
  const { profile } = useAuth()
  const top = profile?.role === 'area_manager' ? { to: '/manager/bulk-requests', label: 'Open your bidding board' }
    : profile?.role === 'business' ? { to: '/business/requirements/new', label: 'Post a requirement' }
    : profile ? { to: homeFor(profile.role), label: 'Open your portal' }
    : { to: '/login', label: 'Sign in to bid' }
  const { data, error, loading } = useLoad(async () => {
    const { data, error } = await supabase.from('public_requests').select('*')
    if (error) throw error
    return data
  })
  const [q, setQ] = useState('')
  const [milk, setMilk] = useState('all')
  const [quality, setQuality] = useState('all')
  const [sort, setSort] = useState('closing')
  const [open, setOpen] = useState(null)

  const all = data ?? []
  const shown = useMemo(() => all
    .filter((r) => milk === 'all' || (milk === 'milk' ? isMilk(r) : !isMilk(r)))
    .filter((r) => quality === 'all' || r.quality === quality)
    .filter((r) => !q.trim() || r.delivery_city.toLowerCase().includes(q.trim().toLowerCase()) || r.business_type.includes(q.trim().toLowerCase()))
    .sort(sorts[sort].fn), [all, milk, quality, q, sort])

  const litres = all.filter(isMilk).reduce((n, r) => n + Number(r.quantity_l), 0)
  const productCount = all.filter((r) => !isMilk(r)).length
  const closingToday = all.filter((r) => hoursLeft(r) < 24).length
  const count = (key, v) => all.filter((r) => r[key] === v).length
  const filtered = milk !== 'all' || quality !== 'all' || q
  const clear = () => { setMilk('all'); setQuality('all'); setQ('') }

  return (
    <div className="min-h-full bg-cream">
      <PublicHeader />
      <main className="mx-auto max-w-[1320px] px-4 pb-20 pt-8 sm:px-8">
        {/* title + who-specific action */}
        <div className="flex flex-wrap items-end justify-between gap-5 animate-rise">
          <div>
            <h1 className="display text-[40px] text-forest-deep sm:text-[48px]">Bulk dairy requests</h1>
            <p className="mt-2 max-w-[600px] text-[16.5px] text-muted">Businesses post how much milk, desi ghee, butter or other dairy they need. Verified sellers send a price, and the buyer chooses, or splits a big order between sellers.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!profile && <Link to="/signup?role=business" className="btn-secondary">Post a requirement</Link>}
            <Link to={top.to} className="btn-primary">{top.label}</Link>
          </div>
        </div>

        {/* live numbers */}
        <div className="mt-6 flex flex-wrap gap-2">
          {[
            [`${all.length}`, all.length === 1 ? 'open request' : 'open requests'],
            [`${litres.toLocaleString('en-PK')} L`, 'of milk wanted'],
            [`${productCount}`, productCount === 1 ? 'dairy product request' : 'dairy product requests'],
            [`${closingToday}`, 'closing within 24 hours'],
          ].map(([n, l]) => (
            <span key={l} className="num inline-flex items-baseline gap-1.5 rounded-full bg-surface px-4 py-2 text-[14px] ring-1 ring-line">
              <span className="font-bold text-forest-deep">{data ? n : '—'}</span><span className="text-muted">{l}</span>
            </span>
          ))}
        </div>

        {/* filters */}
        <div className="sticky top-[68px] z-30 -mx-4 mt-8 border-y border-line bg-cream/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full sm:w-64">
              <input className="input w-full pl-10" placeholder="Search a city" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search by city" />
              <svg className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            </div>
            <Segmented size="sm" value={milk} onChange={setMilk} options={[
              { value: 'all', label: 'Everything' },
              { value: 'milk', label: 'Milk', count: all.filter(isMilk).length },
              { value: 'products', label: 'Dairy products', count: all.filter((r) => !isMilk(r)).length },
            ]} />
            <Segmented size="sm" value={quality} onChange={setQuality} options={[
              { value: 'all', label: 'Any quality' },
              ...['fresh', 'standard', 'premium'].map((v) => ({ value: v, label: qualityLabel[v], count: count('quality', v) })),
            ]} />
            <label className="ml-auto flex items-center gap-2 text-[14px] text-muted">
              Sort
              <select className="input h-9 py-0 pr-8 text-[14px]" value={sort} onChange={(e) => setSort(e.target.value)}>
                {Object.entries(sorts).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section aria-live="polite">
            <Alert>{error}</Alert>
            {filtered && data && (
              <p className="mb-4 text-[14px] text-muted">
                Showing {shown.length} of {all.length}. <button onClick={clear} className="font-semibold text-forest hover:underline">Clear filters</button>
              </p>
            )}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-2 2xl:grid-cols-3">
              {loading && [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[330px] rounded-[20px]" />)}
              {shown.map((r, i) => <RequestCard key={r.id} r={r} i={i} onOpen={setOpen} />)}
            </div>
            {!loading && shown.length === 0 && (
              <div className="panel px-6 py-14 text-center">
                <MilkChurn size={48} className="mx-auto" />
                <p className="display mt-3 text-[20px]">{all.length ? 'No requests match these filters' : 'No open requests right now'}</p>
                <p className="mx-auto mt-1 max-w-sm text-muted">{all.length ? 'Try another city or quality.' : 'Verified businesses post new requests every week. Check back soon.'}</p>
                {all.length > 0 && <button onClick={clear} className="btn-secondary mt-5">Clear filters</button>}
              </div>
            )}
          </section>

          {/* how it works, always visible on wide screens */}
          <aside className="space-y-4 xl:sticky xl:top-[150px] xl:self-start">
            <div className="panel p-5">
              <p className="display text-[20px]">How bulk bidding works</p>
              <ol className="mt-4 space-y-4">
                {[
                  ['A business posts a need', 'Milk or a dairy product, how much, quality, date and a target price.'],
                  ['Sellers post offers', 'Every offer is visible here, so prices stay fair.'],
                  ['The buyer chooses', 'One seller, or a big order split between sellers. Each delivers and tracks its part.'],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-3">
                    <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-full bg-forest text-[13px] font-bold text-cream">{i + 1}</span>
                    <span><span className="block text-[14.5px] font-semibold">{t}</span><span className="text-[13.5px] text-muted">{d}</span></span>
                  </li>
                ))}
              </ol>
            </div>
            {!profile && (
              <div className="rounded-[20px] bg-haldi p-5">
                <p className="display text-[20px] text-forest-deep">Run a milk center or make dairy products?</p>
                <p className="mt-1 text-[14px] text-forest-deep/80">Register, get verified, and bid on the requests here.</p>
                <Link to="/signup?role=area_manager" className="btn-primary btn-sm mt-4">Register as a seller</Link>
              </div>
            )}
          </aside>
        </div>
      </main>
      <Footer />
      <DetailPanel r={open} onClose={() => setOpen(null)} />
    </div>
  )
}
