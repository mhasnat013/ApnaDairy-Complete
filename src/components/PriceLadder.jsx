import { useEffect, useState } from 'react'
import { rs } from '../lib/format'
import { qtyText } from '../lib/b2b'

// every bid as a dot on one shared price scale; the buyer's target is the haldi line.
// dots glide in from the target on first render; hovering a row shows the full offer.
export default function PriceLadder({ rows, target, acceptedId, onPick, unit = 'litre' }) {
  const [settled, setSettled] = useState(false)
  const [hover, setHover] = useState(null)
  useEffect(() => { const t = requestAnimationFrame(() => setSettled(true)); return () => cancelAnimationFrame(t) }, [])
  if (!rows.length) return null

  const prices = rows.map((r) => Number(r.price))
  if (target) prices.push(Number(target))
  const lo = Math.min(...prices), hi = Math.max(...prices)
  const pad = Math.max((hi - lo) * 0.14, hi * 0.02)
  const min = lo - pad, max = hi + pad
  const x = (p) => ((Number(p) - min) / (max - min)) * 100
  const start = target ? x(target) : 50

  return (
    <figure className="panel animate-rise p-5 sm:p-7" aria-label="Bids compared by price">
      <figcaption className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <span className="display text-[20px]">Who's offering what</span>
        <span className="flex flex-wrap items-center gap-4 text-[13px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full bg-forest" />Meets your needs</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-full border-2 border-muted bg-white" />Falls short</span>
          {target && <span className="flex items-center gap-1.5"><span className="h-3 w-[3px] rounded bg-haldi" />Your target</span>}
        </span>
      </figcaption>

      <div className="relative">
        {target && (
          <div className="pointer-events-none absolute inset-y-0 left-[122px] right-[76px] z-10 sm:left-[192px]">
            <div className="absolute -top-2 bottom-0 w-[3px] -translate-x-1/2 rounded bg-haldi" style={{ left: `${x(target)}%` }}>
              <span className="num absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-haldi px-2.5 py-0.5 text-[12.5px] font-bold text-forest-deep">
                {rs(target)}
              </span>
            </div>
          </div>
        )}

        <ul className="pt-7">
          {rows.map((r, i) => {
            const accepted = r.id === acceptedId
            const isHover = hover === r.id
            return (
              <li key={r.id}
                onMouseEnter={() => setHover(r.id)} onMouseLeave={() => setHover(null)}
                onClick={() => onPick?.(r.id)}
                className={`flex h-11 cursor-default items-center gap-3 rounded-full px-1 transition-colors ${isHover ? 'bg-cream-2' : ''} ${onPick ? 'cursor-pointer' : ''}`}>
                <span className={`w-[106px] shrink-0 truncate pl-2 text-[13.5px] sm:w-[176px] ${accepted ? 'font-bold text-forest' : 'font-medium'}`} title={r.label}>
                  {r.label}
                </span>
                <div className="relative h-full flex-1">
                  <div className="absolute inset-x-0 top-1/2 h-[2px] -translate-y-1/2 rounded bg-line" />
                  <span
                    className={`absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full transition-[left,transform] duration-700 ease-out ${
                      r.ok ? 'bg-forest' : 'border-[2.5px] border-muted bg-white'} ${accepted ? 'h-6 w-6 ring-4 ring-haldi/60' : isHover ? 'h-5 w-5' : 'h-4 w-4'}`}
                    style={{ left: `${settled ? x(r.price) : start}%`, transitionDelay: `${i * 70}ms` }}
                  >
                    {accepted && <span className="text-[11px] font-bold text-cream">✓</span>}
                  </span>
                  {isHover && (
                    <span className="num absolute -top-1 z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-xl bg-forest-deep px-3 py-1.5 text-[12.5px] text-cream shadow-lg"
                      style={{ left: `${x(r.price)}%` }}>
                      {qtyText(r.quantity, unit)} for {rs(r.price * r.quantity)}
                    </span>
                  )}
                </div>
                <span className={`num w-[60px] shrink-0 pr-2 text-right text-[14px] ${r.ok ? 'font-bold' : 'text-muted'}`}>
                  {Number(r.price).toFixed(0)}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </figure>
  )
}
