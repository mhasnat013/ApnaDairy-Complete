import { useEffect, useRef, useState } from 'react'
import Reveal from './Reveal'

// the procurement chain from the project brief — each stage is a separate record
const steps = [
  { title: 'Farmer brings milk', text: 'A registered farmer arrives at their nearby collection center. The area manager logs the quantity. It is not bought yet.', img: '/media/farm-collection.webp', alt: 'A farmer pouring milk into steel churns' },
  { title: 'The milk is tested', text: 'The testing device reads temperature, pH, conductivity and dissolved solids, and the readings are saved against this delivery.', img: '/media/ai-quality-monitoring.webp', alt: 'A technician testing milk in a steel tank' },
  { title: 'A price is recommended', text: 'The pricing model suggests a rate per litre from the quality and quantity. The area manager shows it to the farmer.', img: '/media/farmer-hero.webp', alt: 'An area manager showing a farmer the price on a tablet' },
  { title: 'The farmer decides', text: 'If the farmer accepts, the center completes the purchase and the farmer’s history updates. If not, nothing is bought.', img: '/media/farmer-hero.webp', alt: 'A farmer and an area manager agreeing on a sale' },
  { title: 'Milk becomes stock', text: 'Purchased milk becomes an inventory batch, linked to its farm, its test and the time it was collected.', img: '/media/dairy-facility.webp', alt: 'A bottle of milk and a steel can in a clean dairy' },
  { title: 'Sold fresh', text: 'Homes order through the ApnaDairy app. Businesses post bulk needs and centers bid with their stock.', img: '/media/cold-chain-delivery.webp', alt: 'A chilled delivery handed to a customer at his door' },
]
const STEP_MS = 5000

// one screen: step list on one side, picture on the other. it plays through the steps
// on its own while visible; clicking a step jumps to it and pauses the autoplay.
export default function HowItWorks() {
  const [active, setActive] = useState(0)
  const [auto, setAuto] = useState(true)
  const [visible, setVisible] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.5 })
    if (ref.current) io.observe(ref.current)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    if (!auto || !visible) return
    const id = setTimeout(() => setActive((a) => (a + 1) % steps.length), STEP_MS)
    return () => clearTimeout(id)
  }, [active, auto, visible])

  const pick = (i) => { setActive(i); setAuto(false) }
  const s = steps[active]

  return (
    <section id="how" ref={ref} className="screen furrows bg-forest-deep text-cream">
      <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-8 lg:py-8">
        <Reveal className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <h2 className="display max-w-3xl text-[40px] sm:text-[clamp(40px,6.2vh,58px)]">From the farm gate to the buyer, in six steps.</h2>
          <p className="max-w-md text-[17px] text-cream/70">Nothing is bought before the farmer agrees. Every step is its own record.</p>
        </Reveal>

        <div className="mt-10 grid items-center gap-8 lg:mt-[clamp(16px,3.5vh,44px)] lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:gap-14">
          <ol className="space-y-1.5" role="tablist" aria-label="Steps">
            {steps.map((st, i) => {
              const on = i === active
              return (
                <li key={st.title}>
                  <button role="tab" aria-selected={on} onClick={() => pick(i)}
                    className={`relative w-full overflow-hidden rounded-2xl px-4 text-left transition-all duration-300 ${on ? 'bg-cream/10 py-4' : 'py-2.5 hover:bg-cream/5'}`}>
                    <span className="flex items-center gap-4">
                      <span className={`display num grid h-10 w-10 shrink-0 place-items-center rounded-full text-[17px] transition-colors duration-300 ${on ? 'bg-haldi text-forest-deep' : 'bg-cream/10 text-cream/80'}`}>{i + 1}</span>
                      <span className={`display text-[21px] transition-colors sm:text-[23px] ${on ? 'text-cream' : 'text-cream/60'}`}>{st.title}</span>
                    </span>
                    <span className={`grid transition-all duration-300 ${on ? 'mt-2 grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
                      <span className="overflow-hidden pl-14 text-[15.5px] leading-relaxed text-cream/75">{st.text}</span>
                    </span>
                    {on && auto && visible && (
                      <span key={active} className="step-progress absolute inset-x-4 bottom-1.5 h-[3px] rounded-full bg-haldi/80" style={{ '--dur': `${STEP_MS}ms` }} />
                    )}
                  </button>
                </li>
              )
            })}
          </ol>

          <figure className="relative overflow-hidden rounded-[28px] bg-forest">
            {steps.map((st, i) => (
              <img key={i} src={st.img} alt={i === active ? st.alt : ''} aria-hidden={i !== active} loading="lazy"
                className={`aspect-[16/11] w-full object-cover transition-all duration-700 lg:max-h-[calc(100svh-300px)] ${i === active ? 'relative opacity-100 scale-100' : 'absolute inset-0 h-full opacity-0 scale-105'}`} />
            ))}
            <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 bg-gradient-to-t from-forest-deep/90 to-transparent p-5">
              <span className="display text-[20px]">{s.title}</span>
              <span className="num shrink-0 text-[14px] text-cream/70">Step {active + 1} of {steps.length}</span>
            </figcaption>
          </figure>
        </div>
      </div>
    </section>
  )
}
