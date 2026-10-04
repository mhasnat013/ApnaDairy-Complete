import { useLayoutEffect, useRef, useState } from 'react'

// pill tabs with a sliding thumb: options = [{ value, label, count?, hint? }]
export default function Segmented({ options, value, onChange, size = 'md' }) {
  const wrap = useRef(null)
  const [thumb, setThumb] = useState(null)

  // measure the selected tab, and measure again whenever any tab changes size
  // (counts arriving after load, fonts finishing, window resize)
  useLayoutEffect(() => {
    const box = wrap.current
    if (!box) return
    const measure = () => {
      const el = box.querySelector('[aria-selected="true"]')
      if (el) setThumb({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    box.querySelectorAll('[role="tab"]').forEach((t) => ro.observe(t))
    return () => ro.disconnect()
  }, [value, options.length])

  const pad = size === 'sm' ? 'px-3 py-1.5 text-[13px]' : 'px-4 py-2 text-[14px]'
  return (
    <div ref={wrap} className="relative inline-flex flex-wrap gap-1 rounded-full bg-cream-2 p-1" role="tablist">
      {thumb && (
        <span className="absolute rounded-full bg-surface shadow-[0_1px_3px_rgb(30_43_34/.15)] transition-all duration-200 ease-out"
          style={thumb} aria-hidden />
      )}
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={`relative z-10 rounded-full font-medium transition-colors ${pad} ${value === o.value ? 'text-forest' : 'text-muted hover:text-ink'}`}>
          {o.label}
          {o.count != null && (
            <span className={`num ml-1.5 rounded-full px-1.5 text-[12px] ${value === o.value ? 'bg-mint-soft text-forest' : 'bg-cream text-muted'}`}>{o.count}</span>
          )}
        </button>
      ))}
    </div>
  )
}
