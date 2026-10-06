import { HillsStrip } from './Farm'

const greeting = () => {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// forest banner at the top of each overview page
export default function WelcomeBanner({ name, line, children }) {
  return (
    <section className="furrows relative mb-8 animate-rise overflow-hidden rounded-[24px] bg-forest-deep px-6 py-7 text-cream sm:px-8">
      <HillsStrip className="pointer-events-none absolute bottom-0 right-0 hidden h-full sm:block w-[60%] max-w-[460px] opacity-90" />
      <div className="relative max-w-[560px]">
        <p className="text-[14px] text-cream/70">{greeting()}{name ? `, ${name}` : ''}</p>
        <h1 className="display mt-1 text-[30px] sm:text-[36px]">{line}</h1>
        {children && <div className="mt-5 flex flex-wrap gap-2">{children}</div>}
      </div>
    </section>
  )
}
