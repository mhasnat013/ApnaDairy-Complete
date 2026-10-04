import { supabase } from './supabase'

// ---------- labels ----------
export const milkLabel = { cow: 'Cow', buffalo: 'Buffalo', mixed: 'Mixed' }
export const gradeLabel = { premium: 'Premium', fresh: 'Fresh', standard: 'Standard' }
export const gradeTone = { premium: 'green', fresh: 'blue', standard: 'amber' }
export const riskLabel = { low: 'Low', medium: 'Medium', high: 'High' }
export const orderStatusLabel = {
  pending: 'New', preparing: 'Preparing', out_for_delivery: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled',
}
export const orderTone = { pending: 'amber', preparing: 'blue', out_for_delivery: 'blue', delivered: 'green', cancelled: 'grey' }
export const nextOrderStep = {
  pending: ['preparing', 'Start preparing'],
  preparing: ['out_for_delivery', 'Send for delivery'],
  out_for_delivery: ['delivered', 'Mark delivered'],
}
export const categoryLabel = { milk: 'Milk', yogurt: 'Dahi', butter: 'Butter', ghee: 'Ghee', cream: 'Cream', lassi: 'Lassi', other: 'Other' }
export const usageLabel = { products: 'Made into products', spoiled: 'Spoiled', own_use: 'Own use' }

// normal ranges for the four iot parameters (shared by the device panel, readings page and charts)
export const PARAMS = [
  { key: 'ph', label: 'pH', unit: '', min: 6.0, max: 7.2, low: 6.6, high: 6.8, digits: 2,
    help: 'Acidity. Fresh milk is 6.6 to 6.8. Below 6.4 it is turning sour.' },
  { key: 'density', label: 'Density', unit: 'g/ml', min: 1.020, max: 1.040, low: 1.028, high: 1.034, digits: 4,
    help: 'Low density usually means water was added.' },
  { key: 'ec_ms', label: 'Conductivity', unit: 'mS/cm', min: 3, max: 8, low: 3.8, high: 5.5, digits: 2,
    help: 'High conductivity points to added salt or an udder infection.' },
  { key: 'temperature_c', label: 'Temperature', unit: '°C', min: 0, max: 45, low: 4, high: 37, digits: 1,
    help: 'Fresh milk arrives warm, around 33 to 37 °C. Chill it soon after.' },
]
export const inRange = (p, v) => v >= p.low && v <= p.high

// ---------- dates (pakistan time, same as the database views) ----------
export const todayKey = () => dayKey(new Date())
export const dayKey = (d) => new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
export const shortDay = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
export const weekday = (key) => new Date(`${key}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short' })
export const timeOf = (d) => new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })
export const currentShift = () => (Number(new Date().toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Karachi' })) < 13 ? 'morning' : 'evening')
// start and end of a pakistan calendar day as ISO strings, for range filters
export const dayRange = (key) => [new Date(`${key}T00:00:00+05:00`).toISOString(), new Date(`${key}T24:00:00+05:00`).toISOString()]

// compact rupees for charts: 61,085 → 61k, 1,830,000 → 18.3 lakh
export const rsShort = (n) => {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1e5) return `${(v / 1e5).toFixed(v >= 1e6 ? 1 : 2).replace(/\.?0+$/, '')} lakh`
  if (Math.abs(v) >= 1e3) return `${Math.round(v / 1e3)}k`
  return String(Math.round(v))
}

const must = ({ data, error }) => { if (error) throw error; return data }

// ---------- reads ----------
export const myCenter = async (userId) =>
  must(await supabase.from('area_managers').select('*').eq('user_id', userId).single())

export const centerDaily = async () => must(await supabase.from('center_daily').select('*').order('day'))
export const milkStock = async () => must(await supabase.from('milk_stock').select('*'))
export const productSales = async () => must(await supabase.from('product_sales_30d').select('*'))
export const settings = async () => must(await supabase.from('center_settings').select('*').maybeSingle())

export async function farmersWithStats() {
  const [farmers, stats] = await Promise.all([
    supabase.from('farmers').select('*').order('full_name').then(must),
    supabase.from('farmer_stats').select('*').then(must),
  ])
  const by = Object.fromEntries(stats.map((s) => [s.farmer_id, s]))
  return farmers.map((f) => ({ ...f, stats: by[f.id] ?? {} }))
}

const COLLECTION_FIELDS = '*, farmer:farmers(id, full_name, village)'

export const collectionsOn = async (key) => {
  const [from, to] = dayRange(key)
  return must(await supabase.from('milk_collections').select(COLLECTION_FIELDS)
    .gte('collected_at', from).lt('collected_at', to).order('collected_at', { ascending: false }))
}
export const recentCollections = async (limit = 60) =>
  must(await supabase.from('milk_collections').select(COLLECTION_FIELDS).order('collected_at', { ascending: false }).limit(limit))
export const farmerCollections = async (farmerId) =>
  must(await supabase.from('milk_collections').select('*').eq('farmer_id', farmerId).order('collected_at', { ascending: false }).limit(200))
export const stockBatches = async () =>
  must(await supabase.from('milk_collections').select('id, milk_type, quantity_l, collected_at, freshness_hours, quality, farmer:farmers(full_name)')
    .eq('status', 'accepted').gte('collected_at', new Date(Date.now() - 4 * 864e5).toISOString()).order('collected_at', { ascending: false }))
export const readingsSince = async (days = 14) =>
  must(await supabase.from('milk_collections')
    .select('id, collected_at, milk_type, quantity_l, ph, density, ec_ms, temperature_c, test_source, device_serial, quality, adulteration_risk, ai_notes, status, reject_reason, farmer:farmers(full_name)')
    .gte('collected_at', new Date(Date.now() - days * 864e5).toISOString()).order('collected_at', { ascending: false }).limit(1000))
export const priceHistory = async (days = 30) =>
  must(await supabase.from('milk_collections').select('collected_at, milk_type, quality, ai_price_per_l, price_per_l, status, reject_reason')
    .gte('collected_at', new Date(Date.now() - days * 864e5).toISOString()).order('collected_at', { ascending: false }).limit(1000))
export const usageLog = async () =>
  must(await supabase.from('milk_usage').select('*').order('created_at', { ascending: false }).limit(30))

export const products = async () => must(await supabase.from('products').select('*').order('category').order('name'))

const ORDER_FIELDS = '*, items:shop_order_items(id, name, quantity, unit, unit_price, line_total, category)'
export const activeOrders = async () =>
  must(await supabase.from('shop_orders').select(ORDER_FIELDS).in('status', ['pending', 'preparing', 'out_for_delivery']).order('created_at'))
export const pastOrders = async (status, limit = 40) => {
  let q = supabase.from('shop_orders').select(ORDER_FIELDS).order('created_at', { ascending: false }).limit(limit)
  q = status === 'all' ? q.in('status', ['delivered', 'cancelled']) : q.eq('status', status)
  return must(await q)
}

// ---------- writes ----------
const rpc = async (fn, args) => must(await supabase.rpc(fn, args))
export const assessMilk = (milkType, r) =>
  rpc('assess_milk', { p_milk_type: milkType, p_temperature: r.temperature_c, p_ph: r.ph, p_density: r.density, p_ec: r.ec_ms })
export const recordCollection = (a) => rpc('record_collection', {
  p_farmer: a.farmer, p_quantity: a.quantity, p_shift: a.shift, p_temperature: a.reading.temperature_c,
  p_ph: a.reading.ph, p_density: a.reading.density, p_ec: a.reading.ec_ms, p_source: a.source, p_price: a.price ?? null,
})
export const decideCollection = (id, accept, reason) => rpc('decide_collection', { p_id: id, p_accept: accept, p_reason: reason ?? null })
export const payFarmer = (farmerId) => rpc('pay_farmer', { p_farmer: farmerId })
export const recordSale = (items, name) => rpc('record_sale', { p_items: items, p_customer_name: name || null })
export const updateShopOrder = (id, status) => rpc('update_shop_order', { p_id: id, p_status: status })
export const seedSample = () => rpc('seed_sample_data')
export const clearSample = () => rpc('clear_sample_data')

export const saveFarmer = async (f) => {
  const row = { full_name: f.full_name, phone: f.phone || null, village: f.village || null, milk_type: f.milk_type, cattle_count: Number(f.cattle_count) || 0, is_active: f.is_active ?? true }
  return must(f.id
    ? await supabase.from('farmers').update(row).eq('id', f.id).select().single()
    : await supabase.from('farmers').insert(row).select().single())
}
export const saveProduct = async (p) => {
  const row = {
    name: p.name, category: p.category, unit: p.category === 'milk' ? 'litre' : p.unit, price: Number(p.price),
    milk_type: p.category === 'milk' ? p.milk_type : null,
    stock_qty: p.category === 'milk' ? null : Number(p.stock_qty) || 0,
    discount_pct: Number(p.discount_pct) || 0, made_on: p.made_on || null, expires_on: p.expires_on || null,
    is_available: p.is_available ?? true,
  }
  return must(p.id
    ? await supabase.from('products').update(row).eq('id', p.id).select().single()
    : await supabase.from('products').insert(row).select().single())
}
export const setProduct = async (id, patch) => must(await supabase.from('products').update(patch).eq('id', id))
export const recordUsage = async (u) => must(await supabase.from('milk_usage').insert({ milk_type: u.milk_type, litres: Number(u.litres), reason: u.reason, note: u.note || null }))
export const saveSettings = async (centerId, s) =>
  must(await supabase.from('center_settings').upsert({ area_manager_id: centerId, cow_rate: Number(s.cow_rate), buffalo_rate: Number(s.buffalo_rate), mixed_rate: Number(s.mixed_rate), updated_at: new Date().toISOString() }))

// ---------- simulated iot device ----------
// realistic readings around the normal range, with the occasional problem sample so the ai has something to catch
export function simulateReading(milkType = 'mixed') {
  const rnd = (a, b) => a + Math.random() * (b - a)
  const r = {
    temperature_c: +rnd(33, 37).toFixed(1),
    ph: +rnd(6.62, 6.78).toFixed(2),
    density: +((milkType === 'buffalo' ? 1.0305 : milkType === 'cow' ? 1.0295 : 1.030) + rnd(-0.0015, 0.0015)).toFixed(4),
    ec_ms: +((milkType === 'buffalo' ? 4.3 : 4.7) + rnd(-0.4, 0.4)).toFixed(2),
  }
  const roll = Math.random()
  if (roll < 0.08) r.density = +rnd(1.0235, 1.026).toFixed(4)
  else if (roll < 0.12) r.ph = +rnd(6.3, 6.42).toFixed(2)
  else if (roll < 0.15) r.ec_ms = +rnd(6.7, 7.3).toFixed(2)
  else if (roll < 0.25) r.ph = +rnd(6.47, 6.54).toFixed(2)
  return r
}

// ---------- stock: which collections are still on the shelf (first in, first out) ----------
// the oldest milk is sold first, so what is left in stock is the newest milk
export function shelfBatches(batches, stockRows) {
  const left = Object.fromEntries((stockRows ?? []).map((s) => [s.milk_type, Math.max(0, s.bought_l - s.sold_l - s.bulk_l - s.used_l)]))
  const out = []
  for (const b of batches ?? []) {
    const remaining = Math.min(Number(b.quantity_l), left[b.milk_type] ?? 0)
    if (remaining < 0.1) continue
    left[b.milk_type] -= remaining
    const expires = new Date(b.collected_at).getTime() + (b.freshness_hours ?? 24) * 36e5
    out.push({ ...b, remaining, expiresAt: expires, hoursLeft: (expires - Date.now()) / 36e5 })
  }
  return out.sort((a, b) => a.expiresAt - b.expiresAt)
}

export const stockLeft = (s) => Math.max(0, Number(s.bought_l) - Number(s.sold_l) - Number(s.bulk_l) - Number(s.used_l))
