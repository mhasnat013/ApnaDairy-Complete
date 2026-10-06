import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { products as loadProducts, saveProduct, setProduct, categoryLabel, todayKey } from '../../lib/center'
import { qtyText, perUnit, defaultUnit, PRODUCTS } from '../../lib/b2b'
import { rs, date, plural } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import { Kpi } from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import EmptyState from '../../components/EmptyState'

const MILK = { buffalo: 'Buffalo milk', cow: 'Cow milk', mixed: 'Mixed milk' }
const daysTo = (d) => (d ? Math.round((new Date(`${d}T12:00:00`) - new Date(`${todayKey()}T12:00:00`)) / 864e5) : null)
const priceOf = (p) => Math.round(Number(p.price) * (100 - (Number(p.discount_pct) || 0)) / 100)

// what a dairy products seller sells: each product has its stock, and every order (app or bulk) takes from it
export default function Products() {
  const { data, error, reload } = useLoad(loadProducts)
  const [editing, setEditing] = useState(null)
  const list = (data ?? []).filter((p) => p.category !== 'milk')
  const live = list.filter((p) => p.is_available && Number(p.stock_qty) > 0 && !(daysTo(p.expires_on) < 0))
  const low = list.filter((p) => p.is_available && Number(p.stock_qty) > 0 && Number(p.stock_qty) < 5)
  const expiring = list.filter((p) => Number(p.stock_qty) > 0 && daysTo(p.expires_on) != null && daysTo(p.expires_on) <= 7)
  const value = list.reduce((n, p) => n + Math.max(0, Number(p.stock_qty)) * priceOf(p), 0)

  return (
    <>
      <PageHeader title="Products" description="Your desi ghee, butter, yogurt and other dairy products. Customers order them in the ApnaDairy app, and businesses through bulk requests. Every order takes from the stock you enter here.">
        <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={17} />Add product</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="On the app" value={data ? live.length : null} icon={<Icon name="store" size={16} />} note={data ? `of ${plural(list.length, 'products')}` : ''} />
        <Kpi label="Stock value" value={data ? rs(Math.round(value)) : null} note="at your current prices" />
        <Kpi label="Running low" value={data ? low.length : null} note="under 5 left" />
        <Kpi label="Expiring soon" value={data ? expiring.length : null} note="within 7 days" />
      </div>

      {data && list.length === 0 && (
        <div className="panel mt-5"><EmptyState title="Add your first product" action={<button className="btn-primary btn-sm" onClick={() => setEditing({})}><Icon name="plus" size={15} />Add product</button>}>
          Desi ghee, butter, yogurt, cheese, cream or lassi: say how much you have and your price, and customers can order it.
        </EmptyState></div>
      )}
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {!data && [1, 2].map((i) => <div key={i} className="skeleton h-52 rounded-[20px]" />)}
        {list.map((p) => <ProductCard key={p.id} p={p} reload={reload} onEdit={() => setEditing(p)} />)}
      </div>
      {editing && <ProductSheet product={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  )
}

function ProductCard({ p, reload, onEdit }) {
  const { toast } = useUi()
  const [busy, setBusy] = useState(false)
  const left = daysTo(p.expires_on)
  const out = Number(p.stock_qty) <= 0
  const expired = left != null && left < 0
  const status = !p.is_available ? ['muted', 'Hidden from customers'] : expired ? ['danger', 'Expired, not on sale'] : out ? ['amber', 'Out of stock'] : ['forest', 'Customers can order it']
  const toggle = async () => {
    setBusy(true)
    try { await setProduct(p.id, { is_available: !p.is_available }); toast(p.is_available ? `${p.name} hidden from the app.` : `${p.name} is on the app.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  return (
    <section className={`panel animate-rise p-5 ${p.is_available ? '' : 'opacity-80'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="rounded-full bg-haldi-soft px-2.5 py-0.5 text-[12px] font-semibold text-forest-deep">{categoryLabel[p.category]}</span>
          <p className="display mt-2 truncate text-[20px] text-forest-deep">{p.name}</p>
          <p className={`mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-medium ${({ forest: 'text-forest', amber: 'text-amber', danger: 'text-danger', muted: 'text-muted' })[status[0]]}`}>
            <span className={`h-2 w-2 rounded-full ${status[0] === 'forest' ? 'bg-forest-2' : status[0] === 'amber' ? 'bg-haldi' : status[0] === 'danger' ? 'bg-danger' : 'bg-line'}`} />{status[1]}</p>
        </div>
        <button role="switch" aria-checked={p.is_available} aria-label="Show on the app" disabled={busy} onClick={toggle}
          className={`relative h-7 w-[52px] shrink-0 rounded-full transition-colors ${p.is_available ? 'bg-forest' : 'bg-line'}`}>
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${p.is_available ? 'left-[26px]' : 'left-0.5'}`} />
        </button>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2">
        {[['In stock', qtyText(p.stock_qty ?? 0, p.unit), Number(p.stock_qty) > 0 && Number(p.stock_qty) < 5 ? 'running low' : ' '],
          ['Price', `${rs(priceOf(p))}`, `per ${perUnit(p.unit)}${Number(p.discount_pct) ? `, ${p.discount_pct}% off` : ''}`],
          ['Best before', p.expires_on ? date(p.expires_on) : 'Not set', left == null ? ' ' : left < 0 ? 'expired' : left === 0 ? 'today' : `in ${left} ${left === 1 ? 'day' : 'days'}`]].map(([k, v, n]) => (
          <div key={k} className="min-w-0 rounded-2xl bg-cream px-3 py-2.5">
            <dt className="truncate text-[12px] text-muted">{k}</dt>
            <dd className="num mt-0.5 truncate text-[16px] font-bold text-forest-deep">{v}</dd>
            <dd className={`truncate text-[11.5px] ${n === 'expired' || n === 'running low' ? 'font-semibold text-danger' : 'text-muted'}`}>{n}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] text-muted">{p.description ? `“${p.description}”` : p.milk_type ? `Made from ${MILK[p.milk_type]?.toLowerCase()}` : ''}</p>
        <button className="btn-secondary btn-sm shrink-0" onClick={onEdit}><Icon name="edit" size={14} />Edit or add stock</button>
      </div>
    </section>
  )
}

function ProductSheet({ product, onClose, onSaved }) {
  const { toast } = useUi()
  const isNew = !product.id
  const [f, setF] = useState(() => ({
    category: 'ghee', name: 'Desi ghee', unit: 'kg', milk_type: 'buffalo', price: '', discount_pct: '0', stock_qty: '', made_on: todayKey(), expires_on: '', description: '', is_available: true,
    ...product,
    price: product.price != null ? String(Number(product.price)) : '', stock_qty: product.stock_qty != null ? String(Number(product.stock_qty)) : '',
    discount_pct: String(product.discount_pct ?? 0),
  }))
  const [add, setAdd] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e?.target ? e.target.value : e })
  const pick = (c) => setF({ ...f, category: c, unit: defaultUnit[c], name: !f.name || Object.values(categoryLabel).includes(f.name) ? categoryLabel[c].replace(' (dahi)', '') : f.name })
  const stock = Number(f.stock_qty || 0) + Number(add || 0)
  const final = Math.round(Number(f.price || 0) * (100 - (Number(f.discount_pct) || 0)) / 100)

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (f.name.trim().length < 3) return setErr('Give the product a name customers understand, like "Pure desi ghee".')
    if (!(Number(f.price) > 0)) return setErr('Enter the price.')
    if (Number(f.discount_pct) < 0 || Number(f.discount_pct) > 90) return setErr('Discount can be 0 to 90%.')
    if (!(stock >= 0) || Number.isNaN(stock)) return setErr('Enter how much you have in stock.')
    if (f.unit === 'pack' && stock !== Math.trunc(stock)) return setErr('Packs are counted in whole numbers.')
    if (f.made_on && f.made_on > todayKey()) return setErr('The date it was made cannot be in the future.')
    if (f.expires_on && f.made_on && f.expires_on < f.made_on) return setErr('Best before must be after the date it was made.')
    setBusy(true)
    try { await saveProduct({ ...f, stock_qty: stock }); toast(isNew ? `${f.name} added.` : `${f.name} saved.`); onSaved(); onClose() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <Sheet open onClose={onClose} wide title={isNew ? 'Add product' : `Edit ${product.name}`} subtitle={isNew ? 'What you sell, how much you have and your price.' : 'Change the price, add new stock or update the dates.'}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="product-form" disabled={busy}>{busy ? 'Saving…' : isNew ? 'Add product' : 'Save'}</button></>}>
      <form id="product-form" onSubmit={submit} className="grid gap-5">
        <Alert>{err}</Alert>
        {isNew && (
          <div className="field"><span className="label">What is it?</span>
            <div className="flex flex-wrap gap-1.5">
              {PRODUCTS.map((c) => (
                <button key={c} type="button" onClick={() => pick(c)}
                  className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13.5px] font-medium transition-all ${f.category === c ? 'border-forest bg-mint-soft text-forest' : 'border-line bg-white hover:border-[#cdbd98]'}`}>{categoryLabel[c]}</button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-[1fr_150px]">
          <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" maxLength={60} value={f.name} onChange={set('name')} placeholder="Pure desi ghee" /></div>
          <div className="field"><label htmlFor="pu">Sold by</label>
            <select id="pu" className="input" value={f.unit} onChange={set('unit')}><option value="kg">kg</option><option value="litre">litre</option><option value="pack">pack</option></select></div>
        </div>
        <div className="field"><span className="label">Made from</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(MILK).map(([k, l]) => (
              <button key={k} type="button" onClick={() => set('milk_type')(k)}
                className={`rounded-full border-[1.5px] px-3.5 py-1.5 text-[13.5px] font-medium transition-all ${f.milk_type === k ? 'border-forest bg-mint-soft text-forest' : 'border-line bg-white hover:border-[#cdbd98]'}`}>{l}</button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label htmlFor="pp">Price per {perUnit(f.unit)}</label>
            <div className="flex items-center gap-2"><span className="text-muted">Rs</span><input id="pp" className="input num w-full" type="number" min="1" value={f.price} onChange={set('price')} /></div></div>
          <div className="field"><label htmlFor="pd">Discount</label>
            <div className="flex items-center gap-2"><input id="pd" className="input num w-full" type="number" min="0" max="90" value={f.discount_pct} onChange={set('discount_pct')} /><span className="text-muted">%</span></div></div>
        </div>
        {isNew ? (
          <div className="field"><label htmlFor="ps">How much do you have now?</label>
            <div className="flex items-center gap-2"><input id="ps" className="input num w-40" type="number" min="0" step={f.unit === 'pack' ? 1 : 0.5} value={f.stock_qty} onChange={set('stock_qty')} /><span className="text-muted">{f.unit === 'pack' ? 'packs' : f.unit === 'kg' ? 'kg' : 'litres'}</span></div></div>
        ) : (
          <div className="field"><label htmlFor="pa">Add new stock</label>
            <div className="flex flex-wrap items-center gap-2"><input id="pa" className="input num w-32" type="number" step={f.unit === 'pack' ? 1 : 0.5} value={add} onChange={(e) => setAdd(e.target.value)} placeholder="0" />
              <span className="text-[13px] text-muted">In stock now {qtyText(f.stock_qty || 0, f.unit)}{Number(add) ? `, after saving ${qtyText(stock, f.unit)}` : ''}</span></div>
            <span className="hint">Use a minus number to remove stock that was spoiled or used.</span></div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label htmlFor="pm">Made on</label><input id="pm" className="input num" type="date" max={todayKey()} value={f.made_on ?? ''} onChange={set('made_on')} /></div>
          <div className="field"><label htmlFor="pe">Best before</label><input id="pe" className="input num" type="date" min={f.made_on || undefined} value={f.expires_on ?? ''} onChange={set('expires_on')} /><span className="hint">After this date it is taken off sale.</span></div>
        </div>
        <div className="field"><label htmlFor="px">Description <span className="font-normal text-muted">(optional)</span></label>
          <input id="px" className="input" maxLength={140} value={f.description ?? ''} onChange={set('description')} placeholder="e.g. Made the traditional way from buffalo milk" /></div>
        <div className="rounded-2xl border border-line bg-cream px-4 py-3.5 text-[13.5px]">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">Customers will see</p>
          <p className="mt-1.5"><b>{f.name || categoryLabel[f.category]}</b>, {rs(final)} per {perUnit(f.unit)}{Number(f.discount_pct) > 0 ? ` (${f.discount_pct}% off)` : ''}, {stock > 0 ? `${qtyText(stock, f.unit)} available` : 'out of stock'}.</p>
        </div>
      </form>
    </Sheet>
  )
}
