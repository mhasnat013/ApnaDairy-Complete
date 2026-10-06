import Reveal from './Reveal'

const cards = [
  { title: 'Test', text: 'A sensor reads every delivery at the center, so quality is measured instead of argued about.', tag: 'Temperature, pH, EC, TDS' },
  { title: 'Price', text: 'The farmer sees a recommended rate per litre before selling, and can say no.', tag: 'Recommended, never forced' },
  { title: 'Trace', text: 'Bought milk becomes a batch with its farm, test and time attached, all the way to the buyer.', tag: 'Farm to buyer, one record' },
]

export default function Problem() {
  return (
    <section className="screen bg-surface">
      <div className="mx-auto w-full max-w-[1320px] px-4 py-20 sm:px-8 lg:py-10">
        <Reveal>
          <h2 className="display max-w-5xl text-[42px] leading-[1] text-forest-deep sm:text-[clamp(44px,7.4vh,72px)]">
            Milk changes hands three times before breakfast.<span className="text-muted/60"> Almost none of it is written down.</span>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="mt-6 max-w-2xl text-[18px] leading-relaxed text-muted">
            Farmers are paid on trust and guesswork, quality is checked by eye, and buyers can't tell where their milk came from.
            ApnaDairy puts each step on one shared record.
          </p>
        </Reveal>
        <div className="mt-10 grid gap-5 md:grid-cols-3 lg:mt-[clamp(24px,5vh,56px)]">
          {cards.map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08}>
              <article className="group h-full rounded-[28px] border border-line bg-cream p-7 transition-all duration-300 hover:-translate-y-1 hover:border-forest/40 hover:shadow-[0_24px_40px_-28px_rgb(23_58_40/.6)]">
                <p className="display text-[40px] text-forest transition-colors group-hover:text-forest-deep">{c.title}</p>
                <p className="mt-3 text-[16px] leading-relaxed text-ink/80">{c.text}</p>
                <p className="mt-6 inline-flex rounded-full bg-haldi-soft px-3 py-1 text-[13px] font-semibold text-amber">{c.tag}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
