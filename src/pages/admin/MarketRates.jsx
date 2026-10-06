import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import { marketRates, saveMarketRate, deleteMarketCity, centerCities, cityLabel, milkLabel } from '../../lib/center'
import { rs, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import { cityError } from '../../lib/validate'

const TYPES = ['buffalo', 'cow', 'mixed']

// the market rate the ai prices from. centers cannot change it, so farmers everywhere
// are paid against a rate set by apnadairy, never by the shop buying their milk.
export default function MarketRates() {
  const { toast, confirm } = useUi()
  const { data, error, reload } = useLoad(async () => {
    const [rates, cities] = await Promise.all([marketRates(), centerCities()])
    return { rates, cities: [...new Set(cities.map((c) => c.city.trim().toLowerCase()))].sort() }
  })
  const [edits, setEdits] = useState({})
  const [newCity, setNewCity] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = {}
  for (const r of data?.rates ?? []) (rows[r.city] ??= {})[r.milk_type] = r
  const cities = Object.keys(rows).sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)))
  const uncovered = (data?.cities ?? []).filter((c) => !rows[c])
  const val = (city, t) => edits[`${city}|${t}`] ?? rows[city]?.[t]?.rate ?? ''
  const dirty = Object.keys(edits).length > 0

  const save = async () => {
    for (const v of Object.values(edits)) if (!(Number(v) > 0) || Number(v) > 2000) return toast('Every rate must be between Rs 1 and Rs 2,000 a litre.', 'error')
    setBusy(true)
    try {
      for (const [k, v] of Object.entries(edits)) { const [city, t] = k.split('|'); await saveMarketRate(city, t, v) }
      toast('Market rates saved. New milk tests use them straight away.'); setEdits({}); await reload()
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const addCity = async (name) => {
    const city = (name ?? newCity).trim().toLowerCase()
    if (!city || city === '*') return
    if (cityError(city)) return toast(cityError(city), 'error')
    if (rows[city]) return toast(`${cityLabel(city)} already has rates.`, 'error')
    setBusy(true)
    try {
      // start from the national rates, then the admin adjusts
      for (const t of TYPES) await saveMarketRate(city, t, rows['*']?.[t]?.rate ?? 180)
      toast(`${cityLabel(city)} added with the national rates. Adjust them below.`); setNewCity(''); await reload()
    } catch (e) { toast(e.message, 'error') }
    setBusy(false)
  }
  const remove = async (city) => {
    if (!(await confirm({ title: `Remove ${cityLabel(city)} rates?`, body: 'Centers in this city go back to the national rates.', confirmLabel: 'Remove', danger: true }))) return
    try { await deleteMarketCity(city); toast('Removed.'); await reload() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Market rates" description="The fair price per litre for normal, good milk. The AI adjusts it for each sample's quality, and farmers are paid at least the set share of it. Shops cannot change these rates.">
        <button className="btn-primary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save rates'}</button>
      </PageHeader>
      <Alert>{error}</Alert>

      <Card bodyClass="p-0">
        <div className="overflow-x-auto">
          <table className="table min-w-[640px]">
            <thead><tr><th>City</th>{TYPES.map((t) => <th key={t} className="text-right">{milkLabel[t]} (Rs / L)</th>)}<th>Updated</th><th></th></tr></thead>
            <tbody>
              {cities.map((city) => (
                <tr key={city}>
                  <td><p className="font-semibold">{cityLabel(city)}</p>{city === '*' && <p className="text-[12.5px] text-muted">used where no city rate is set</p>}</td>
                  {TYPES.map((t) => (
                    <td key={t} className="text-right">
                      <input className={`input num h-10 w-24 text-right font-semibold ${edits[`${city}|${t}`] != null ? 'border-forest' : ''}`} type="number" inputMode="decimal" min="1"
                        value={val(city, t)} onChange={(e) => setEdits({ ...edits, [`${city}|${t}`]: e.target.value })} aria-label={`${cityLabel(city)} ${t}`} />
                    </td>
                  ))}
                  <td className="text-[13px] text-muted">{date(Object.values(rows[city]).map((r) => r.updated_at).sort().pop())}</td>
                  <td className="text-right">{city !== '*' && <button className="btn-ghost btn-sm text-danger" onClick={() => remove(city)}>Remove</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <Card title="Add a city" subtitle="Give a city its own rates when milk prices there differ from the national rate.">
          <div className="flex gap-2">
            <input className="input flex-1" maxLength={40} placeholder="e.g. Karachi" value={newCity} onChange={(e) => setNewCity(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCity()} />
            <button className="btn-secondary" onClick={() => addCity()} disabled={busy || !newCity.trim()}><Icon name="plus" size={16} />Add</button>
          </div>
          {uncovered.length > 0 && (
            <div className="mt-4">
              <p className="text-[13px] text-muted">Cities with centers but no own rate yet:</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {uncovered.map((c) => <button key={c} className="rounded-full bg-cream-2 px-3 py-1 text-[13px] font-semibold hover:bg-mint-soft hover:text-forest" onClick={() => addCity(c)}>+ {cityLabel(c)}</button>)}
              </div>
            </div>
          )}
        </Card>
        <Card title="How the price is worked out" subtitle="For every milk test">
          <ol className="grid gap-2 text-[13.5px]">
            {[['Market rate', 'from this table, for the center’s city'], ['Grade', 'from AI Model 1: Good +6%, Acceptable as is, Poor −8%'], ['Farmer offer', 'the suggested share of the market rate, never below the minimum (see Billing, platform rules)']].map(([t, d], i) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-forest text-[12px] font-bold text-cream">{i + 1}</span>
                <span><b>{t}</b><span className="block text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <p className="mt-3 text-[12.5px] text-muted">Example: buffalo milk at {rs(rows['*']?.buffalo?.rate ?? 200)} graded Good is priced at {rs(Math.round((rows['*']?.buffalo?.rate ?? 200) * 1.06))} a litre.</p>
        </Card>
      </div>
    </>
  )
}
