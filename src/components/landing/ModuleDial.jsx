import { useState } from 'react'
import { Link } from 'react-router-dom'
import Reveal from './Reveal'
import { MilkChurn } from '../Farm'
import Icon from '../Icon'

// the four modules of the platform, around one dial
const modules = [
  {
    id: 'collection', label: 'Milk collection', icon: 'drop', pos: { x: 50, y: 15 }, status: 'Live now',
    img: '/media/farm-collection.webp', alt: 'A farmer pouring fresh milk into steel churns at his farm',
    title: 'Every litre, on record from the first pour',
    text: 'Area managers register farmers and their farms, record each delivery, and turn purchased milk into traceable inventory batches.',
    points: ['Farmer and farm registration at the center', 'Quantity, milk type and time logged per delivery', 'Purchase history and earnings for every farmer'],
  },
  {
    id: 'iot', label: 'IoT testing', icon: 'chip', pos: { x: 85, y: 50 }, status: 'Live now',
    img: '/media/ai-quality-monitoring.webp', alt: 'A dairy technician checking milk in a steel tank with a sensor and tablet',
    title: 'A sensor reads the milk, not a guess',
    text: 'A milk-testing device at each center measures temperature, pH, conductivity and dissolved solids and sends the readings straight to ApnaDairy.',
    points: ['Readings tagged with device and time', 'Linked to the exact delivery that was tested', 'A one-minute test, averaged over many readings'],
  },
  {
    id: 'ai', label: 'AI pricing', icon: 'spark', pos: { x: 50, y: 85 }, status: 'Live now',
    img: '/media/farmer-hero.webp', alt: 'An area manager showing a farmer the recommended price on a tablet',
    title: 'A fair price the farmer can see',
    text: 'Quality readings and quantity go into a model that recommends a price per litre. The farmer sees it and decides whether to sell.',
    points: ['Recommended rate shown before purchase', 'Farmer accepts or refuses, nothing is forced', 'Freshness and shelf-life estimates for stock'],
  },
  {
    id: 'b2b', label: 'Bulk bidding', icon: 'gavel', pos: { x: 15, y: 50 }, status: 'Live now', to: '/requests',
    img: '/media/cold-chain-delivery.webp', alt: 'A chilled milk delivery being handed over at a customer’s door',
    title: 'Businesses post, centers bid',
    text: 'Restaurants, hotels and shops post how much milk they need. Verified centers bid in the open, everyone can see the offers, and the buyer picks one.',
    points: ['Every offer visible on the public board', 'Best three qualifying bids ranked for the buyer', 'Order tracked from dispatch to delivery'],
  },
]

export default function ModuleDial() {
  const [active, setActive] = useState('b2b')
  const [hover, setHover] = useState(null)
  const shown = hover ?? active
  const m = modules.find((x) => x.id === active)

  return (
    <section id="modules" className="screen mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-8 lg:py-8">
      <Reveal className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <h2 className="display text-[40px] text-forest-deep sm:text-[clamp(40px,6.2vh,58px)]">One network. Four working parts.</h2>
        <p className="max-w-md text-[17px] text-muted">Pick a part of the platform to see what it does and where it is in the build.</p>
      </Reveal>

      <div className="mt-10 grid items-center gap-10 lg:mt-[clamp(16px,3vh,40px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        <Reveal>
          <div role="group" aria-label="Platform modules" className="relative mx-auto aspect-square w-full max-w-[min(500px,calc(100svh-300px))]">
            <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
              <circle cx="50" cy="50" r="35" fill="none" stroke="#1f4d36" strokeOpacity=".3" strokeWidth=".5" strokeDasharray="2.4 2" className="dial-spin" />
              <circle cx="50" cy="50" r="22" fill="none" stroke="#1f4d36" strokeOpacity=".12" strokeWidth=".5" />
              {modules.map((x) => (
                <line key={x.id} x1="50" y1="50" x2={x.pos.x} y2={x.pos.y} stroke={x.id === shown ? '#e2a93b' : '#1f4d36'}
                  strokeOpacity={x.id === shown ? 1 : 0.1} strokeWidth={x.id === shown ? 0.9 : 0.5} style={{ transition: 'all .4s' }} />
              ))}
            </svg>
            <div className="absolute left-1/2 top-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-line bg-surface text-center shadow-[0_20px_40px_-24px_rgb(23_58_40/.6)] sm:h-44 sm:w-44">
              <div className="flex flex-col items-center gap-1">
                <MilkChurn size={40} />
                <p className="display text-[16px] text-forest-deep sm:text-[20px]">ApnaDairy</p>
                <p className="hidden text-[12px] text-muted sm:block">Khalis doodh, on record</p>
              </div>
            </div>
            {modules.map((x) => {
              const sel = x.id === active
              return (
                <button key={x.id} type="button" aria-pressed={sel}
                  onClick={() => setActive(x.id)} onMouseEnter={() => setHover(x.id)} onMouseLeave={() => setHover(null)}
                  onFocus={() => setHover(x.id)} onBlur={() => setHover(null)}
                  style={{ left: `${x.pos.x}%`, top: `${x.pos.y}%` }}
                  className={`absolute flex h-[84px] w-[84px] -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center gap-1 rounded-full border bg-surface transition-all duration-300 sm:h-28 sm:w-28 ${
                    sel ? 'scale-110 border-forest shadow-[0_14px_30px_-14px_rgb(23_58_40/.7)] ring-4 ring-haldi/40' : 'border-line hover:-translate-y-[54%] hover:border-forest/50 hover:shadow-lg'}`}>
                  <span className={`grid h-8 w-8 place-items-center rounded-full transition-colors sm:h-10 sm:w-10 ${sel ? 'bg-forest text-cream' : 'bg-mint-soft text-forest'}`}><Icon name={x.icon} size={18} /></span>
                  <span className="px-1.5 text-center text-[11px] font-semibold leading-tight sm:text-[12px]">{x.label}</span>
                </button>
              )
            })}
          </div>
        </Reveal>

        <div key={m.id} className="animate-rise">
          <figure className="relative overflow-hidden rounded-[28px]">
            <img src={m.img} alt={m.alt} className="aspect-[16/10] w-full object-cover lg:max-h-[calc(100svh-400px)]" loading="lazy" />
            <span className={`absolute left-4 top-4 rounded-full px-3 py-1 text-[13px] font-semibold backdrop-blur ${m.status === 'Live now' ? 'bg-haldi text-forest-deep' : 'bg-cream/90 text-forest-deep'}`}>{m.status}</span>
            <figcaption className="absolute inset-x-4 bottom-4 rounded-2xl bg-forest-deep/85 p-4 text-cream backdrop-blur-md sm:inset-x-6 sm:bottom-6 sm:p-5">
              <p className="display text-[22px]">{m.title}</p>
              <p className="mt-1 text-[14.5px] text-cream/80">{m.text}</p>
            </figcaption>
          </figure>
          <ul className="mt-5 space-y-2">
            {m.points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[16px]">
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-mint-soft text-[12px] font-bold text-forest">✓</span>{p}
              </li>
            ))}
          </ul>
          {m.to && <Link to={m.to} className="btn-primary mt-5">See live bulk requests</Link>}
        </div>
      </div>
    </section>
  )
}
