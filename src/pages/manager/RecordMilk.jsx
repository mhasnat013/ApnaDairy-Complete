import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import {
  farmersWithStats, settings, assessMilk, recordCollection, recordFarmerAnswer, collectionById, myCenter, myDevice, startDeviceTest, takeDeviceSample, finishDeviceTest, farmerUsual, OFFER_HOURS, currentShift, billingOverview, milkListings,
  milkLabel, gradeLabel, riskLabel, PARAMS, inRange,
} from '../../lib/center'
import { rs, litres, plural } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Icon from '../../components/Icon'
import Alert from '../../components/Alert'
import { RangeBar } from '../../components/charts'
import Receipt from '../../components/Receipt'

const STEPS = ['Farmer and quantity', 'Test the milk', 'Price and offer']

export default function RecordMilk() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { toast } = useUi()
  const { profile } = useAuth()
  const { data } = useLoad(async () => {
    const [farmers, s, billing, listings, center, device] = await Promise.all([farmersWithStats(), settings(), billingOverview().catch(() => null), milkListings().catch(() => []), myCenter(profile.id).catch(() => null), myDevice().catch(() => null)])
    return { farmers: farmers.filter((f) => f.is_active), settings: s, billing, listings, center, device }
  })
  const [step, setStep] = useState(0)
  const [q, setQ] = useState('')
  const [farmerId, setFarmerId] = useState(params.get('farmer') ?? '')
  const [quantity, setQuantity] = useState('')
  const [shift, setShift] = useState(currentShift())
  const [reading, setReading] = useState(null)
  const scanning = false
  const [receipt, setReceipt] = useState(null)
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
  // the farmer's usual drop-offs first, then common amounts
  const { data: usual } = useLoad(() => (farmerId ? farmerUsual(farmerId).catch(() => []) : Promise.resolve([])), [farmerId])
  const picks = [...(usual ?? []).map((n) => [Number(n), true]), ...[10, 20, 40, 60, 100].map((n) => [n, false])]
    .filter(([n], i, a) => a.findIndex(([m]) => m === n) === i).slice(0, 6)

  const device = data?.device
  const badReading = reading?.status === 'check'
  // the real device: a test runs about a minute. the edge function reads the device every few seconds and
  // stores each sample; at the end the server averages them and only that final reading goes to the ai.
  const [test, setTest] = useState(null)
  const [, setTick] = useState(0)
  const cancelTest = useRef(false)
  useEffect(() => () => { cancelTest.current = true }, [])
  useEffect(() => {
    if (!test) return
    const i = setInterval(() => setTick((n) => n + 1), 250)
    return () => clearInterval(i)
  }, [test])
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const scan = async () => {
    setAi(null); setErr(''); setReading(null)
    cancelTest.current = false
    let t
    try { t = await startDeviceTest() } catch (e) { return setErr(e.message) }
    const started = Date.now(), end = started + t.seconds * 1000, samples = []
    let fails = 0
    setTest({ seconds: t.seconds, every: t.every, started, samples: [] })
    while (Date.now() < end) {
      if (cancelTest.current) { setTest(null); return }
      const t0 = Date.now()
      try { samples.push(await takeDeviceSample(t.session)); fails = 0 } catch (e) {
        if (++fails >= 3) { setTest(null); return setErr(e.message) }
      }
      setTest({ seconds: t.seconds, every: t.every, started, samples: [...samples] })
      await sleep(Math.max(0, Math.min(t.every * 1000 - (Date.now() - t0), end - Date.now())))
    }
    if (cancelTest.current) { setTest(null); return }
    setTest((x) => x && { ...x, finishing: true })
    try {
      const r = await finishDeviceTest(t.session)
      setReading({ id: r.id, temperature_c: r.temperature_c, ph: r.ph, ec_ms: r.ec_ms, tds_ppm: r.tds_ppm, reading_at: r.reading_at,
        status: r.status, problems: r.problems ?? [], notes: r.notes ?? [], used: r.samples_used, total: r.samples_total, seconds: t.seconds })
    } catch (e) { setErr(e.message) }
    setTest(null)
  }
  const testing = !!test
  const left = test ? Math.max(0, Math.ceil((test.started + test.seconds * 1000 - Date.now()) / 1000)) : 0
  const lastGood = test ? [...test.samples].reverse().find((x) => x.valid) : null
  const live = lastGood ? { temperature_c: Number(lastGood.temperature_c), ph: Number(lastGood.ph), tds_ppm: Number(lastGood.tds_ppm), ec_ms: Number(lastGood.tds_ppm) / 640 } : null

  useEffect(() => {
    if (!reading || !farmer || reading.status === 'check') return
    let live = true
    assessMilk(farmer.milk_type, reading).then((r) => { if (live) { setAi(r); setPrice(r.offer_price ?? '') } }).catch((e) => setErr(e.message))
    return () => { live = false }
  }, [reading, farmer])

  const save = async () => {
    setSaving(true); setErr('')
    try {
      const id = await recordCollection({ farmer: farmerId, quantity: qty, shift, reading, source: 'device', price: ai?.accept ? Number(price) : null, readingId: reading.id })
      setDone({ id, accepted: ai?.accept, until: Date.now() + OFFER_HOURS * 36e5 })
    } catch (e) { setErr(e.message) }
    setSaving(false)
  }
  const listing = data?.listings?.find((l) => l.milk_type === farmer?.milk_type)
  // the farmer answers at the counter; the area manager records it
  const farmerSays = async (yes) => {
    try {
      const r = await recordFarmerAnswer(done.id, yes)
      if (r === 'expired') { toast('This offer had expired, so it was closed.', 'error'); return nav('/manager/collection') }
      if (!yes) { toast(`${farmer.full_name} refused the offer.`); return nav('/manager/collection') }
      const row = await collectionById(done.id)
      setDone({ ...done, answered: true, row })
      setReceipt(row)
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
          <h1 className="display mt-4 text-[28px] text-forest-deep">{done.answered ? 'Farmer accepted' : done.accepted ? 'Show the farmer the offer' : 'Recorded as not bought'}</h1>
          <p className="mt-2 text-muted">
            {done.answered
              ? <>{farmer.full_name} accepted {litres(qty)} at {rs(price)} per litre. Receipt {done.row?.receipt_no} was generated.</>
              : done.accepted
              ? <>Tell {farmer.full_name} the test result and the price: {litres(qty)} at {rs(price)} per litre, {rs(Math.round(qty * price))} in total. Then press their answer below.</>
              : <>The milk failed the quality test, so it was not added to stock. Show {farmer.full_name} the test result.</>}
          </p>
          {done.accepted && !done.answered && (
            <div className="mt-5 rounded-2xl bg-cream px-4 py-3 text-left text-[13px] text-muted">
              <p className="flex items-center gap-2 font-semibold text-ink"><Icon name="clock" size={15} />What did {farmer.full_name.split(' ')[0]} say?</p>
              <p className="mt-1">The milk joins your stock only after the farmer accepts. If you answer later, it waits on the collection page until {new Date(done.until).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}.</p>
              <div className="mt-3 flex flex-wrap gap-2 border-t border-line pt-3">
                <button className="btn-primary btn-sm" onClick={() => farmerSays(true)}><Icon name="check" size={15} />Farmer accepted</button>
                <button className="btn-secondary btn-sm" onClick={() => farmerSays(false)}>Farmer refused</button>
              </div>
            </div>
          )}
          {done.answered && done.row?.receipt_no && (
            <button className="mt-3 text-[13.5px] font-semibold text-forest hover:underline" onClick={() => setReceipt(done.row)}>View receipt {done.row.receipt_no}</button>
          )}
          {done.accepted && (
            <div className="mt-6 rounded-2xl bg-mint-soft px-4 py-4 text-left text-[14px] text-forest">
              <p><b>{done.answered ? `${litres(qty)} is now in your stock.` : `Once ${farmer.full_name.split(' ')[0]} accepts, ${litres(qty)} joins your stock.`}</b> Sell it to homes on the app or to a business in bulk.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link to={`/manager/shop?list=${farmer.milk_type}`} className="btn-primary btn-sm"><Icon name="store" size={15} />{listing ? 'Add litres to the app listing' : 'List it on the app'}</Link>
                <Link to="/manager/bulk-requests" className="btn-secondary btn-sm"><Icon name="gavel" size={15} />Offer to bulk buyers</Link>
              </div>
            </div>
          )}
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <button className="btn-ghost" onClick={again}>Record next farmer</button>
            <Link to="/manager/collection" className="btn-ghost">Back to collection</Link>
          </div>
        </div>
        <Receipt kind="collection" data={receipt} center={data?.center} onClose={() => setReceipt(null)} />
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
              <input className="input num h-16 w-full text-[30px] font-bold" type="number" min="0.5" max="2000" step="0.5" inputMode="decimal" placeholder="0"
                value={quantity} onChange={(e) => setQuantity(e.target.value)} aria-label="Litres" />
              <span className="pb-4 text-[18px] font-semibold text-muted">litres</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {picks.map(([n, usual]) => (
                <button key={n} type="button" onClick={() => setQuantity(String(n))}
                  className={`rounded-full px-3.5 py-2 text-[13.5px] font-semibold transition-colors ${Number(quantity) === n ? 'bg-forest text-cream' : usual ? 'bg-haldi-soft text-forest-deep hover:bg-haldi/40' : 'bg-cream-2 text-ink hover:bg-mint-soft'}`}>
                  {n} L{usual && <span className="ml-1 text-[11px] font-medium opacity-75">usual</span>}
                </button>
              ))}
            </div>
            {quantity !== '' && !(qty > 0 && qty <= 2000) && <p role="alert" className="mt-2 text-[13px] font-semibold text-danger">Enter between 0.5 and 2,000 litres.</p>}
            <p className="mt-2 text-[12.5px] text-muted">Type any amount up to 2,000 litres.{usual?.length ? ` Gold amounts are what ${farmer?.full_name.split(' ')[0]} usually brings.` : ''}</p>
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
              <span className="flex items-center gap-1.5 rounded-full bg-cream/10 px-3 py-1 text-[12px] font-semibold"><span className={`h-2 w-2 rounded-full ${device ? 'bg-[#7fd39b]' : 'bg-cream/40'}`} />{device ? `${device.serial} · live` : 'No device linked'}</span>
            </div>
            <p className="display mt-6 text-[26px]">{farmer.full_name}</p>
            <p className="text-cream/70">{litres(qty)} of {milkLabel[farmer.milk_type].toLowerCase()} milk · {shift}</p>
            {testing ? (
              <div className="relative mx-auto mt-8 grid h-40 w-40 place-items-center">
                <svg viewBox="0 0 160 160" className="absolute inset-0 -rotate-90">
                  <circle cx="80" cy="80" r="70" fill="none" stroke="rgb(247 241 227 / .12)" strokeWidth="8" />
                  <circle cx="80" cy="80" r="70" fill="none" stroke="#e2a93b" strokeWidth="8" strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 70} strokeDashoffset={2 * Math.PI * 70 * (left / test.seconds)} style={{ transition: 'stroke-dashoffset .25s linear' }} />
                </svg>
                <div className="text-center"><p className="display num text-[44px] leading-none">{test.finishing ? '…' : left}</p><p className="mt-1 text-[12px] text-cream/70">{test.finishing ? 'averaging' : 'seconds'}</p></div>
              </div>
            ) : (
            <div className="relative mx-auto mt-8 grid h-40 w-40 place-items-center">
              <span className={`absolute inset-0 rounded-full border-2 border-cream/15 ${scanning ? 'animate-ping' : ''}`} />
              <span className={`absolute inset-3 rounded-full border-2 border-haldi/40 ${scanning ? 'animate-spin border-t-haldi' : ''}`} />
              <span className={`grid h-24 w-24 place-items-center rounded-full bg-cream/10 ${badReading && !scanning ? 'text-[#f3a08c]' : 'text-haldi'}`}><Icon name={reading && !scanning ? (badReading ? 'alert' : 'check') : 'chip'} size={40} /></span>
            </div>
            )}
            <p className="mt-6 text-center text-[14px] text-cream/80">{testing ? (test.finishing ? 'Averaging the readings…' : `Keep the probes in the milk · ${plural(test.samples.length, 'readings')} so far`) : scanning ? 'Reading the sample…' : reading ? `Tested on the device, ${new Date(reading.reading_at ?? Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'Dip the probes in the sample, then take a reading.'}</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {device && (testing
                ? <button className="btn-on-dark" onClick={() => { cancelTest.current = true }} disabled={test.finishing}>Cancel test</button>
                : <button className="btn-haldi" onClick={scan} disabled={scanning || deviceOff}>{reading ? 'Test again' : 'Take reading'}</button>)}
            </div>
            {!device && !deviceOff && (
              <p className="mt-4 rounded-2xl bg-cream/10 px-4 py-3 text-center text-[13px] text-cream/80">No IoT device is linked to your center yet. ApnaDairy links it once its bill is paid, then milk can be tested here.</p>
            )}
            {deviceOff && (
              <p className="mt-4 rounded-2xl bg-cream/10 px-4 py-3 text-center text-[13px] text-cream/80">
                Your IoT device works once its bill is paid. <Link to="/manager/billing" className="font-semibold text-haldi underline">Go to billing</Link>
              </p>
            )}
            <ul className="mt-5 flex flex-wrap justify-center gap-1.5 text-[11.5px] text-cream/60">
              {PARAMS.filter((p) => p.sensor !== 'from TDS').map((p) => <li key={p.key} className="rounded-full bg-cream/5 px-2.5 py-1">{p.sensor}</li>)}
            </ul>
          </section>

          <section className="panel p-5 sm:p-6">
            <h2 className="display text-[19px] text-forest-deep">Readings</h2>
            {!reading && !scanning && !testing && <p className="mt-3 text-muted">Press Take reading. The device is read every few seconds for a minute and the values are averaged, so one bad reading cannot decide the price.</p>}
            {testing && (
              <div className="mt-4">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-cream px-4 py-2.5 text-[13px]">
                  <span className="flex items-center gap-2 font-semibold"><span className="relative flex h-2.5 w-2.5"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-forest opacity-50" /><span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-forest" /></span>Live from the device</span>
                  <span className="text-muted">{test.samples.length} readings{test.samples.some((x) => !x.valid) ? ` · ${test.samples.filter((x) => !x.valid).length} impossible` : ''}</span>
                </div>
                <div className="mt-3 flex h-8 items-end gap-1" aria-hidden="true">
                  {Array.from({ length: Math.max(test.samples.length, Math.ceil(test.seconds / (test.every || 3))) }, (_, i) => {
                    const x = test.samples[i]
                    return <span key={i} className={`flex-1 rounded-sm transition-all ${!x ? 'h-2 bg-cream-2' : x.valid ? 'h-8 bg-forest-2' : 'h-8 bg-danger/70'}`} />
                  })}
                </div>
                {!live && <p className="mt-4 text-[13.5px] text-muted">Waiting for the first good reading…</p>}
                {live && (
                  <div className="mt-4 grid gap-4">
                    {PARAMS.map((p) => (
                      <div key={p.key}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-[14px] font-semibold">{p.label}</span>
                          <span className="num text-[18px] font-bold text-ink">{Number(live[p.key]).toFixed(p.digits)} <span className="text-[12px] font-medium text-muted">{p.unit}</span></span>
                        </div>
                        <RangeBar param={p} value={Number(live[p.key])} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {reading && !scanning && reading.total != null && (
              <div className="mt-4 rounded-2xl bg-mint-soft px-4 py-3 text-[13px] text-forest">
                <p className="font-semibold">Average of {reading.used} of {reading.total} readings over {reading.seconds} seconds</p>
                {reading.notes?.map((n) => <p key={n} className="mt-1 text-amber">{n}</p>)}
              </div>
            )}
            {scanning && <div className="mt-4 grid gap-4">{PARAMS.map((p) => <div key={p.key} className="skeleton h-14" />)}</div>}
            {badReading && !scanning && (
              <div className="mt-4 rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[13.5px] text-danger">
                <p className="flex items-center gap-2 font-semibold"><Icon name="alert" size={16} />The device reading failed the sensor check</p>
                <ul className="mt-1.5 grid gap-1 pl-6">{reading.problems.map((m) => <li key={m} className="list-disc">{m}</li>)}</ul>
                <p className="mt-2 text-[12.5px]">Fix it and take the reading again. It is saved in the IoT log either way.</p>
              </div>
            )}
            {reading && !scanning && (
              <div className="mt-4 grid gap-4">
                {PARAMS.map((p) => (
                  <div key={p.key}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[14px] font-semibold">{p.label}</span>
                      <span className={`num text-[18px] font-bold ${reading[p.key] != null && inRange(p, reading[p.key]) ? 'text-ink' : 'text-danger'}`}>{reading[p.key] == null ? '—' : Number(reading[p.key]).toFixed(p.digits)} <span className="text-[12px] font-medium text-muted">{p.unit}</span></span>
                    </div>
                    <RangeBar param={p} value={Number(reading[p.key])} />
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 flex justify-between gap-2">
              <button className="btn-ghost" onClick={() => setStep(0)} disabled={testing}>Back</button>
              <button className="btn-primary" disabled={!reading || scanning || testing || !ai || badReading} onClick={() => setStep(2)}>See AI result <Icon name="arrow" size={17} /></button>
            </div>
          </section>
        </div>
      )}

      {step === 2 && ai && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
          <section className={`panel p-5 sm:p-6 ${ai.accept ? '' : 'border-[#efc6bb]'}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-[13px] font-semibold text-muted"><Icon name="spark" size={16} />AI assessment</p>
              <span className="rounded-full bg-cream-2 px-2.5 py-0.5 text-[11.5px] text-muted">quality and freshness models</span>
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
                  <input id="price" className={`input num h-14 w-full text-[26px] font-bold ${Number(price) < ai.min_price ? 'border-danger' : ''}`} type="number" inputMode="decimal" min={ai.min_price} value={price} onChange={(e) => setPrice(e.target.value)} />
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
