import { useEffect, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import { myCenter, settings, saveSettings, priceHistory, assessMilk, milkLabel, gradeLabel, riskLabel, PARAMS, inRange } from '../../lib/center'
import { rs } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'

const TYPES = ['buffalo', 'cow', 'mixed']
const RANGES = { ph: [6.2, 7.1, 0.01], density: [1.022, 1.038, 0.0005], ec_ms: [3.5, 7.5, 0.05], temperature_c: [4, 42, 0.5] }

export default function AiPricing() {
  const { profile } = useAuth()
  const { toast } = useUi()
  const { data, error, reload } = useLoad(async () => {
    const [center, s, hist] = await Promise.all([myCenter(profile.id), settings(), priceHistory(30)])
    return { center, settings: s, hist }
  }, [profile.id])
  const [rates, setRates] = useState(null)
  const [saving, setSaving] = useState(false)
  const [type, setType] = useState('buffalo')
  const [r, setR] = useState({ ph: 6.7, density: 1.031, ec_ms: 4.4, temperature_c: 34 })
  const [ai, setAi] = useState(null)

  const s = data?.settings ?? { cow_rate: 170, buffalo_rate: 200, mixed_rate: 185 }
  const form = rates ?? { cow_rate: s.cow_rate, buffalo_rate: s.buffalo_rate, mixed_rate: s.mixed_rate }
  const dirty = rates && TYPES.some((t) => Number(rates[`${t}_rate`]) !== Number(s[`${t}_rate`]))

  // live result while the sliders move
  useEffect(() => {
    let live = true
    const t = setTimeout(() => assessMilk(type, r).then((x) => live && setAi(x)).catch(() => {}), 180)
    return () => { live = false; clearTimeout(t) }
  }, [type, r, data?.settings])

  const save = async () => {
    if (TYPES.some((t) => !(Number(form[`${t}_rate`]) > 0))) return toast('Every rate must be more than zero.', 'error')
    setSaving(true)
    try { await saveSettings(data.center.id, form); toast('Base rates saved. New offers use them.'); setRates(null); await reload() } catch (e) { toast(e.message, 'error') }
    setSaving(false)
  }

  const hist = data?.hist ?? []
  const offers = hist.filter((h) => h.price_per_l != null)
  const atAi = offers.filter((h) => Number(h.price_per_l) === Number(h.ai_price_per_l)).length
  const answered = offers.filter((h) => h.status !== 'offered')
  const acceptedOffers = answered.filter((h) => h.status === 'accepted').length
  const caught = hist.filter((h) => h.reject_reason === 'Failed the quality test').length

  return (
    <>
      <PageHeader title="AI price engine" description="How ApnaDairy turns a milk test into a fair price for the farmer. Set your base rates, then see how quality changes the offer." />
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Offers at the AI price" value={data ? `${offers.length ? Math.round((atAi / offers.length) * 100) : 0}%` : null} note={`${atAi} of ${offers.length} offers, 30 days`} />
        <Kpi label="Farmers accepted" value={data ? `${answered.length ? Math.round((acceptedOffers / answered.length) * 100) : 0}%` : null} note="of offers they answered" />
        <Kpi label="Bad milk caught" value={data ? caught : null} note="samples the model rejected" />
        <Kpi label="Model" value="Sample v1" note="rule-based until the trained model is connected" />
      </div>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card title="Your base rates" subtitle="What you pay per litre for normal, good milk">
          <div className="grid gap-3">
            {TYPES.map((t) => (
              <label key={t} className="flex items-center justify-between gap-4 rounded-2xl bg-cream px-4 py-3">
                <span className="font-semibold">{milkLabel[t]} milk</span>
                <span className="flex items-center gap-2"><span className="text-muted">Rs</span>
                  <input className="input num h-11 w-28 text-right text-[17px] font-bold" type="number" min="1" value={form[`${t}_rate`]}
                    onChange={(e) => setRates({ ...form, [`${t}_rate`]: e.target.value })} aria-label={`${milkLabel[t]} rate`} /></span>
              </label>
            ))}
          </div>
          <button className="btn-primary mt-4 w-full" disabled={!dirty || saving} onClick={save}>{saving ? 'Saving…' : 'Save rates'}</button>

          <h3 className="mt-7 text-[14px] font-semibold">How the offer is worked out</h3>
          <ol className="mt-3 grid gap-2 text-[13.5px]">
            {[
              ['1', 'Start from your base rate', 'for that milk type'],
              ['2', 'Adjust for the grade', 'Premium +6%, Fresh no change, Standard −8%'],
              ['3', 'Adjust for risk', 'Medium adulteration risk −5%'],
              ['4', 'Stop bad milk', 'High risk or sour milk gets no offer'],
            ].map(([n, t, d]) => (
              <li key={n} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-forest text-[12px] font-bold text-cream">{n}</span>
                <span><b>{t}</b><span className="block text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Try it" subtitle="Move the readings and watch the assessment change"
          action={<Segmented size="sm" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: milkLabel[t] }))} />}>
          <div className="grid gap-4">
            {PARAMS.map((p) => {
              const [min, max, step] = RANGES[p.key]
              const v = r[p.key]
              return (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor={`s-${p.key}`} className="text-[14px] font-semibold">{p.label}</label>
                    <span className={`num font-bold ${inRange(p, v) ? '' : 'text-danger'}`}>{Number(v).toFixed(p.digits)} <span className="text-[12px] font-medium text-muted">{p.unit}</span></span>
                  </div>
                  <input id={`s-${p.key}`} type="range" min={min} max={max} step={step} value={v} onChange={(e) => setR({ ...r, [p.key]: Number(e.target.value) })}
                    className="mt-2 w-full accent-[#1f4d36]" />
                </div>
              )
            })}
          </div>
          {ai && (
            <div className={`mt-5 rounded-[20px] p-5 ${ai.accept ? 'bg-forest-deep text-cream' : 'bg-[#f8e2dc] text-danger'}`}>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <p className={`text-[12.5px] ${ai.accept ? 'text-cream/70' : ''}`}>{ai.accept ? 'Suggested offer' : 'Result'}</p>
                  <p className="display num text-[34px]">{ai.accept ? `${rs(ai.price_per_l)} / L` : 'Do not buy'}</p>
                </div>
                <div className="flex gap-2 text-[12.5px]">
                  {ai.accept && <span className="rounded-full bg-cream/15 px-3 py-1 font-semibold">{gradeLabel[ai.quality]}</span>}
                  <span className={`rounded-full px-3 py-1 font-semibold ${ai.accept ? 'bg-cream/15' : 'bg-white/60'}`}>Risk {riskLabel[ai.adulteration_risk].toLowerCase()}</span>
                  <span className={`rounded-full px-3 py-1 font-semibold ${ai.accept ? 'bg-cream/15' : 'bg-white/60'}`}>{ai.freshness_hours} h shelf life</span>
                </div>
              </div>
              <ul className="mt-3 grid gap-1 text-[13.5px]">
                {ai.notes.map((n) => <li key={n} className="flex items-start gap-2"><Icon name={n.startsWith('All') ? 'check' : 'alert'} size={15} className="mt-0.5 shrink-0" />{n}</li>)}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
