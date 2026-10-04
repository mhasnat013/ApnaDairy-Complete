import { useState } from 'react'
import Sheet from './Sheet'
import Alert from './Alert'
import Icon from './Icon'
import { demoDeliveryCode } from '../lib/center'

// marks an order delivered with the 4-digit code the buyer sees in their app.
// submit(code) resolves to null when done, or to a message when the code was wrong.
export default function DeliverySheet({ order, kind, title, subtitle, demo, submit, onClose, onDone }) {
  const [code, setCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [locked, setLocked] = useState(false)

  const send = async (e) => {
    e?.preventDefault()
    if (!/^\d{4}$/.test(code)) return setErr('Enter the 4-digit code.')
    setBusy(true); setErr('')
    try {
      const msg = await submit(code)
      if (msg) { setErr(msg); setCode(''); if (/last try/i.test(msg)) setLocked(true) } else { onDone(); onClose() }
    } catch (ex) { setErr(ex.message); if (/too many/i.test(ex.message)) setLocked(true) }
    setBusy(false)
  }
  const fillDemo = async () => {
    try { setCode((await demoDeliveryCode(kind, order.id)) ?? '') } catch (ex) { setErr(ex.message) }
  }

  return (
    <Sheet open={!!order} onClose={onClose} title={title} subtitle={subtitle}
      footer={<><button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-primary" form="deliver-form" disabled={busy || locked}>{busy ? 'Checking…' : 'Confirm delivery'}</button></>}>
      <form id="deliver-form" onSubmit={send}>
        <Alert>{err}</Alert>
        <label htmlFor="dcode" className="text-[13px] font-semibold">Delivery code</label>
        <input id="dcode" className="input num mt-2 h-16 w-full text-center text-[32px] font-bold tracking-[0.5em]" inputMode="numeric" autoComplete="one-time-code"
          maxLength={4} placeholder="0000" value={code} disabled={locked} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        <p className="mt-3 flex items-start gap-2 rounded-2xl bg-cream px-4 py-3 text-[12.5px] text-muted">
          <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
          {kind === 'bulk'
            ? 'The buyer sees this code on their ApnaDairy orders page. They can also press Received themselves.'
            : 'The customer sees this code in the ApnaDairy app. Ask for it when you hand over the milk. They can also confirm delivery in the app.'}
        </p>
        {demo && !locked && (
          <button type="button" className="mt-3 text-[13px] font-semibold text-forest hover:underline" onClick={fillDemo}>Show the buyer’s code (demo account)</button>
        )}
      </form>
    </Sheet>
  )
}
