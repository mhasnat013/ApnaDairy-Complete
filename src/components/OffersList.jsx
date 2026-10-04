import { publicBids } from '../lib/b2b'
import { useLoad } from '../lib/useLoad'
import { rs, litres, date } from '../lib/format'

// every live offer on a request, cheapest first — visible to everyone
export default function OffersList({ requirementId, target, highlight, dark = false }) {
  const { data, loading, error } = useLoad(() => publicBids(requirementId), [requirementId])
  const muted = dark ? 'text-cream/65' : 'text-muted'

  if (loading) return <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="skeleton h-16 rounded-2xl" />)}</div>
  // a missing view (05_open_bids.sql not run) or any other failure should show, not look like "no offers"
  if (error) return <p className="rounded-2xl bg-[#f8e2dc] px-4 py-3 text-[14px] text-danger">Offers could not load: {error}</p>
  if (!data?.length) return <p className={`text-[14.5px] ${muted}`}>No offers yet. The first center to bid sets the pace.</p>

  return (
    <ul className="space-y-2">
      {data.map((b, i) => {
        const diff = target ? Number(b.price_per_l) - Number(target) : null
        const mine = highlight && b.id === highlight
        return (
          <li key={b.id} style={{ animationDelay: `${i * 60}ms` }}
            className={`flex animate-rise items-center justify-between gap-4 rounded-2xl px-4 py-3 ${
              mine ? 'bg-mint-soft ring-2 ring-forest' : dark ? 'bg-cream/10' : 'bg-cream'}`}>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 font-semibold">
                <span className="truncate">{b.center_name}</span>
                {i === 0 && <span className="rounded-full bg-haldi px-2 py-0.5 text-[11.5px] font-bold text-forest-deep">Lowest</span>}
                {b.status === 'accepted' && <span className="rounded-full bg-forest px-2 py-0.5 text-[11.5px] font-bold text-cream">Chosen</span>}
                {mine && <span className="text-[12px] font-medium text-forest">(you)</span>}
              </p>
              <p className={`num text-[13px] ${muted}`}>
                {b.center_city}, {litres(b.quantity_l)} by {date(b.delivery_date)}{b.max_age_hours ? `, under ${b.max_age_hours} h old` : ''}
              </p>
            </div>
            <div className="shrink-0 text-right">
              <p className="num text-[18px] font-bold">{rs(b.price_per_l)}<span className={`text-[12px] font-medium ${muted}`}> /L</span></p>
              {diff != null && <p className={`num text-[12px] font-medium ${diff <= 0 ? 'text-forest' : 'text-amber'}`}>{diff === 0 ? 'at target' : `${rs(Math.abs(diff))} ${diff < 0 ? 'under' : 'over'}`}</p>}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
