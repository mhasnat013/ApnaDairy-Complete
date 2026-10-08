import { MilkChurn } from '../Farm'

// only claims that are true of the platform as built
const items = [
  'Verified collection centers',
  'Every can tested at intake',
  'Farmers see the price before they sell',
  'Open bids anyone can see',
  'Every batch traced to its farm',
  'Bulk milk sent from AI-tested stock',
]

export default function Marquee() {
  const row = (hidden) => (
    <div aria-hidden={hidden} className="flex shrink-0 items-center">
      {items.map((t) => (
        <span key={t} className="flex items-center">
          <span className="whitespace-nowrap px-7 text-[17px] font-semibold text-forest-deep">{t}</span>
          <MilkChurn size={22} />
        </span>
      ))}
    </div>
  )
  return (
    <div className="marquee mt-3 shrink-0 overflow-hidden border-y border-line bg-mint-soft/70 py-4">
      <div className="marquee-track flex w-max motion-reduce:animate-none">{row(false)}{row(true)}</div>
    </div>
  )
}
