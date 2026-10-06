import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useUi } from '../context/UiContext'
import { useDeviceTest } from '../lib/useDeviceTest'
import { retestListing, setListingDiscount, gradeLabel } from '../lib/center'
import { rs, litres, plural } from '../lib/format'
import Sheet from './Sheet'
import Alert from './Alert'
import Icon from './Icon'

// retest milk that is still on the app. the ai suggests a discount from the retest;
// the area manager can take it, change it, or give none. milk that fails comes off the app.
export default function RetestSheet({ listing, onClose, onDone }) {
  const { toast } = useUi()
  const { test, reading, err, run, cancel, left } = useDeviceTest()
  const [res, setRes] = useState(null)
  const [pct, setPct] = useState('')
  const [fail, setFail] = useState('')
  const [busy, setBusy] = useState(false)

  // the database checks the reading and works out the suggestion
  useEffect(() => {
    if (reading?.status !== 'ok') return
    let live = true
    setFail(''); setRes(null)
    retestListing(listing.id, reading.id)
      .then((r) => { if (!live) return; setRes(r); setPct(String(r.passed ? r.pct : 0)); if (!r.passed) onDone?.() })
      .catch((e) => live && setFail(e.message))
    return () => { live = false }
  }, [reading, listing.id, onDone])

  const n = Number(pct)
  const bad = pct === '' || !Number.isInteger(n) || n < 0 || n > 90
  const price = Number(listing.price)
  const save = async () => {
    if (bad) return setFail('The discount is a whole number from 0 to 90%.')
    setBusy(true); setFail('')
    try {
      await setListingDiscount(res.id, n)
      toast(n > 0 ? `${listing.name} is now ${n}% off on the app.` : `${listing.name} stays at full price.`)
      onDone?.(); onClose()
    } catch (e) { setFail(e.message) }
    setBusy(false)
  }

  const passed = res?.passed
  return (
    <Sheet open onClose={() => { cancel(); onClose() }} title={`Retest ${listing.name.toLowerCase()}`}
      subtitle={`${litres(Number(listing.listed_l))} is still on the app. Test it again before giving a discount. If it fails, it comes off the app.`}
      footer={passed
        ? <><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy || bad} onClick={save}>{busy ? 'Saving…' : n > 0 ? `Give ${n}% off` : 'Keep full price'}</button></>
        : <button className="btn-secondary" onClick={() => { cancel(); onClose() }}>{res ? 'Close' : 'Cancel'}</button>}>
      <Alert>{err || fail}</Alert>

      {test ? (
        <div className="rounded-[20px] bg-forest-deep px-5 py-6 text-center text-cream">
          <p className="display num text-[44px] leading-none">{test.finishing ? '…' : left}</p>
          <p className="mt-2 text-[13px] text-cream/75">{test.finishing ? 'Averaging the readings…' : `Keep the probes in the milk · ${plural(test.samples.length, 'readings')} so far`}</p>
          {!test.finishing && <button className="btn-on-dark btn-sm mt-4" onClick={cancel}>Cancel test</button>}
        </div>
      ) : !reading || (reading.status === 'ok' && !res && !fail) ? (
        reading ? <div className="skeleton h-40 rounded-[20px]" /> : (
          <div className="rounded-[20px] bg-cream px-5 py-6 text-center">
            <p className="text-[14px] text-muted">Dip the probes in the milk that is left. The device is read for a minute and the values are averaged.</p>
            <button className="btn-primary mt-4" onClick={run}><Icon name="chip" size={16} />Take reading</button>
          </div>
        )
      ) : reading.status !== 'ok' ? (
        <div className="grid gap-3">
          <p className="rounded-2xl bg-haldi-soft px-4 py-3 text-[13.5px] text-amber">{(reading.problems ?? []).join(' ') || 'The test did not finish properly.'} Test again.</p>
          <button className="btn-secondary" onClick={run}><Icon name="chip" size={16} />Test again</button>
        </div>
      ) : !res ? (
        <button className="btn-secondary" onClick={run}><Icon name="chip" size={16} />Test again</button>
      ) : !passed ? (
        <div className="rounded-2xl bg-[#f8e2dc] px-4 py-4 text-[14px] text-danger">
          <p className="font-semibold">This milk failed the retest and is now off the app.</p>
          <p className="mt-1">{(res.notes ?? []).join('. ')}.</p>
          <Link to="/manager/inventory" className="btn-secondary btn-sm mt-3">Record it as spoiled</Link>
        </div>
      ) : (
        <div className="grid gap-4">
          <dl className="grid grid-cols-3 gap-2">
            {[['Grade now', gradeLabel[res.grade]],
              ['Freshness', res.score_before != null ? `${res.score_before} → ${res.score_now}` : `${res.score_now}/100`],
              ['Shelf life left', `about ${Math.round(res.hours_left)} h`]].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-cream px-3 py-2.5"><dt className="text-[12px] text-muted">{k}</dt><dd className="num mt-0.5 font-bold text-forest-deep">{v}</dd></div>
            ))}
          </dl>

          <section className="rounded-2xl bg-forest-deep px-5 py-4 text-cream">
            <p className="flex items-center gap-2 text-[13px] text-cream/70"><Icon name="spark" size={15} />AI suggestion</p>
            <p className="display mt-1 text-[26px]">{res.pct > 0 ? `${res.pct}% off` : 'No discount needed'}</p>
            <ul className="mt-2 grid gap-1 text-[13px] text-cream/80">
              {res.pct > 0 && Number(res.drop) > 0 && <li>Freshness fell {res.drop} points since you bought it (+{Math.round(res.from_loss)}%)</li>}
              {res.pct > 0 && Number(res.from_time) > 0 && <li>Less than a day of shelf life left (+{Math.round(res.from_time)}%)</li>}
              {res.pct === 0 && <li>The milk still has a day or more left and has hardly changed.</li>}
              {res.pct > 0 && <li>Rounded to the nearest 5%, at most 50%.</li>}
            </ul>
          </section>

          <div className="field">
            <label htmlFor="rd">Discount to give</label>
            <div className="flex flex-wrap items-center gap-2">
              <input id="rd" className={`input num w-28 ${bad ? 'border-danger' : ''}`} type="number" inputMode="numeric" min="0" max="90" step="5" value={pct} onChange={(e) => setPct(e.target.value)} />
              <span className="text-muted">%</span>
              {n !== res.pct && <button type="button" className="text-[13px] font-semibold text-forest underline" onClick={() => setPct(String(res.pct))}>Use {res.pct}%</button>}
              {n !== 0 && <button type="button" className="text-[13px] font-semibold text-muted underline" onClick={() => setPct('0')}>No discount</button>}
            </div>
            <span className="hint">Your choice. You can give less, more, or none if you think it will still sell.</span>
          </div>

          <p className="rounded-2xl bg-cream px-4 py-3 text-[14px]">
            Customers will pay <b className="num">{rs(Math.round(price * (100 - (bad ? 0 : n)) / 100))}</b> a litre
            {!bad && n > 0 ? <> instead of <s className="num text-muted">{rs(price)}</s></> : ''}.
          </p>
        </div>
      )}
    </Sheet>
  )
}
