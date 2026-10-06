import { useRef } from 'react'
import Icon from './Icon'
import { todayKey } from '../lib/center'

const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('en-CA')
}
const label = (key) => {
  const t = todayKey()
  if (key === t) return 'Today'
  if (key === addDays(t, -1)) return 'Yesterday'
  return new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: key.slice(0, 4) === t.slice(0, 4) ? undefined : 'numeric' })
}

// one day at a time: arrows step a day, the middle opens a calendar. min is the center's first day.
export default function DayPicker({ value, onChange, min, max = todayKey() }) {
  const input = useRef(null)
  const go = (n) => { const d = addDays(value, n); if ((!min || d >= min) && d <= max) onChange(d) }
  const open = () => { const el = input.current; if (!el) return; if (el.showPicker) el.showPicker(); else el.focus() }
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-center rounded-full border border-line bg-surface p-1 shadow-[0_6px_16px_-14px_rgb(30_43_34/.5)]">
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-forest transition-colors hover:bg-cream-2 disabled:opacity-30"
          onClick={() => go(-1)} disabled={!!min && value <= min} aria-label="Previous day"><Icon name="arrow" size={16} className="rotate-180" /></button>
        <button type="button" onClick={open} className="relative flex h-9 min-w-[150px] items-center justify-center gap-2 rounded-full px-3 text-[14px] font-semibold hover:bg-cream-2">
          <Icon name="clock" size={15} className="text-muted" />{label(value)}
          <input ref={input} type="date" value={value} min={min} max={max} aria-label="Pick a day"
            onChange={(e) => e.target.value && onChange(e.target.value)}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0" tabIndex={-1} />
        </button>
        <button type="button" className="grid h-9 w-9 place-items-center rounded-full text-forest transition-colors hover:bg-cream-2 disabled:opacity-30"
          onClick={() => go(1)} disabled={value >= max} aria-label="Next day"><Icon name="arrow" size={16} /></button>
      </div>
      {value !== max && <button type="button" className="btn-ghost btn-sm" onClick={() => onChange(max)}>Today</button>}
    </div>
  )
}
