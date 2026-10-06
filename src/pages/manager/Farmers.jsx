import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { farmersWithStats, saveFarmer, milkLabel } from '../../lib/center'
import { rs, litres, relative } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import EmptyState from '../../components/EmptyState'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'

export default function Farmers() {
  const [params, setParams] = useSearchParams()
  const { data, error, loading, reload } = useLoad(farmersWithStats)
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('milk')
  const [editing, setEditing] = useState(params.get('add') ? {} : null)

  const all = data ?? []
  const list = all
    .filter((f) => `${f.full_name} ${f.village ?? ''} ${f.phone ?? ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => sort === 'milk' ? b.stats.litres_30d - a.stats.litres_30d
      : sort === 'owed' ? b.stats.unpaid_amount - a.stats.unpaid_amount : a.full_name.localeCompare(b.full_name))
  const top = Math.max(1, ...all.map((f) => Number(f.stats.litres_30d)))
  const owed = all.reduce((n, f) => n + Number(f.stats.unpaid_amount || 0), 0)
  const litres30 = all.reduce((n, f) => n + Number(f.stats.litres_30d || 0), 0)

  const close = () => { setEditing(null); if (params.get('add')) setParams({}) }

  return (
    <>
      <PageHeader title="Farmers" description="The farmers who bring milk to your center, how much they supply and what you owe them.">
        <button className="btn-primary" onClick={() => setEditing({})}><Icon name="plus" size={17} />Add farmer</button>
      </PageHeader>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Active farmers" value={all.filter((f) => f.is_active).length} />
        <Stat label="Milk in 30 days" value={litres(Math.round(litres30))} />
        <div className="col-span-2 sm:col-span-1"><Stat label="You owe" value={rs(Math.round(owed))} tone="haldi" /></div>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="relative w-full sm:w-72">
          <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input className="input w-full pl-10" placeholder="Search farmers" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <Segmented size="sm" value={sort} onChange={setSort} options={[{ value: 'milk', label: 'Most milk' }, { value: 'owed', label: 'Most owed' }, { value: 'name', label: 'A to Z' }]} />
      </div>
      <Alert>{error}</Alert>

      {loading && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="skeleton h-[170px] rounded-[20px]" />)}</div>}
      {!loading && all.length === 0 && (
        <div className="panel"><EmptyState title="No farmers yet" action={<button className="btn-primary btn-sm" onClick={() => setEditing({})}>Add farmer</button>}>Add the farmers who sell milk to you. Then you can record their milk.</EmptyState></div>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {list.map((f) => {
          const s = f.stats
          const premium = s.tests_30d ? Math.round((s.premium_30d / s.tests_30d) * 100) : 0
          return (
            <Link key={f.id} to={`/manager/farmers/${f.id}`}
              className={`panel group block p-5 transition-all hover:-translate-y-0.5 hover:border-forest/40 ${f.is_active ? '' : 'opacity-60'}`}>
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-forest text-[14px] font-bold text-cream">
                  {f.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold group-hover:text-forest">{f.full_name}{f.link_request && <span className="ml-2 rounded-full bg-haldi-soft px-2 py-0.5 text-[11px] font-semibold text-amber">wants to link app</span>}</p>
                  <p className="truncate text-[13px] text-muted">{milkLabel[f.milk_type]} milk · {f.village ?? 'No village'}{f.is_active ? '' : ' · inactive'}</p>
                </div>
                {Number(s.unpaid_amount) > 0 && <span className="num shrink-0 rounded-full bg-haldi-soft px-2.5 py-1 text-[12px] font-semibold text-amber">{rs(Math.round(s.unpaid_amount))}</span>}
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-[12.5px] text-muted"><span>Last 30 days</span><span className="num font-semibold text-ink">{litres(Math.round(s.litres_30d))}</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-cream-2"><div className="h-2 rounded-full bg-forest-2" style={{ width: `${(Number(s.litres_30d) / top) * 100}%` }} /></div>
              </div>
              <div className="mt-3 flex items-center justify-between text-[12.5px] text-muted">
                <span>{premium}% premium{Number(s.failed_30d) ? ` · ${s.failed_30d} failed` : ''}</span>
                <span>{s.last_collected_at ? relative(s.last_collected_at) : 'No milk yet'}</span>
              </div>
            </Link>
          )
        })}
      </div>

      <FarmerForm key={editing ? editing.id ?? 'new' : 'closed'} farmer={editing} onClose={close} onSaved={reload} />
    </>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 ${tone === 'haldi' ? 'border-[#efd59a] bg-haldi-soft' : 'border-line bg-surface'}`}>
      <p className="text-[12.5px] text-muted">{label}</p>
      <p className="display num mt-0.5 truncate text-[20px] sm:text-[24px]">{value}</p>
    </div>
  )
}

export function FarmerForm({ farmer, onClose, onSaved }) {
  const { toast } = useUi()
  // the parent remounts this form (key) for each farmer, so initial state is enough
  const [f, setF] = useState(() => ({ milk_type: 'buffalo', cattle_count: 3, is_active: true, ...farmer }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    if (!f.full_name?.trim()) return setErr('Enter the farmer’s name.')
    setBusy(true); setErr('')
    try { await saveFarmer(f); toast(f.id ? 'Farmer updated.' : `${f.full_name} added.`); onSaved?.(); onClose() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <Sheet open={farmer !== null} onClose={onClose} title={farmer?.id ? 'Edit farmer' : 'Add a farmer'} subtitle="They can link the ApnaDairy app later with the same phone number."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="farmer-form" disabled={busy}>{busy ? 'Saving…' : 'Save farmer'}</button></>}>
      <form id="farmer-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="fn">Full name</label><input id="fn" className="input" value={f.full_name ?? ''} onChange={set('full_name')} autoFocus /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="field"><label htmlFor="fp">Phone</label><input id="fp" className="input" inputMode="tel" placeholder="03xx xxxxxxx" value={f.phone ?? ''} onChange={set('phone')} /></div>
          <div className="field"><label htmlFor="fv">Village</label><input id="fv" className="input" value={f.village ?? ''} onChange={set('village')} /></div>
        </div>
        <div className="field">
          <span className="label">Milk they bring</span>
          <Segmented value={f.milk_type} onChange={(v) => setF({ ...f, milk_type: v })} options={[{ value: 'buffalo', label: 'Buffalo' }, { value: 'cow', label: 'Cow' }, { value: 'mixed', label: 'Mixed' }]} />
        </div>
        <div className="field"><label htmlFor="fc">Number of animals</label><input id="fc" className="input w-32" type="number" min="0" value={f.cattle_count ?? ''} onChange={set('cattle_count')} /></div>
        {f.id && (
          <label className="flex items-center gap-3 rounded-2xl bg-cream px-4 py-3 text-[14px]">
            <input type="checkbox" className="h-5 w-5 accent-[#1f4d36]" checked={!!f.is_active} onChange={set('is_active')} />
            Active. Untick if this farmer no longer sells to you.
          </label>
        )}
      </form>
    </Sheet>
  )
}
