// titled panel used across the area manager portal
export default function Card({ title, subtitle, action, children, className = '', bodyClass = 'p-5 sm:p-6' }) {
  return (
    <section className={`panel animate-rise flex min-w-0 flex-col ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
          <div className="min-w-0">
            <h2 className="display text-[19px] text-forest-deep">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[13.5px] text-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={`min-w-0 flex-1 ${bodyClass}`}>{children}</div>
    </section>
  )
}

export function Kpi({ label, value, note, icon, children, accent = false }) {
  return (
    <div className={`animate-rise flex min-w-0 flex-col rounded-[20px] border p-4 sm:p-5 ${accent ? 'border-forest bg-forest text-cream' : 'border-line bg-surface'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className={`text-[13px] font-medium ${accent ? 'text-cream/75' : 'text-muted'}`}>{label}</p>
        {icon && <span className={`grid h-8 w-8 place-items-center rounded-full ${accent ? 'bg-cream/10 text-haldi' : 'bg-cream-2 text-forest'}`}>{icon}</span>}
      </div>
      <p className="display num mt-2 truncate text-[26px] sm:text-[30px]">{value ?? '—'}</p>
      {note && <p className={`mt-0.5 text-[12.5px] ${accent ? 'text-cream/70' : 'text-muted'}`}>{note}</p>}
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}
