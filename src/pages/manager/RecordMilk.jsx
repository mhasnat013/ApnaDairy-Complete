import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useUi } from '../../context/UiContext'
import {
  farmersWithStats, settings, assessMilk, recordCollection, decideCollection, simulateReading, currentShift, billingOverview, milkListings, createListing,
  milkLabel, gradeLabel, riskLabel, PARAMS, inRange,
} from '../../lib/center'
import { rs, litres } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Icon from '../../components/Icon'
import Alert from '../../components/Alert'
import { RangeBar } from '../../components/charts'

const STEPS = ['Farmer and quantity', 'Test the milk', 'Price and offer']

export default function RecordMilk() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { toast } = useUi()
  const { data } = useLoad(async () => {
    const [farmers, s, billing, listings] = await Promise.all([farmersWithStats(), settings(), billingOverview().catch(() => null), milkListings().catch(() => [])])
    return { farmers: farmers.filter((f) => f.is_active), settings: s, billing, listings }
  })
  const [step, setStep] = useState(0)
  const [q, setQ] = useState('')
  const [farmerId, setFarmerId] = useState(params.get('farmer') ?? '')
  const [quantity, setQuantity] = useState('')
  const [shift, setShift] = useState(currentShift())
  const [reading, setReading] = useState(null)
  const [source, setSource] = useState('simulated')
  const [scanning, setScanning] = useState(false)
  const [manual, setManual] = useState(false)
  const [ai, setAi] = useState(null)
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(null)
  const [err, setErr] = useState('')

  const farmer = data?.farmers.find((f) => f.id === farmerId)
  const deviceOff = data?.billing && !data.billing.device_active
  const overdue = data?.billing && !data.billing.billing_ok
  const list = useMemo(() => (data?.farmers ?? []).filter((f) => `${f.full_name} ${f.village ?? ''}`.toLowerCase().includes(q.toLowerCase())), [data, q])
  const qty = Number(quantity)

  // the "device" takes a couple of seconds to read, like the real sensor will
  const scan = () => {
    setScanning(true); setAi(null); setManual(false)
    setTimeout(() => { setReading(simulateReading(farmer?.milk_type)); setSource('simulated'); setScanning(false) }, 2200)
  }

  useEffect(() => {
    if (!reading || !farmer) return
    let live = true
    assessMilk(farmer.milk_type, reading).then((r) => { if (live) { setAi(r); setPrice(r.offer_price ?? '') } }).catch((e) => setErr(e.message))
    return () => { live = false }
  }, [reading, farmer])

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const id = await recordCollection({ farmer: farmerId, quantity: qty, shift, reading: { ...reading, reading_at: reading.reading_at ?? new Date().toISOString() }, source, price: ai?.accept ? Number(price) : null })
      setDone({ id, accepted: ai?.accept })
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }
  const listing = data?.listings?.find((l) => l.milk_type === farmer?.milk_type)
  const farmerSays = async (yes) => {
    try {
      await decideCollection(done.id, yes)
      if (!yes) { toast('Recorded as refused.'); return nav('/manager/collection') }
      toast(listing?.is_available ? `${litres(qty)} added to stock and to your ${milkLabel[farmer.milk_type].toLowerCase()} milk listing on the app.` : `${litres(qty)} added to stock.`)
      setDone({ ...done, answered: true })
    } catch (e) { toast(e.message, 'error') }
  }
  const listNow = async () => {
    try {
      if (listing) { nav('/manager/shop'); return }
      // start at the suggested markup over what was just paid
      const listPrice = Math.round(Number(price) * 1.2) || ({ cow: 205, buffalo: 240, mixed: 210 })[farmer.milk_type]
      await createListing(farmer.milk_type, listPrice)
      toast(`${milkLabel[farmer.milk_type]} milk is on the app at ${rs(listPrice)} a litre.`)
      nav('/manager/shop')
    } catch (e) { toast(e.message, 'error') }
  }
  const again = () => { setStep(0); setFarmerId(''); setQuantity(''); setReading(null); setAi(null); setPrice(''); setDone(null); setQ('') }

  if (done) {
    return (
      <div className="mx-auto max-w-[560px] pt-6">
        <div className="panel animate-pop p-7 text-center">
          <span className={`mx-auto grid h-16 w-16 place-items-center rounded-full ${done.accepted ? 'bg-mint-soft text-forest' : 'bg-[#f8e2dc] text-danger'}`}>
            <Icon name={done.accepted ? 'check' : 'x'} size={30} />
          </span>
          <h1 className="display mt-4 text-[28px] text-forest-deep">{done.accepted ? 'Offer sent to the farmer' : 'Recorded as not bought'}</h1>
          <p className="mt-2 text-muted">
            {done.accepted
              ? <>{farmer.full_name} sees {litres(qty)} at {rs(price)} per litre ({rs(Math.round(qty * price))}) in the ApnaDairy app and can accept or refuse it. If they answer at the counter, record it here.</>
              : <>The milk failed the quality test, so it was not added to stock. {farmer.full_name} can see the test result in the app.</>}
          </p>
          {done.accepted && !done.answered && (
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <button className="btn-primary" onClick={() => farmerSays(true)}><Icon name="check" size={17} />Farmer accepted</button>
              <button className="btn-secondary" onClick={() => farmerSays(false)}>Farmer refused</button>
            </div>
          )}
          {done.answered && (
            <div className="mt-6 rounded-2xl bg-mint-soft px-4 py-4 text-left text-[14px] text-forest">
              {listing?.is_available ? (
                <p><b>{litres(qty)} is now in stock</b> and shows in your {milkLabel[farmer.milk_type].toLowerCase()} milk listing on the customer app.</p>
              ) : (
                <>
                  <p><b>{litres(qty)} is now in stock.</b> {listing ? `Your ${milkLabel[farmer.milk_type].toLowerCase()} milk listing is hidden from the app.` : `List ${milkLabel[farmer.milk_type].toLowerCase()} milk so customers can order it in the app.`}</p>
                  <button className="btn-primary btn-sm mt-3" onClick={listNow}><Icon name="store" size={15} />{listing ? 'Open my shop' : 'List it on the app'}</button>
                </>
              )}
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-ghost" onClick={again}>Record next farmer</button>
            <Link to="/manager/collection" className="btn-ghost">Back to collection</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <PageHeader title="Record milk" description="Pick the farmer, test the milk with the IoT device, then offer the price the AI suggests or your own." back={{ to: '/manager/collection', label: 'Milk collection' }} />

      <ol className="mb-6 grid grid-cols-3 gap-2">
        {STEPS.map((s, i) => (
          <li key={s} className={`flex items-center gap-2 rounded-2xl px-3 py-2.5 text-[13px] font-semibold transition-colors sm:text-[14px] ${i === step ? 'bg-forest text-cream' : i < step ? 'bg-mint-soft text-forest' : 'bg-cream-2 text-muted'}`}>
            <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] ${i === step ? 'bg-haldi text-forest-deep' : i < step ? 'bg-forest text-cream' : 'bg-cream text-muted'}`}>{i < step ? '✓' : i + 1}</span>
            <span className="hidden sm:inline">{s}</span>
          </li>
        ))}
      </ol>
      <Alert>{err}</Alert>
      {overdue && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[14px] text-danger">
          <span className="flex items-center gap-2 font-semibold"><Icon name="alert" size={16} />Your ApnaDairy bill is overdue, so recording milk is paused.</span>
          <Link to="/manager/billing" className="btn-danger btn-sm">Pay now</Link>
        </div>
      )}

      {step === 0 && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <section className="panel p-5 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="display text-[19px] text-forest-deep">Who brought the milk?</h2>
              <Link to="/manager/farmers?add=1" className="text-[13.5px] font-semibold text-forest hover:underline">New farmer</Link>
            </div>
            <label className="relative mt-4 block">
              <Icon name="search" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input className="input w-full pl-10" placeholder="Search by name or village" value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
            <div className="mt-4 grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
              {list.map((f) => (
                <button key={f.id} type="button" onClick={() => setFarmerId(f.id)}
                  className={`flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all ${farmerId === f.id ? 'border-forest bg-mint-soft ring-2 ring-forest/15' : 'border-line bg-white hover:border-forest/40'}`}>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold ${farmerId === f.id ? 'bg-forest text-cream' : 'bg-cream-2 text-forest'}`}>
                    {f.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{f.full_name}</span>
                    <span className="block truncate text-[12.5px] text-muted">{milkLabel[f.milk_type]} milk · {f.village ?? 'No village'}</span>
                  </span>
                </button>
              ))}
              {data && list.length === 0 && <p className="col-span-full py-6 text-center text-muted">No farmer found. Add them first.</p>}
            </div>
          </section>

          <section className="panel flex flex-col p-5 sm:p-6">
            <h2 className="display text-[19px] text-forest-deep">How much milk?</h2>
            <div className="mt-4 flex items-end gap-2">
              <input className="input num h-16 w-full text-[30px] font-bold" type="number" min="0.5" step="0.5" inputMode="decimal" placeholder="0"
                value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Litres" />
              <span className="pb-4 text-[18px] font-semibold text-muted">litres</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {[5, 10, 15, 20].map((n) => <button key={n} type="button" className="btn-secondary btn-sm" onClick={() => setQuantity(String(n))}>{n} L</button>)}
            </div>
            <p className="mt-6 text-[13px] font-semibold">Shift</p>
            <div className="mt-2"><Segmented value={shift} onChange={setShift} options={[{ value: 'morning', label: 'Morning' }, { value: 'evening', label: 'Evening' }]} /></div>
            <div className="mt-auto pt-6">
              <button className="btn-primary w-full" disabled={!farmer || !(qty > 0) || qty > 2000} onClick={() => setStep(1)}>
                Next: test the milk <Icon name="arrow" size={17} />
              </button>
            </div>
          </section>
        </div>
      )}

      {step === 1 && farmer && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <section className="furrows relative overflow-hidden rounded-[24px] bg-forest-deep p-6 text-cream">
            <div className="flex items-center justify-between">
              <p className="text-[13px] text-cream/70">IoT milk tester</p>
              <span className="flex items-center gap-1.5 rounded-full bg-cream/10 px-3 py-1 text-[12px] font-semibold"><span className="h-2 w-2 rounded-full bg-[#7fd39b]" />{data.settings?.device_serial ?? 'AD-IOT-0001'} · simulated</span>
            </div>
            <p className="display mt-6 text-[26px]">{farmer.full_name}</p>
            <p className="text-cream/70">{litres(qty)} of {milkLabel[farmer.milk_type].toLowerCase()} milk · {shift}</p>
            <div className="relative mx-auto mt-8 grid h-40 w-40 place-items-center">
              <span className={`absolute inset-0 rounded-full border-2 border-cream/15 ${scanning ? 'animate-ping' : ''}`} />
              <span className={`absolute inset-3 rounded-full border-2 border-haldi/40 ${scanning ? 'animate-spin border-t-haldi' : ''}`} />
              <span className="grid h-24 w-24 place-items-center rounded-full bg-cream/10 text-haldi"><Icon name={reading && !scanning ? 'check' : 'chip'} size={40} /></span>
            </div>
            <p className="mt-6 text-center text-[14px] text-cream/80">{scanning ? 'Reading the sample…' : reading ? `Read at ${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Dip the probe in the sample, then take a reading.'}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button className="btn-haldi" onClick={scan} disabled={scanning || deviceOff}>{reading ? 'Read again' : 'Take reading'}</button>
              <button className="btn-on-dark" onClick={() => { setManual(true); setSource('manual'); setReading(reading ?? { temperature_c: 34, ph: 6.7, ec_ms: 4.5, tds_ppm: 2250, reading_at: new Date().toISOString() }) }}>Enter by hand</button>
            </div>
            {deviceOff && (
              <p className="mt-4 rounded-2xl bg-cream/10 px-4 py-3 text-center text-[13px] text-cream/80">
                Your device activates once its invoice is paid. <Link to="/manager/billing" className="font-semibold text-haldi underline">Go to billing</Link>. You can enter readings by hand meanwhile.
              </p>
            )}
            <ul className="mt-5 flex flex-wrap justify-center gap-1.5 text-[11.5px] text-cream/60">
              {PARAMS.map((p) => <li key={p.key} className="rounded-full bg-cream/5 px-2.5 py-1">{p.sensor}</li>)}
            </ul>
          </section>

          <section className="panel p-5 sm:p-6">
            <h2 className="display text-[19px] text-forest-deep">Readings</h2>
            {!reading && !scanning && <p className="mt-3 text-muted">The four sensor values appear here with their normal range.</p>}
            {scanning && <div className="mt-4 grid gap-4">{PARAMS.map((p) => <div key={p.key} className="skeleton h-14" />)}</div>}
            {reading && !scanning && (
              <div className="mt-4 grid gap-4">
                {PARAMS.map((p) => (
                  <div key={p.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-semibold">{p.label}</span>
                      {manual ? (
                        <input className="input num h-9 w-28 text-right" type="number" step={{ ph: 0.01, ec_ms: 0.05, tds_ppm: 10, temperature_c: 0.1 }[p.key]} value={reading[p.key]}
                          onChange={(e) => setReading({ ...reading, [p.key]: Number(e.target.value) })} aria-label={p.label} />
                      ) : (
                        <span className={`num text-[18px] font-bold ${inRange(p, reading[p.key]) ? 'text-ink' : 'text-danger'}`}>{Number(reading[p.key]).toFixed(p.digits)} <span className="text-[12px] font-medium text-muted">{p.unit}</span></span>
                      )}
                    </div>
                    <RangeBar param={p} value={Number(reading[p.key])} />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-between gap-2">
              <button className="btn-ghost" onClick={() => setStep(0)}>Back</button>
              <button className="btn-primary" disabled={!reading || scanning || !ai} onClick={() => setStep(2)}>See AI result <Icon name="arrow" size={17} /></button>
            </div>
          </section>
        </div>
      )}

      {step === 2 && ai && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section className={`panel p-5 sm:p-6 ${ai.accept ? '' : 'border-[#efc6bb]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-muted"><Icon name="spark" size={16} />AI assessment</p>
              <span className="rounded-full bg-cream-2 px-2.5 py-0.5 text-[11.5px] text-muted">sample models</span>
            </div>
            <h2 className={`display mt-3 text-[30px] ${ai.accept ? 'text-forest-deep' : 'text-danger'}`}>{ai.accept ? `${gradeLabel[ai.quality]} milk` : 'Do not buy this milk'}</h2>
            <p className="mt-1 text-[14px] text-muted">Quality score {ai.score}/100</p>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <ModelCard title="Model 1 · Freshness" inputs="temperature, time, pH, EC" bad={ai.spoilage_risk === 'high'} warn={ai.spoilage_risk === 'medium'}
                facts={[['Shelf life', `${ai.freshness_hours} h`, 'once chilled'], ['Spoilage risk', riskLabel[ai.spoilage_risk]]]} />
              <ModelCard title="Model 2 · Adulteration" inputs="temperature, pH, EC, TDS" bad={ai.adulteration_risk === 'high'} warn={ai.adulteration_risk === 'medium'}
                facts={[['Risk', riskLabel[ai.adulteration_risk], `${ai.adulteration_score}% probability`], ['Likely additive', ai.suspected ? ai.suspected.charAt(0).toUpperCase() + ai.suspected.slice(1) : 'None']]} />
            </div>
            <ul className="mt-4 grid gap-2">
              {ai.notes.map((n) => (
                <li key={n} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[14px] ${n.startsWith('All') ? 'bg-mint-soft text-forest' : 'bg-cream text-ink'}`}>
                  <Icon name={n.startsWith('All') ? 'check' : 'alert'} size={16} className="mt-0.5 shrink-0" />{n}
                </li>
              ))}
            </ul>
          </section>

          <section className="panel flex flex-col p-5 sm:p-6">
            {ai.accept ? (
              <>
                <h2 className="display text-[19px] text-forest-deep">Offer to {farmer.full_name.split(' ')[0]}</h2>
                <div className="mt-4 flex items-center justify-between gap-3 rounded-2xl bg-cream px-4 py-3">
                  <div><p className="text-[12.5px] text-muted">Market rate from the AI</p><p className="display num text-[22px]">{rs(ai.market_price)}<span className="text-[13px] font-medium text-muted"> / L</span></p></div>
                  <p className="max-w-[160px] text-right text-[12px] text-muted">{gradeLabel[ai.quality]} grade, on the ApnaDairy {milkLabel[farmer.milk_type].toLowerCase()} milk rate of {rs(ai.base_rate)}</p>
                </div>
                <label className="mt-5 block text-[13px] font-semibold" htmlFor="price">Price you pay per litre</label>
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-[18px] font-semibold text-muted">Rs</span>
                  <input id="price" className={`input num h-14 w-full text-[26px] font-bold ${Number(price) < ai.min_price ? 'border-danger' : ''}`} type="number" min={ai.min_price} value={price} onChange={(e) => setPrice(e.target.value)} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[[Number(ai.farmer_min_pct), ai.min_price], [Number(ai.farmer_default_pct), ai.offer_price], [100, ai.market_price]].map(([pct, v]) => (
                    <button key={pct} type="button" onClick={() => setPrice(v)}
                      className={`rounded-full px-3 py-1 text-[12.5px] font-semibold transition-colors ${Number(price) === Number(v) ? 'bg-forest text-cream' : 'bg-cream-2 text-muted hover:text-ink'}`}>{pct}% · {rs(v)}</button>
                  ))}
                </div>
                <p className={`mt-2 text-[12.5px] ${Number(price) < ai.min_price ? 'font-semibold text-danger' : 'text-muted'}`}>
                  Farmers get at least {Number(ai.farmer_min_pct)}% of the market rate ({rs(ai.min_price)}). We suggest {Number(ai.farmer_default_pct)}%.
                </p>
                <div className="mt-4 rounded-2xl bg-cream px-4 py-3">
                  <div className="flex justify-between text-[14px] text-muted"><span>{litres(qty)} × {rs(price || 0)}</span><span>{Math.round((Number(price) / ai.market_price) * 100)}% of market</span></div>
                  <p className="display num mt-1 text-[30px]">{rs(Math.round(qty * (Number(price) || 0)))}</p>
                </div>
                <div className="mt-auto flex justify-between gap-2 pt-6">
                  <button className="btn-ghost" onClick={() => setStep(1)}>Back</button>
                  <button className="btn-primary" disabled={saving || !(Number(price) >= ai.min_price) || overdue} onClick={save}>{saving ? 'Sending…' : 'Send offer'}</button>
                </div>
              </>
            ) : (
              <>
                <h2 className="display text-[19px] text-forest-deep">Return the milk</h2>
                <p className="mt-2 text-muted">The sample failed the test, so it should not go into your stock. We save the test so the farmer can see why.</p>
                <div className="mt-auto flex justify-between gap-2 pt-6">
                  <button className="btn-ghost" onClick={() => setStep(1)}>Test again</button>
                  <button className="btn-danger" disabled={saving || overdue} onClick={save}>{saving ? 'Saving…' : 'Record as not bought'}</button>
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </>
  )
}

// one ai model's result: which sensors it used and what it concluded
function ModelCard({ title, inputs, facts, bad, warn }) {
  return (
    <div className={`rounded-2xl border p-4 ${bad ? 'border-[#efc6bb] bg-[#fbeee9]' : warn ? 'border-[#efd59a] bg-haldi-soft/60' : 'border-line bg-cream'}`}>
      <p className="text-[13px] font-semibold text-forest-deep">{title}</p>
      <p className="text-[11.5px] text-muted">from {inputs}</p>
      <dl className="mt-3 grid grid-cols-2 gap-2">
        {facts.map(([label, value, hint]) => (
          <div key={label}>
            <dt className="text-[12px] text-muted">{label}</dt>
            <dd className={`display num text-[20px] ${bad && /risk/i.test(label) ? 'text-danger' : ''}`}>{value}</dd>
            {hint && <p className="text-[11.5px] text-muted">{hint}</p>}
          </div>
        ))}
      </dl>
    </div>
  )
}
