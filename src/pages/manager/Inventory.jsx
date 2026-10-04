import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  milkStock, stockBatches, usageLog, products, productSales, recordUsage, saveProduct, setProduct, shelfBatches, stockLeft, milkCost, platformSettings,
  milkLabel, categoryLabel, usageLabel, timeOf, todayKey,
} from '../../lib/center'
import { rs, litres, date, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'

const TYPES = ['buffalo', 'cow', 'mixed']

export default function Inventory() {
  const [tab, setTab] = useState('milk')
  const { data, error, reload } = useLoad(async () => {
    const [stock, batches, usage, prods, sales, cost, platform] = await Promise.all([milkStock(), stockBatches(), usageLog(), products(), productSales(), milkCost(), platformSettings()])
    return { stock, batches, usage, prods, sales, cost, platform }
  })
  const [usage, setUsage] = useState(null)
  const [product, setProductForm] = useState(null)

  return (
    <>
      <PageHeader title="Inventory" description="Milk on your shelf, what to sell first, and the products your customers can order.">
        {tab === 'milk'
          ? <button className="btn-primary" onClick={() => setUsage({})}><Icon name="minus" size={17} />Take milk out</button>
          : <button className="btn-primary" onClick={() => setProductForm({})}><Icon name="plus" size={17} />Add product</button>}
      </PageHeader>
      <div className="mb-5"><Segmented value={tab} onChange={setTab} options={[{ value: 'milk', label: 'Milk stock' }, { value: 'products', label: 'Products', count: data?.prods.length }]} /></div>
      <Alert>{error}</Alert>
      {tab === 'milk' ? <MilkStock data={data} onUse={setUsage} /> : <Products data={data} reload={reload} onEdit={setProductForm} />}
      <UsageForm key={usage ? 'usage-' + (usage.milk_type ?? '') : 'usage-closed'} value={usage} stock={data?.stock} onClose={() => setUsage(null)} onSaved={reload} />
      <ProductForm key={product ? product.id ?? 'product-new' : 'product-closed'} value={product} guide={(t) => milkGuide(data, t)} onClose={() => setProductForm(null)} onSaved={reload} />
    </>
  )
}

function MilkStock({ data, onUse }) {
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

        <Card title="Taken out of stock" subtitle="Milk made into products, spoiled or used at home">
          {data && data.usage.length === 0 && <p className="py-6 text-center text-muted">Nothing recorded yet.</p>}
          <ul className="grid grid-cols-[minmax(0,1fr)] divide-y divide-line">
            {data?.usage.slice(0, 10).map((u) => (
              <li key={u.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-semibold">{usageLabel[u.reason]}</p>
                  <p className="truncate text-[12.5px] text-muted">{u.note ?? milkLabel[u.milk_type]} · {date(u.created_at)}, {timeOf(u.created_at)}</p>
                </div>
                <span className={`num shrink-0 text-[14px] font-semibold ${u.reason === 'spoiled' ? 'text-danger' : ''}`}>−{litres(u.litres)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  )
}

// fair price for fresh milk: what the center paid farmers, plus the suggested and maximum markup
function milkGuide(data, type) {
  const c = data?.cost?.find((x) => x.milk_type === type)
  if (!c?.avg_cost || !data?.platform) return null
  const cost = Number(c.avg_cost)
  return {
    cost,
    suggest: Math.round(cost * (100 + Number(data.platform.markup_suggest_pct)) / 100),
    max: Math.floor(cost * (100 + Number(data.platform.markup_max_pct)) / 100),
    suggestPct: Number(data.platform.markup_suggest_pct), maxPct: Number(data.platform.markup_max_pct),
  }
}

// dynamic pricing (sample rule until the ai pricing model is connected):
// suggest a discount as products near their expiry date
function priceTip(p) {
  if (p.category === 'milk' || !p.expires_on || Number(p.stock_qty) <= 0) return null
  const days = Math.round((new Date(`${p.expires_on}T23:59:59+05:00`) - Date.now()) / 864e5)
  if (days < 0) return { kind: 'expired', text: 'Past its expiry date. Take it off sale.' }
  if (days <= 1 && p.discount_pct < 25) return { kind: 'discount', pct: 25, text: `Expires ${days === 0 ? 'today' : 'tomorrow'}. Sell faster at 25% off.` }
  if (days <= 2 && p.discount_pct < 10) return { kind: 'discount', pct: 10, text: 'Expires in 2 days. Try 10% off.' }
  return null
}

function Products({ data, reload, onEdit }) {
  const { toast } = useUi()
  const sold = Object.fromEntries((data?.sales ?? []).map((s) => [s.product_id, s]))
  const stock = Object.fromEntries((data?.stock ?? []).map((s) => [s.milk_type, stockLeft(s)]))
  const act = async (p, patch, msg) => { try { await setProduct(p.id, patch); toast(msg); reload() } catch (e) { toast(e.message, 'error') } }

  if (data && data.prods.length === 0) {
    return <div className="panel"><EmptyState title="No products yet" action={<button className="btn-primary btn-sm" onClick={() => onEdit({})}>Add product</button>}>Add fresh milk, dahi, ghee and anything else you sell. Customers see these in the app.</EmptyState></div>
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {data?.prods.map((p) => {
        const s = sold[p.id]
        const tip = priceTip(p)
        const qty = p.category === 'milk' ? stock[p.milk_type] ?? 0 : Number(p.stock_qty)
        const finalPrice = p.price * (100 - p.discount_pct) / 100
        const guide = p.category === 'milk' ? milkGuide(data, p.milk_type) : null
        const over = guide && Number(p.price) > guide.max
        return (
          <div key={p.id} className={`panel animate-rise flex flex-col p-5 ${p.is_available ? '' : 'opacity-70'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <span className="rounded-full bg-cream-2 px-2 py-0.5 text-[11.5px] font-semibold text-muted">{categoryLabel[p.category]}</span>
                <p className="mt-2 truncate text-[17px] font-semibold">{p.name}</p>
              </div>
              <button role="switch" aria-checked={p.is_available} aria-label={`${p.name} on sale`}
                onClick={() => act(p, { is_available: !p.is_available }, p.is_available ? `${p.name} hidden from customers.` : `${p.name} is on sale again.`)}
                className={`relative mt-1 h-6 w-11 shrink-0 rounded-full transition-colors ${p.is_available ? 'bg-forest' : 'bg-line'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${p.is_available ? 'left-[22px]' : 'left-0.5'}`} />
              </button>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="display num text-[26px]">{rs(Math.round(finalPrice))}</span>
              <span className="text-[13px] text-muted">per {p.unit}</span>
              {p.discount_pct > 0 && <span className="num text-[13px] text-muted line-through">{rs(p.price)}</span>}
              {p.discount_pct > 0 && <span className="rounded-full bg-haldi-soft px-2 py-0.5 text-[11.5px] font-bold text-amber">{p.discount_pct}% off</span>}
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
              <div className="rounded-xl bg-cream px-3 py-2"><dt className="text-muted">In stock</dt><dd className={`num font-semibold ${qty <= 0 ? 'text-danger' : ''}`}>{+Number(qty).toFixed(1)} {p.unit === 'litre' ? 'L' : p.unit === 'kg' || Number(qty) === 1 ? p.unit : `${p.unit}s`}</dd></div>
              <div className="rounded-xl bg-cream px-3 py-2"><dt className="text-muted">Sold, 30 days</dt><dd className="num font-semibold">{s ? rs(Math.round(s.revenue)) : 'Rs 0'}</dd></div>
            </dl>
            {p.expires_on && <p className="mt-2 text-[12.5px] text-muted">Made {date(p.made_on)} · use by {date(p.expires_on)}</p>}
            {guide && (
              <div className={`mt-3 rounded-xl px-3 py-2 text-[12.5px] ${over ? 'bg-[#f8e2dc] text-danger' : 'bg-mint-soft text-forest'}`}>
                <p>You pay farmers {rs(Math.round(guide.cost))} a litre. Fair price {rs(guide.suggest)} (+{guide.suggestPct}%), at most {rs(guide.max)}.</p>
                {over && <button className="mt-1 font-semibold underline" onClick={() => act(p, { price: guide.suggest }, `${p.name} now ${rs(guide.suggest)} a litre.`)}>Set to {rs(guide.suggest)}</button>}
              </div>
            )}
            {tip && (
              <div className={`mt-3 flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[13px] ${tip.kind === 'expired' ? 'bg-[#f8e2dc] text-danger' : 'bg-haldi-soft text-forest-deep'}`}>
                <span className="flex items-center gap-1.5"><Icon name="spark" size={14} />{tip.text}</span>
                {tip.kind === 'discount'
                  ? <button className="shrink-0 font-semibold underline" onClick={() => act(p, { discount_pct: tip.pct }, `${tip.pct}% off ${p.name}.`)}>Apply</button>
                  : p.is_available && <button className="shrink-0 font-semibold underline" onClick={() => act(p, { is_available: false }, `${p.name} taken off sale.`)}>Hide</button>}
              </div>
            )}
            <div className="mt-auto pt-4"><button className="btn-secondary btn-sm w-full" onClick={() => onEdit(p)}><Icon name="edit" size={15} />Edit</button></div>
          </div>
        )
      })}
    </div>
  )
}

function UsageForm({ value, stock, onClose, onSaved }) {
  const { toast } = useUi()
  const [u, setU] = useState(() => ({ milk_type: 'buffalo', reason: 'products', litres: '', note: '', ...value }))
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
    <Sheet open={value !== null} onClose={onClose} title="Take milk out of stock" subtitle="For milk that was not sold: turned into products, spoiled or used at home."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="usage-form" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form id="usage-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><span className="label">Milk</span>
          <Segmented value={u.milk_type} onChange={(v) => setU({ ...u, milk_type: v })} options={TYPES.map((t) => ({ value: t, label: milkLabel[t] }))} />
          <span className="hint">{Math.round(max)} L in stock</span></div>
        <div className="field"><label htmlFor="ul">Litres</label><input id="ul" className="input w-40" type="number" min="0.5" step="0.5" value={u.litres} onChange={(e) => setU({ ...u, litres: e.target.value })} /></div>
        <div className="field"><span className="label">Reason</span>
          <Segmented value={u.reason} onChange={(v) => setU({ ...u, reason: v })} options={[{ value: 'products', label: 'Products' }, { value: 'spoiled', label: 'Spoiled' }, { value: 'own_use', label: 'Own use' }]} /></div>
        <div className="field"><label htmlFor="un">Note</label><input id="un" className="input" placeholder="e.g. made 20 kg dahi" value={u.note} onChange={(e) => setU({ ...u, note: e.target.value })} /></div>
      </form>
    </Sheet>
  )
}

function ProductForm({ value, guide, onClose, onSaved }) {
  const { toast } = useUi()
  const [p, setP] = useState(() => ({ category: 'yogurt', unit: 'kg', milk_type: 'buffalo', discount_pct: 0, is_available: true, made_on: todayKey(), ...value }))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setP({ ...p, [k]: e.target.value })
  const isMilk = p.category === 'milk'
  const submit = async (e) => {
    e.preventDefault()
    if (!p.name?.trim()) return setErr('Enter a product name.')
    if (!(Number(p.price) > 0)) return setErr('Enter a price.')
    if (p.expires_on && p.made_on && p.expires_on < p.made_on) return setErr('Use-by date is before the made date.')
    const g = isMilk ? guide(p.milk_type) : null
    if (g && Number(p.price) > g.max) return setErr(`Fresh milk can be at most ${g.maxPct}% above your buying price: ${rs(g.max)} a litre or less.`)
    setBusy(true)
    try { await saveProduct(p); toast(p.id ? 'Product updated.' : `${p.name} added.`); onSaved(); onClose() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <Sheet open={value !== null} onClose={onClose} title={p.id ? 'Edit product' : 'Add a product'} subtitle="Customers see available products in the ApnaDairy app."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="product-form" disabled={busy}>{busy ? 'Saving…' : 'Save product'}</button></>}>
      <form id="product-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" placeholder="e.g. Fresh buffalo milk" value={p.name ?? ''} onChange={set('name')} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label htmlFor="pc">Type</label>
            <select id="pc" className="input" value={p.category} onChange={set('category')} disabled={!!p.id}>
              {Object.entries(categoryLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          {isMilk ? (
            <div className="field"><label htmlFor="pm">Milk</label>
              <select id="pm" className="input" value={p.milk_type} onChange={set('milk_type')} disabled={!!p.id}>
                {TYPES.map((t) => <option key={t} value={t}>{milkLabel[t]}</option>)}
              </select></div>
          ) : (
            <div className="field"><label htmlFor="pu">Sold per</label>
              <select id="pu" className="input" value={p.unit} onChange={set('unit')}>
                <option value="kg">kg</option><option value="bottle">bottle</option><option value="pack">pack</option>
              </select></div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label htmlFor="pp">Price (Rs per {isMilk ? 'litre' : p.unit})</label><input id="pp" className="input num" type="number" min="1" value={p.price ?? ''} onChange={set('price')} /></div>
          <div className="field"><label htmlFor="pd">Discount %</label><input id="pd" className="input num" type="number" min="0" max="90" value={p.discount_pct} onChange={set('discount_pct')} /></div>
        </div>
        {isMilk ? (
          <div className="rounded-2xl bg-cream px-4 py-3 text-[13.5px] text-muted">
            <p>Fresh milk sells from your milk stock, so there is no separate quantity to enter.</p>
            {guide(p.milk_type) && (() => { const g = guide(p.milk_type); return (
              <p className="mt-2 text-forest">You pay farmers {rs(Math.round(g.cost))} a litre. Suggested {rs(g.suggest)} (+{g.suggestPct}%), at most {rs(g.max)} (+{g.maxPct}%).
                {' '}<button type="button" className="font-semibold underline" onClick={() => setP({ ...p, price: g.suggest })}>Use {rs(g.suggest)}</button></p>
            ) })()}
          </div>
        ) : (
          <>
            <div className="field"><label htmlFor="ps">In stock ({p.unit})</label><input id="ps" className="input num w-40" type="number" min="0" step="0.5" value={p.stock_qty ?? ''} onChange={set('stock_qty')} /></div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="field"><label htmlFor="pmd">Made on</label><input id="pmd" className="input" type="date" value={p.made_on ?? ''} onChange={set('made_on')} /></div>
              <div className="field"><label htmlFor="pe">Use by</label><input id="pe" className="input" type="date" value={p.expires_on ?? ''} onChange={set('expires_on')} /></div>
            </div>
          </>
        )}
      </form>
    </Sheet>
  )
}
