import { useState } from 'react'
import { useUi } from '../context/UiContext'
import { payInvoice, paymentLabel, rsShort } from '../lib/center'
import { rs } from '../lib/format'
import Alert from './Alert'
import Sheet from './Sheet'
import { refError } from '../lib/validate'

// what a bill is made of
export function Breakdown({ i }) {
  const rows = []
  if (Number(i.device_fee)) rows.push(['IoT milk tester', rs(i.device_fee)])
  if (Number(i.subscription_fee)) {
    rows.push(['Platform fee', rs(i.subscription_fee)])
    if (i.discount_pct) rows.push([`${i.discount_pct}% off, for ${rsShort(i.sales_basis)} sales the month before`, `−${rs(Math.round(i.subscription_fee * i.discount_pct) / 100)}`])
  }
  // bills from before the subscription-only plan may still show a commission line
  if (Number(i.commission)) rows.push([`Commission ${Number(i.commission_pct)}% of ${rs(i.online_sales)} online orders`, rs(i.commission)])
  return (
    <dl className="mt-4 grid gap-1.5 rounded-2xl bg-cream px-4 py-3 text-[13.5px]">
      {rows.map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt className="text-muted">{l}</dt><dd className="num shrink-0 font-medium">{v}</dd></div>)}
    </dl>
  )
}

// the seller pays by jazzcash / easypaisa / bank, then sends the transaction id; the admin confirms it
export function PaySheet({ invoice, onClose, onPaid }) {
  const { toast } = useUi()
  const [method, setMethod] = useState(invoice?.payment_method && invoice.payment_method !== 'cash' ? invoice.payment_method : 'jazzcash')
  const [ref, setRef] = useState(invoice?.payment_ref ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const submit = async () => {
    if (refError(ref)) return setErr(refError(ref))
    setBusy(true); setErr('')
    try { await payInvoice(invoice.id, method, ref.trim()); toast('Payment sent. ApnaDairy confirms it once the money arrives.'); onPaid(); onClose() } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  return (
    <Sheet open={!!invoice} onClose={onClose} title={`Pay ${invoice ? rs(invoice.amount) : ''}`} subtitle={invoice?.description}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={submit} disabled={busy}>{busy ? 'Sending…' : 'Send payment details'}</button></>}>
      <Alert>{err}</Alert>
      <p className="text-[13px] font-semibold">How did you pay?</p>
      <div className="mt-2 grid gap-2">
        {['jazzcash', 'easypaisa', 'bank'].map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)}
            className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition-all ${method === m ? 'border-forest bg-mint-soft ring-2 ring-forest/15' : 'border-line bg-white hover:border-forest/40'}`}>
            <span className="font-semibold">{paymentLabel[m]}</span>
            <span className={`grid h-5 w-5 place-items-center rounded-full border-2 ${method === m ? 'border-forest' : 'border-line'}`}>{method === m && <span className="h-2.5 w-2.5 rounded-full bg-forest" />}</span>
          </button>
        ))}
      </div>
      <div className="field mt-5"><label htmlFor="ref">Transaction ID</label><input id="ref" className="input num" maxLength={30} placeholder="e.g. 0123456789" value={ref} onChange={(e) => setRef(e.target.value)} /></div>
      <p className="mt-4 rounded-2xl bg-cream px-4 py-3 text-[12.5px] text-muted">Pay ApnaDairy by JazzCash, EasyPaisa or bank transfer, then enter the transaction ID here. ApnaDairy checks it and marks the bill paid. To pay cash, visit the ApnaDairy office.</p>
    </Sheet>
  )
}
