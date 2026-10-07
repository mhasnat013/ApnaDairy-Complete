import { useEffect, useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { priceHistory, platformSettings, myMarketRates, assessMilk, milkLabel, gradeLabel, riskLabel, PARAMS, inRange } from '../../lib/center'
import { date, plural } from '../../lib/format'
import { rs } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Card, { Kpi } from '../../components/Card'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'

const TYPES = ['buffalo', 'cow', 'mixed']
const RANGES = { temperature_c: [4, 42, 0.5], ph: [6.2, 7.1, 0.01], ec_ms: [2.8, 7.5, 0.05], tds_ppm: [1200, 3800, 10] }

export default function AiPricing() {
  const { data, error } = useLoad(async () => {
    const [rates, hist, platform] = await Promise.all([myMarketRates(), priceHistory(30), platformSettings()])
    return { rates, hist, platform }
  })
  const [type, setType] = useState('buffalo')
  const [r, setR] = useState({ temperature_c: 34.5, ph: 6.7, ec_ms: 4.3, tds_ppm: 2150 })
  const [ai, setAi] = useState(null)

  const rates = data?.rates ?? { cow: 170, buffalo: 200, mixed: 185 }
  const pf = data?.platform ?? { farmer_min_pct: 90, farmer_default_pct: 95, markup_suggest_pct: 20, markup_max_pct: 30 }

  // live result while the sliders move
  useEffect(() => {
    let live = true
    const t = setTimeout(() => assessMilk(type, { ...r, reading_at: new Date().toISOString() }).then((x) => live && setAi(x)).catch(() => {}), 180)
    return () => { live = false; clearTimeout(t) }
  }, [type, r])

  const hist = data?.hist ?? []
  const offers = hist.filter((h) => h.price_per_l != null && h.ai_price_per_l)
  const share = offers.length ? offers.reduce((n, h) => n + h.price_per_l / h.ai_price_per_l, 0) / offers.length : 0
  const answered = offers.filter((h) => h.status !== 'offered')
  const acceptedOffers = answered.filter((h) => h.status === 'accepted').length
  const caught = hist.filter((h) => h.reject_reason === 'Failed the quality test').length

  // the price chain for one litre of the milk being tried
  const market = ai?.market_price ?? Number(rates[type])
  const farmerGets = Math.round(market * pf.farmer_default_pct / 100)
  const sell = Math.round(farmerGets * (100 + Number(pf.markup_suggest_pct)) / 100)
  const sellMax = Math.floor(farmerGets * (100 + Number(pf.markup_max_pct)) / 100)

  return (
    <>
      <PageHeader title="AI price engine" description="How a milk test becomes a fair price: fair for the farmer who sells, the shop that resells and the family that buys." />
      <Alert>{error}</Alert>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <Kpi accent label="Farmers’ share of market rate" value={data ? `${Math.round(share * 100)}%` : null} note={`average over ${plural(offers.length, 'offers')}, 30 days`} />
        <Kpi label="Farmers accepted" value={data ? `${answered.length ? Math.round((acceptedOffers / answered.length) * 100) : 0}%` : null} note="of offers they answered" />
        <Kpi label="Bad milk caught" value={data ? caught : null} note="samples the models rejected" />
        <Kpi label="Models" value="2" note="quality and freshness" />
      </div>

      <Card className="mt-4 sm:mt-5" title={`One litre of ${milkLabel[type].toLowerCase()} milk`} subtitle="Who gets what, for the sample in Try it below">
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['spark', 'Market rate', rs(market), ai ? `AI price for ${gradeLabel[ai.quality]?.toLowerCase() ?? 'this'} milk` : 'ApnaDairy market rate'],
            ['users', 'Farmer gets', rs(farmerGets), `${Number(pf.farmer_default_pct)}% of market, never below ${Number(pf.farmer_min_pct)}%`],
            ['store', 'You sell at', rs(sell), `+${Number(pf.markup_suggest_pct)}% suggested, at most ${rs(sellMax)} (+${Number(pf.markup_max_pct)}%)`],
            ['wallet', 'You keep', rs(sell - farmerGets), 'all of it, ApnaDairy takes no cut'],
          ].map(([ic, label, value, note], i) => (
            <li key={label} className="relative rounded-2xl bg-cream px-4 py-4">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-forest text-cream"><Icon name={ic} size={16} /></span>
              <p className="mt-3 text-[13px] text-muted">{label}</p>
              <p className="display num text-[26px]">{value}</p>
              <p className="mt-0.5 text-[12.5px] text-muted">{note}</p>
              {i < 3 && <Icon name="arrow" size={18} className="absolute -right-3 top-1/2 hidden -translate-y-1/2 text-forest lg:block" />}
            </li>
          ))}
        </ol>
        <p className="mt-3 text-[12.5px] text-muted">Your margin is before your own costs like the chiller, transport and staff. ApnaDairy only charges the device and the monthly fee.</p>
      </Card>

      <div className="mt-4 grid gap-4 sm:mt-5 sm:gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
        <Card title={`Market rates in ${data?.rates?.city ?? 'your city'}`} subtitle="Set by ApnaDairy for normal, good milk. The AI adjusts them for each sample. Shops cannot change them, so every farmer is paid against the same fair rate.">
          <div className="grid gap-3">
            {TYPES.map((t) => (
              <div key={t} className="flex items-center justify-between gap-4 rounded-2xl bg-cream px-4 py-3">
                <span className="font-semibold">{milkLabel[t]} milk</span>
                <span className="num text-[18px] font-bold">{rs(rates[t])}<span className="text-[12.5px] font-medium text-muted"> / L</span></span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted">
            {data?.rates ? `${data.rates.own_city_rates ? `Rates for ${data.rates.city}` : 'National rates (no city rate set yet)'} · updated ${date(data.rates.updated_at)}` : ' '}
          </p>

          <h3 className="mt-7 text-[14px] font-semibold">How the offer is worked out</h3>
          <ol className="mt-3 grid gap-2 text-[13.5px]">
            {[
              ['Model 1 reads freshness', 'temperature, time, pH and EC give shelf life and spoilage risk'],
              ['Model 2 checks purity', 'temperature, pH, EC and TDS give adulteration risk'],
              ['Grade and market rate', 'Premium +6%, Fresh as is, Standard −8% on your base rate'],
              ['Offer to the farmer', `${Number(pf.farmer_default_pct)}% of market, at least ${Number(pf.farmer_min_pct)}%. Spoiled or adulterated milk gets no offer`],
            ].map(([t, d], i) => (
              <li key={t} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-forest text-[12px] font-bold text-cream">{i + 1}</span>
                <span><b>{t}</b><span className="block text-muted">{d}</span></span>
              </li>
            ))}
          </ol>
        </Card>

        <Card title="Try it" subtitle="Move the sensor values and watch both models respond"
          action={<Segmented size="sm" value={type} onChange={setType} options={TYPES.map((t) => ({ value: t, label: milkLabel[t] }))} />}>
          <div className="grid gap-4">
            {PARAMS.map((p) => {
              const [min, max, step] = RANGES[p.key]
              const v = r[p.key]
              return (
                <div key={p.key}>
                  <div className="flex items-baseline justify-between">
                    <label htmlFor={`s-${p.key}`} className="text-[14px] font-semibold">{p.label} <span className="font-normal text-muted">· {p.sensor}</span></label>
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
                  <p className={`text-[12.5px] ${ai.accept ? 'text-cream/70' : ''}`}>{ai.accept ? `${gradeLabel[ai.quality]} · offer the farmer` : 'Result'}</p>
                  <p className="display num text-[34px]">{ai.accept ? `${rs(ai.offer_price)} / L` : 'Do not buy'}</p>
                  {ai.accept && <p className="text-[12.5px] text-cream/70">market rate {rs(ai.market_price)}</p>}
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <div className={`rounded-2xl px-4 py-3 ${ai.accept ? 'bg-cream/10' : 'bg-white/60'}`}>
                  <p className="text-[12px] font-semibold">Model 1 · Freshness</p>
                  <p className="mt-1 text-[14px]">{ai.freshness_hours} h shelf life · {riskLabel[ai.spoilage_risk].toLowerCase()} spoilage risk</p>
                </div>
                <div className={`rounded-2xl px-4 py-3 ${ai.accept ? 'bg-cream/10' : 'bg-white/60'}`}>
                  <p className="text-[12px] font-semibold">Model 2 · Adulteration</p>
                  <p className="mt-1 text-[14px]">{riskLabel[ai.adulteration_risk]} risk · {ai.adulteration_score}%{ai.suspected ? ` · likely ${ai.suspected}` : ''}</p>
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
