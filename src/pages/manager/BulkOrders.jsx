import { useEffect, useState } from 'react'
import { centerOrders, updateBulkOrder, milkLabel, qualityLabel, qtyText, perUnit, isMilk, productLabel, gradeRule, gradeOk } from '../../lib/b2b'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { myCenter, assessMilk, gradeLabel } from '../../lib/center'
import ProductImage from '../../components/ProductImage'
import DeliverySheet from '../../components/DeliverySheet'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import { rs, date, cap, plural } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import OrderProgress from '../../components/OrderProgress'
import Alert from '../../components/Alert'
import EmptyState from '../../components/EmptyState'
import Sheet from '../../components/Sheet'
import Icon from '../../components/Icon'
import { useDeviceTest } from '../../lib/useDeviceTest'

const next = { confirmed: ['dispatched', 'Mark dispatched'], dispatched: ['delivered', 'Mark delivered'] }

export default function BulkOrders() {
  const { data, error, loading, reload } = useLoad(centerOrders)
  const [busy, setBusy] = useState(null)
  const [delivering, setDelivering] = useState(null)
  const [testing, setTesting] = useState(null)
  const { toast, confirm } = useUi()
  const { profile } = useAuth()
  const { data: center } = useLoad(() => myCenter(profile.id), [profile.id])
  const done = { dispatched: 'Dispatched. It left your stock and the buyer can see it is on the way.', delivered: 'Marked as delivered.', cancelled: 'Order cancelled.' }

  const move = async (o, status) => {
    if (status === 'cancelled') {
      const ok = await confirm({ title: 'Cancel this order?', body: `${qtyText(o.quantity_l, o.requirement?.unit)} for ${o.buyer?.business_name}. The buyer will see it as cancelled.`, confirmLabel: 'Cancel order', danger: true, cancelLabel: 'Keep order' })
      if (!ok) return
    }
    // milk is tested on the device before it leaves; products just leave stock
    if (status === 'dispatched' && isMilk(o.requirement)) return setTesting(o)
    if (status === 'dispatched') {
      const ok = await confirm({ title: `Dispatch ${qtyText(o.quantity_l, o.requirement?.unit)}?`, body: 'This takes it out of your product stock now, oldest stock first.', confirmLabel: 'Dispatch' })
      if (!ok) return
    }
    if (status === 'delivered') return setDelivering(o)
    setBusy(o.id)
    try { await updateBulkOrder(o.id, status); await reload(); toast(done[status]) } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Bulk orders" description={center?.type === 'byproduct' ? 'Bids you won. Dispatch each order when it leaves, and the buyer’s 4-digit code confirms delivery.' : 'Bids you won. Milk is tested on your IoT device before it is dispatched, and the buyer’s 4-digit code confirms delivery.'} />
      {testing && <DispatchTest order={testing} onClose={() => setTesting(null)} onDone={() => { toast('Tested and dispatched. The buyer can see the test result.'); reload() }} />}
      <DeliverySheet key={delivering?.id ?? 'closed'} order={delivering} kind="bulk" demo={center?.is_demo}
        title={delivering ? `Deliver to ${delivering.buyer?.business_name}` : ''} subtitle={delivering ? `${qtyText(delivering.quantity_l, delivering.requirement?.unit)} · ${rs(delivering.total_amount)}` : ''}
        submit={(code) => updateBulkOrder(delivering.id, 'delivered', code)}
        onClose={() => setDelivering(null)} onDone={() => { toast('Delivered. It now counts in your sales.'); reload() }} />
      <Alert>{error}</Alert>
      <div className="panel overflow-x-auto">
        <table className="table min-w-[920px]">
          <thead>
            <tr><th>Buyer</th><th>Order</th><th className="text-right">Total</th><th>Deliver to</th><th>Progress</th><th className="text-right">Next step</th></tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={6} />}
            {!loading && data?.length === 0 && (
              <tr><td colSpan={6}><EmptyState title="No bulk orders yet">When a business accepts one of your bids, the order appears here.</EmptyState></td></tr>
            )}
            {data?.map((o) => (
              <tr key={o.id}>
                <td><p className="font-semibold">{o.buyer?.business_name}</p><p className="text-[13px] text-muted">{cap(o.buyer?.business_type)}</p></td>
                <td className="num"><div className="flex items-center gap-3"><ProductImage category={o.requirement?.product ?? 'milk'} size={36} /><div>{qtyText(o.quantity_l, o.requirement?.unit)} at {rs(o.price_per_l)}/{perUnit(o.requirement?.unit)}<p className="text-[13px] text-muted">{isMilk(o.requirement) ? `${milkLabel[o.requirement?.milk_type]}, ${qualityLabel[o.requirement?.quality]?.toLowerCase()}` : productLabel[o.requirement?.product]}</p></div></div></td>
                <td className="num text-right font-semibold">{rs(o.total_amount)}</td>
                <td className="num">{date(o.delivery_date)}<p className="text-[13px] text-muted">{o.delivery_address ? `${o.delivery_address}, ` : ''}{o.delivery_city}</p></td>
                <td><OrderProgress order={o} /></td>
                <td>
                  <div className={`flex justify-end gap-2 ${busy === o.id ? 'pointer-events-none opacity-50' : ''}`}>
                    {next[o.status] && <button className="btn-primary btn-sm" onClick={() => move(o, next[o.status][0])}>{next[o.status][1]}</button>}
                    {o.status === 'confirmed' && <button className="btn-danger btn-sm" onClick={() => move(o, 'cancelled')}>Cancel</button>}
                    {o.status === 'delivered' && (o.review
                      ? <span className="text-right text-[13px]" title={o.review.comment ?? ''}><span className="text-haldi">{'★'.repeat(o.review.rating)}</span><span className="text-line">{'★'.repeat(5 - o.review.rating)}</span>{o.review.comment && <p className="max-w-[200px] truncate text-[12px] text-muted">“{o.review.comment}”</p>}</span>
                      : <span className="text-[12.5px] text-muted">Not rated yet</span>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

// before bulk milk leaves the center, the milk going out is tested on the iot device
function DispatchTest({ order, onClose, onDone }) {
  const { test, reading, err, run, cancel, left } = useDeviceTest()
  const [ai, setAi] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fail, setFail] = useState('')
  const type = order.requirement?.milk_type ?? 'mixed'
  const need = order.requirement?.quality ?? 'standard'
  const gradeGood = ai?.accept && gradeOk(ai.quality, need)
  const ok = reading && reading.status === 'ok' && gradeGood
  // the same ai check the database runs before it lets the milk go
  useEffect(() => {
    let live = true
    setAi(null)
    if (reading?.status === 'ok') assessMilk(type, reading).then((x) => live && setAi(x)).catch((e) => live && setFail(e.message))
    return () => { live = false }
  }, [reading, type])
  const send = async () => {
    setBusy(true); setFail('')
    try { await updateBulkOrder(order.id, 'dispatched', null, reading.id); onDone(); onClose() } catch (e) { setFail(e.message) }
    setBusy(false)
  }
  return (
    <Sheet open onClose={() => { cancel(); onClose() }} title={`Test and dispatch ${qtyText(order.quantity_l, 'litre')}`}
      subtitle={`For ${order.buyer?.business_name}, who asked for ${gradeRule(need).toLowerCase()} milk. Dip the probes in the milk that is going out. Only milk that tests ${gradeRule(need).toLowerCase()} can be sent.`}
      footer={<><button className="btn-secondary" onClick={() => { cancel(); onClose() }}>Cancel</button><button className="btn-primary" disabled={!ok || busy} onClick={send}>{busy ? 'Dispatching…' : 'Dispatch'}</button></>}>
      <Alert>{err || fail}</Alert>
      {test ? (
        <div className="rounded-[20px] bg-forest-deep px-5 py-6 text-center text-cream">
          <p className="display num text-[44px] leading-none">{test.finishing ? '…' : left}</p>
          <p className="mt-2 text-[13px] text-cream/75">{test.finishing ? 'Averaging the readings…' : `Keep the probes in the milk · ${plural(test.samples.length, 'readings')} so far`}</p>
          {!test.finishing && <button className="btn-on-dark btn-sm mt-4" onClick={cancel}>Cancel test</button>}
        </div>
      ) : !reading ? (
        <div className="rounded-[20px] bg-cream px-5 py-6 text-center">
          <p className="text-[14px] text-muted">The device is read every few seconds for a minute and the values are averaged.</p>
          <button className="btn-primary mt-4" onClick={run}><Icon name="chip" size={16} />Take reading</button>
        </div>
      ) : (
        <div className="grid gap-3">
          <dl className="grid grid-cols-4 gap-2">
            {[['Temp', `${Number(reading.temperature_c)} °C`], ['pH', Number(reading.ph)], ['EC', `${Number(reading.ec_ms)}`], ['TDS', Math.round(reading.tds_ppm)]].map(([k, v]) => (
              <div key={k} className="rounded-2xl bg-cream px-3 py-2.5"><dt className="text-[12px] text-muted">{k}</dt><dd className="num font-bold">{v}</dd></div>
            ))}
          </dl>
          {reading.status !== 'ok' ? (
            <p className="rounded-2xl bg-haldi-soft px-4 py-3 text-[13.5px] text-amber">{(reading.problems ?? []).join(' ') || 'The test did not finish properly.'} Test again.</p>
          ) : !ai ? <div className="skeleton h-14" /> : gradeGood ? (
            <p className="rounded-2xl bg-mint-soft px-4 py-3 text-[13.5px] text-forest"><b>Passed: {gradeLabel[ai.quality]} milk.</b> Fresh for about {Math.round(ai.freshness_hours)} more hours. The buyer sees this test with the order.</p>
          ) : ai.accept ? (
            <p className="rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[13.5px] text-danger"><b>This milk tests {gradeLabel[ai.quality]}, the buyer asked for {gradeRule(need).toLowerCase()}.</b> It cannot be sent. Test better milk, or cancel the order.</p>
          ) : (
            <p className="rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[13.5px] text-danger"><b>Failed: this milk cannot be sent.</b> {(ai.notes ?? []).join('. ')}. Use other milk and test again, or cancel the order.</p>
          )}
          {!ok && <button className="btn-secondary" onClick={run}><Icon name="chip" size={16} />Test again</button>}
        </div>
      )}
    </Sheet>
  )
}
