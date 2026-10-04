import { createPortal } from 'react-dom'
import Icon from './Icon'
import Logo from './Logo'
import { rs, litres, dateTime } from '../lib/format'
import { milkLabel, gradeLabel, paymentLabel } from '../lib/center'

// on-screen receipt for a collection or a farmer payment. there is no receipt printer,
// so the portal shows "receipt generated" with the number, and it can be printed from the browser.
export default function Receipt({ kind, data, center, farmer, onClose }) {
  if (!data) return null
  const isPayout = kind === 'payout'
  const rows = isPayout
    ? [['Farmer', farmer?.full_name], ['Collections', `${data.collections} ${data.collections === 1 ? 'drop-off' : 'drop-offs'}, ${litres(data.litres)}`], ['Paid by', paymentLabel[data.method] ?? data.method],
       ...(data.reference ? [['Reference', data.reference]] : []), ['Sent', dateTime(data.created_at)], ['Confirmed by farmer', dateTime(data.answered_at)]]
    : [['Farmer', farmer?.full_name ?? data.farmer?.full_name], ['Milk', `${litres(data.quantity_l)} ${milkLabel[data.milk_type].toLowerCase()} milk, ${data.shift}`],
       ['Tested', `${dateTime(data.reading_at ?? data.collected_at)}${data.test_source === 'manual' ? ', readings typed by hand' : ''}`],
       ['Grade', data.quality ? gradeLabel[data.quality] : '—'], ['Market rate (AI)', `${rs(data.ai_price_per_l)} per litre`],
       ['Price paid', `${rs(data.price_per_l)} per litre`], ['Accepted by farmer', dateTime(data.decided_at)]]
  const total = isPayout ? data.amount : data.total_amount
  return createPortal(
    <div className="receipt-overlay fixed inset-0 z-[80] grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Receipt">
      <div className="no-print absolute inset-0 bg-forest-deep/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="receipt-sheet relative w-full max-w-[400px] animate-pop">
        <div className="no-print mb-3 flex items-center justify-center gap-2 rounded-full bg-mint-soft px-4 py-2 text-[13.5px] font-semibold text-forest">
          <Icon name="check" size={16} />Receipt generated
        </div>
        <article className="rounded-[22px] bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-dashed border-line pb-4">
            <div><Logo /><p className="mt-2 text-[12.5px] text-muted">{center?.center_name}{center?.city ? `, ${center.city}` : ''}</p></div>
            <div className="text-right">
              <p className="text-[11.5px] uppercase tracking-wide text-muted">{isPayout ? 'Payment receipt' : 'Milk receipt'}</p>
              <p className="num font-bold">{data.receipt_no}</p>
            </div>
          </div>
          <dl className="grid gap-2 py-4 text-[13.5px]">
            {rows.map(([k, v]) => <div key={k} className="flex justify-between gap-4"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
          </dl>
          <div className="flex items-baseline justify-between border-t border-dashed border-line pt-4">
            <span className="font-semibold">Total</span>
            <span className="display num text-[28px]">{rs(total)}</span>
          </div>
          <p className="mt-4 text-center text-[11.5px] text-muted">Recorded on ApnaDairy. The farmer can see this receipt in the app.</p>
        </article>
        <div className="no-print mt-3 flex justify-center gap-2">
          <button className="btn-on-dark bg-forest-deep/60" onClick={() => window.print()}><Icon name="file" size={16} />Print</button>
          <button className="btn-haldi" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
