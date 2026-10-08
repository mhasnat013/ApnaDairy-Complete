// dynamic pricing for milk listings (supabase/43_dynamic_pricing.sql works out the real price; this mirrors it for display)
// hours are counted from when the listing's oldest milk was tested; it expires 48 h after that test.
export const STAGES = [
  { key: 'tested', label: 'Tested grade', pct: 0, from: 0, to: 4 },
  { key: 'good', label: 'Good now', pct: 10, from: 4, to: 12 },
  { key: 'standard', label: 'Standard now', pct: 20, from: 12, to: 24 },
  { key: 'cooking', label: 'For yogurt / cooking', pct: 30, from: 24, to: 42 },
  { key: 'last_hours', label: 'Last hours', pct: 40, from: 42, to: 48 },
]
export const stageOf = (key) => STAGES.find((s) => s.key === key)

// the stage now for milk that expires at `expiresAt`, and when each step starts
export function stageNow(expiresAt) {
  if (!expiresAt) return null
  const end = new Date(expiresAt).getTime()
  const tested = end - 48 * 36e5
  const steps = STAGES.map((s) => ({ ...s, starts: new Date(tested + s.from * 36e5), ends: new Date(tested + s.to * 36e5) }))
  const now = Date.now()
  const cur = steps.find((s) => now < s.ends.getTime())
  return cur ? { ...cur, steps, next: cur.key === 'last_hours' ? null : cur.ends } : { steps, expired: true }
}

export const priceAt = (price, pct) => Math.round(Number(price || 0) * (100 - pct) / 100)
