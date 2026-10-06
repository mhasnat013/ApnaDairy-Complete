import { useLayoutEffect, useRef, useState } from 'react'

// chart colours (checked for colour-blind separation on the cream surface):
// sales / milk = green, cost = gold. text always stays in ink colours.
export const C = {
  green: '#2e7d4f', gold: '#c88916', ink: '#1e2b22', muted: '#6a6f5f', grid: '#ebe2cc', surface: '#fffcf4', danger: '#a8402b',
  // ordered grades: one green ramp, dark = best
  g1: '#1f5b3a', g2: '#4f9a6b', g3: '#a9cfb3',
}

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const niceMax = (v) => {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const n = v / p
  // steps that split into four round ticks (0, ¼, ½, ¾, max)
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : n <= 8 ? 8 : 10) * p
}

// time series: bars and/or lines on one shared axis, with a hover crosshair and tooltip
// series: [{ key, label, color, type: 'bar' | 'line' | 'area' }]
export function TrendChart({ data, series, xKey = 'day', xFormat = (v) => v, yFormat = (v) => v, tooltipExtra, height = 240, ariaLabel, yDomain, band }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const pad = { t: 12, r: 8, b: 26, l: 46 }
  const w = Math.max(width, 200)
  const iw = w - pad.l - pad.r
  const ih = height - pad.t - pad.b
  // yDomain [min, max] for measures that never sit near zero (pH); bars always start at zero
  const lo = yDomain ? yDomain[0] : 0
  const max = yDomain ? yDomain[1] : niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0))))
  const step = iw / Math.max(data.length, 1)
  const x = (i) => pad.l + step * i + step / 2
  const y = (v) => pad.t + ih - ((Number(v) - lo) / (max - lo)) * ih
  const bars = series.filter((s) => s.type === 'bar')
  const bw = Math.max(2, Math.min(22, (step - 4) / Math.max(bars.length, 1)))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => lo + t * (max - lo))
  const every = Math.ceil(data.length / Math.max(2, Math.floor(iw / 64)))

  // days with no value leave a gap in the line instead of dropping to the floor
  const linePath = (key) => {
    let out = '', pen = false
    data.forEach((d, i) => {
      if (d[key] == null) { pen = false; return }
      out += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`; pen = true
    })
    return out
  }
  const lone = (key) => data.map((d, i) => d[key] != null && data[i - 1]?.[key] == null && data[i + 1]?.[key] == null ? i : -1).filter((i) => i >= 0)
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.floor((e.clientX - r.left - pad.l) / step)
    setHover(i >= 0 && i < data.length ? i : null)
  }
  const h = hover != null ? data[hover] : null
  const tipLeft = hover != null ? Math.min(Math.max(x(hover) - 90, 0), w - 180) : 0

  return (
    <div ref={ref} className="relative w-full select-none">
      {width > 0 && (
        <svg width={w} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onTouchStart={(e) => onMove(e.touches[0] ? { ...e, clientX: e.touches[0].clientX, currentTarget: e.currentTarget } : e)}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke={C.grid} strokeWidth="1" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={C.muted}>{yFormat(t)}</text>
            </g>
          ))}
          {band && <rect x={pad.l} width={iw} y={y(band[1])} height={Math.max(0, y(band[0]) - y(band[1]))} fill="#cfe5d3" opacity="0.45" />}
          {hover != null && <rect x={x(hover) - step / 2} y={pad.t} width={step} height={ih} fill={C.ink} opacity="0.04" />}
          {bars.map((s, bi) => data.map((d, i) => {
            const v = Number(d[s.key]) || 0
            const bx = x(i) - (bw * bars.length) / 2 + bi * bw + 1
            const top = y(v)
            const bh = pad.t + ih - top
            if (bh <= 0) return null
            const r = Math.min(4, bw / 2 - 1, bh)
            return (
              <path key={`${s.key}${i}`} fill={s.color} opacity={hover == null || hover === i ? 1 : 0.55}
                d={`M${bx},${pad.t + ih}V${top + r}Q${bx},${top} ${bx + r},${top}H${bx + bw - 2 - r}Q${bx + bw - 2},${top} ${bx + bw - 2},${top + r}V${pad.t + ih}Z`} />
            )
          }))}
          {series.filter((s) => s.type === 'area').map((s) => (
            <path key={`a${s.key}`} d={`${linePath(s.key)}L${x(data.length - 1)},${pad.t + ih}L${x(0)},${pad.t + ih}Z`} fill={s.color} opacity="0.12" />
          ))}
          {series.filter((s) => s.type !== 'bar').map((s) => (
            <path key={`l${s.key}`} d={linePath(s.key)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.filter((s) => s.type !== 'bar').flatMap((s) => lone(s.key).map((i) => (
            <circle key={`o${s.key}${i}`} cx={x(i)} cy={y(data[i][s.key])} r="3" fill={s.color} />
          )))}
          {h && series.filter((s) => s.type !== 'bar' && h[s.key] != null).map((s) => (
            <circle key={`d${s.key}`} cx={x(hover)} cy={y(h[s.key])} r="4.5" fill={s.color} stroke={C.surface} strokeWidth="2" />
          ))}
          {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (i === data.length - 1 || data.length - 1 - i >= every / 2) ? (
            <text key={`x${i}`} x={x(i)} y={height - 7} textAnchor="middle" fontSize="11" fill={C.muted}>{xFormat(d[xKey], i)}</text>
          ) : null)}
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + ih} y2={pad.t + ih} stroke="#d9cdb0" />
        </svg>
      )}
      {h && (
        <div className="pointer-events-none absolute top-0 z-10 w-[180px] rounded-xl border border-line bg-surface px-3 py-2 text-[12.5px] shadow-[0_12px_28px_-14px_rgb(30_43_34/.45)]"
          style={{ left: tipLeft }}>
          <p className="mb-1 font-semibold text-ink">{xFormat(h[xKey], hover, true)}</p>
          {series.map((s) => (
            <p key={s.key} className="flex items-center justify-between gap-2 text-muted">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: s.color }} />{s.label}</span>
              <span className="num font-semibold text-ink">{h[s.key] == null && s.type !== 'bar' ? '—' : yFormat(h[s.key] || 0, true)}</span>
            </p>
          ))}
          {tooltipExtra?.(h)}
        </div>
      )}
    </div>
  )
}

export function Legend({ items }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span className={i.line ? 'h-[3px] w-4 rounded-full' : 'h-2.5 w-2.5 rounded-[3px]'} style={{ background: i.color }} />{i.label}
        </span>
      ))}
    </div>
  )
}

// small trend line for stat cards
export function Sparkline({ values, color = C.green, height = 36, width = 120 }) {
  if (!values?.length) return null
  const max = Math.max(...values), min = Math.min(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => [(i / Math.max(values.length - 1, 1)) * width, height - 3 - ((v - min) / span) * (height - 6)])
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={`${d}L${width},${height}L0,${height}Z`} fill={color} opacity="0.1" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="3" fill={color} />
    </svg>
  )
}

// ring chart with the total in the middle; segments: [{ label, value, color }]
export function Donut({ segments, size = 168, thickness = 20, center, sub }) {
  const total = segments.reduce((n, s) => n + s.value, 0) || 1
  const r = (size - thickness) / 2
  const circ = 2 * Math.PI * r
  const gap = segments.filter((s) => s.value > 0).length > 1 ? 3 : 0
  let acc = 0
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={C.grid} strokeWidth={thickness} />
        {segments.map((s) => {
          const len = (s.value / total) * circ
          const el = s.value > 0 && (
            <circle key={s.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={s.color} strokeWidth={thickness}
              strokeDasharray={`${Math.max(len - gap, 0.5)} ${circ}`} strokeDashoffset={-acc} />
          )
          acc += len
          return el
        })}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="display num text-[28px] text-ink">{center}</p>
          {sub && <p className="text-[12px] text-muted">{sub}</p>}
        </div>
      </div>
    </div>
  )
}

// where a reading sits against its normal range
export function RangeBar({ param, value, compact = false }) {
  const pct = (v) => Math.min(100, Math.max(0, ((v - param.min) / (param.max - param.min)) * 100))
  const ok = value >= param.low && value <= param.high
  return (
    <div className={compact ? '' : 'mt-2'}>
      <div className="relative h-2 rounded-full bg-cream-2">
        <div className="absolute inset-y-0 rounded-full bg-mint" style={{ left: `${pct(param.low)}%`, width: `${pct(param.high) - pct(param.low)}%` }} />
        {value != null && (
          <span className={`absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface shadow ${ok ? 'bg-forest' : 'bg-danger'}`}
            style={{ left: `${pct(value)}%` }} />
        )}
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between text-[11px] text-muted num">
          <span>{param.min}</span><span>normal {param.low} to {param.high}</span><span>{param.max}</span>
        </div>
      )}
    </div>
  )
}

// horizontal share bar, e.g. stock split by milk type
export function SplitBar({ parts, height = 10 }) {
  const total = parts.reduce((n, p) => n + p.value, 0) || 1
  return (
    <div className="flex w-full gap-[2px] overflow-hidden rounded-full" style={{ height }}>
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.label} title={`${p.label}: ${p.value}`} style={{ width: `${(p.value / total) * 100}%`, background: p.color }} />
      ))}
    </div>
  )
}
