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
  { key: 'temperature_c', label: 'Temperature', abbr: 'Temp', sensor: 'DS18B20', unit: '°C', min: 0, max: 45, low: 4, high: 37, digits: 1,
    help: 'Fresh milk arrives warm, around 33 to 37 °C. Chill it soon after.' },
  { key: 'ph', label: 'pH', abbr: 'pH', sensor: 'pH probe', unit: '', min: 6.0, max: 7.2, low: 6.6, high: 6.8, digits: 2,
    help: 'Acidity. Fresh milk is 6.6 to 6.8. Below 6.4 it is turning sour, above 6.9 soda may be added.' },
  { key: 'ec_ms', label: 'Conductivity (EC)', abbr: 'EC', sensor: 'from TDS', unit: 'mS/cm', min: 2.5, max: 8, low: 3.9, high: 5.5, digits: 2,
    help: 'Worked out from TDS (EC = TDS ÷ 640). Low EC suggests added water, high EC points to salt or an udder infection.' },
  { key: 'tds_ppm', label: 'Dissolved solids (TDS)', abbr: 'TDS', sensor: 'TDS sensor', unit: 'ppm', min: 1500, max: 5000, low: 2500, high: 3520, digits: 0,
    help: 'Total dissolved solids. Low TDS means watered milk, high TDS means something was dissolved in it.' },
]
// which sensor feeds which model (matches the device firmware)
export const MODELS = [
  { key: 'freshness', name: 'Model 1 · Freshness', inputs: ['temperature_c', 'timestamp', 'ph', 'ec_ms'],
    outputs: 'Shelf life, freshness score, spoilage and anomaly risk' },
  { key: 'adulteration', name: 'Model 2 · Adulteration', inputs: ['temperature_c', 'ph', 'ec_ms', 'tds_ppm'],
    outputs: 'Adulteration risk, probability and the likely additive' },
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
    .select('id, collected_at, reading_at, milk_type, quantity_l, ph, ec_ms, tds_ppm, temperature_c, test_source, device_serial, quality, freshness_hours, freshness_score, spoilage_risk, adulteration_risk, adulteration_score, suspected, ai_notes, status, reject_reason, farmer:farmers(full_name)')
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
  rpc('assess_milk', { p_milk_type: milkType, p_temperature: r.temperature_c, p_ph: r.ph, p_ec: r.ec_ms, p_tds: r.tds_ppm, p_reading_at: r.reading_at ?? new Date().toISOString() })
// the reading time is set by the server, so it is not sent
export const recordCollection = (a) => rpc('record_collection', {
  p_farmer: a.farmer, p_quantity: a.quantity, p_shift: a.shift, p_temperature: a.reading.temperature_c,
  p_ph: a.reading.ph, p_ec: a.reading.ec_ms, p_tds: a.reading.tds_ppm,
  p_source: a.source, p_price: a.price ?? null, p_manual_reason: a.manualReason || null, p_reading: a.readingId || null,
})
export const recordSale = (items, name) => rpc('record_sale', { p_items: items, p_customer_name: name || null })
// returns null when done, or a message when the customer's delivery code was wrong
export const updateShopOrder = (id, status, code) => rpc('update_shop_order', { p_id: id, p_status: status, p_code: code ?? null })
export const seedSample = () => rpc('seed_sample_data_v2')
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
    ec_ms: +((milkType === 'buffalo' ? 4.3 : 4.7) + rnd(-0.4, 0.4)).toFixed(2),
  }
  const roll = Math.random()
  if (roll < 0.08) r.ec_ms = +rnd(3.0, 3.4).toFixed(2)          // water added
  else if (roll < 0.12) r.ph = +rnd(6.3, 6.38).toFixed(2)       // souring
  else if (roll < 0.15) r.ec_ms = +rnd(6.7, 7.3).toFixed(2)     // salt
  else if (roll < 0.17) r.ph = +rnd(6.95, 7.03).toFixed(2)      // soda
  else if (roll < 0.27) r.ph = +rnd(6.47, 6.54).toFixed(2)      // slightly acidic
  r.tds_ppm = Math.round(r.ec_ms * 640 * rnd(0.98, 1.02))        // the device works out ec = tds / 640
  r.reading_at = new Date().toISOString()                        // firmware timestamp
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

// ---------- pricing rules and billing ----------
export const platformSettings = async () => must(await supabase.from('platform_settings').select('*').single())
export const billingTiers = async () => must(await supabase.from('billing_tiers').select('*').order('min_monthly_sales'))
export const milkCost = async () => must(await supabase.from('milk_cost_14d').select('*'))
export const billingOverview = () => rpc('billing_overview')
export const myInvoices = async () => must(await supabase.from('center_invoices').select('*').order('issued_at', { ascending: false }))
export const payInvoice = (id, method, ref) => rpc('pay_invoice', { p_invoice: id, p_method: method, p_ref: ref || null })
export const adminInvoices = async () => must(await supabase.from('admin_billing').select('*').order('issued_at', { ascending: false }).limit(300))
export const generateInvoices = (month) => rpc('generate_monthly_invoices', { p_month: month ?? null })
export const voidInvoice = (id) => rpc('void_invoice', { p_invoice: id })
export const savePlatformSettings = async (s) => {
  const keys = ['device_price', 'monthly_fee', 'commission_pct', 'farmer_min_pct', 'farmer_default_pct', 'markup_suggest_pct', 'markup_max_pct', 'payment_days']
  const row = Object.fromEntries(keys.map((k) => [k, Number(s[k])]))
  return must(await supabase.from('platform_settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', true))
}
export const saveTier = async (t) => must(await supabase.from('billing_tiers').upsert({ name: t.name, min_monthly_sales: Number(t.min_monthly_sales), discount_pct: Number(t.discount_pct) }))
export const paymentLabel = { jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', bank: 'Bank transfer', cash: 'Cash' }
export const monthLabel = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '')

// ---------- milk shop on the app: listings, profile, photos, reviews ----------
export const myPublicListings = async (centerId) => must(await supabase.from('public_listings').select('*').eq('shop_id', centerId))
export const myPublicShop = async (centerId) => must(await supabase.from('public_shops').select('*').eq('id', centerId).maybeSingle())
export const shopProfile = async () => must(await supabase.from('shop_profiles').select('*').maybeSingle())
export const saveShopProfile = async (centerId, p) => must(await supabase.from('shop_profiles').upsert({
  area_manager_id: centerId, tagline: p.tagline || null, description: p.description || null, phone: p.phone || null,
  whatsapp: p.whatsapp || null, opening_hours: p.opening_hours || null,
  delivery_radius_km: p.delivery_radius_km === '' || p.delivery_radius_km == null ? null : Number(p.delivery_radius_km),
  updated_at: new Date().toISOString(),
}))
export const shopPhotos = async () => must(await supabase.from('shop_photos').select('*').order('sort').order('created_at'))
export const photoUrl = (path) => supabase.storage.from('shop-photos').getPublicUrl(path).data.publicUrl
export async function uploadShopPhoto(centerId, file, sort = 0) {
  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
  const path = `${centerId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`
  const { error } = await supabase.storage.from('shop-photos').upload(path, file, { contentType: file.type, upsert: false })
  if (error) throw error
  return must(await supabase.from('shop_photos').insert({ path, sort }).select().single())
}
export async function deleteShopPhoto(photo) {
  await supabase.storage.from('shop-photos').remove([photo.path])
  return must(await supabase.from('shop_photos').delete().eq('id', photo.id))
}
export const setCoverPhoto = async (photos, id) => {
  // the cover is the first photo: move the chosen one to the front
  const ordered = [photos.find((p) => p.id === id), ...photos.filter((p) => p.id !== id)]
  for (let i = 0; i < ordered.length; i++) await supabase.from('shop_photos').update({ sort: i }).eq('id', ordered[i].id)
}
export const myReviews = async () => must(await supabase.from('shop_reviews').select('*').order('created_at', { ascending: false }).limit(200))
export const replyReview = (id, reply) => rpc('reply_review', { p_review: id, p_reply: reply })
export const milkListings = async () => must(await supabase.from('products').select('*').eq('category', 'milk'))
export const createListing = async (type, price) => must(await supabase.from('products').insert({
  name: `Fresh ${({ cow: 'cow', buffalo: 'buffalo', mixed: 'mixed' })[type]} milk`, category: 'milk', milk_type: type, unit: 'litre', price, is_available: true,
}).select().single())
export const saveListing = async (l) => must(await supabase.from('products').update({
  price: Number(l.price), discount_pct: Number(l.discount_pct) || 0, is_available: !!l.is_available,
  listed_l: null,
  min_order_l: Number(l.min_order_l) || 1, delivers: !!l.delivers, description: l.description || null,
}).eq('id', l.id))

// ---------- market rates (set by the super admin per city) ----------
export const myMarketRates = () => rpc('my_market_rates')
export const marketRates = async () => must(await supabase.from('market_rates').select('*').order('city').order('milk_type'))
export const saveMarketRate = async (city, type, rate) => must(await supabase.from('market_rates')
  .upsert({ city: city.trim().toLowerCase(), milk_type: type, rate: Number(rate), updated_at: new Date().toISOString() }))
export const deleteMarketCity = async (city) => must(await supabase.from('market_rates').delete().eq('city', city))
export const centerCities = async () => must(await supabase.from('area_managers').select('city').eq('type', 'milk_center'))
export const setDemoCenter = (userId, demo) => rpc('set_demo_center', { p_user: userId, p_demo: demo })
export const cityLabel = (c) => (c === '*' ? 'All other cities' : c.replace(/\b\w/g, (m) => m.toUpperCase()))

// ---------- farmer protection: offers, corrections, payments the farmer confirms ----------
export const OFFER_HOURS = 2
export const offerExpiresAt = (c) => new Date(c.collected_at).getTime() + OFFER_HOURS * 36e5
export const expireMyOffers = () => rpc('expire_my_offers')
export const demoFarmerAnswer = (id, accept) => rpc('demo_farmer_answer', { p_id: id, p_accept: accept })
export const cancelCollection = (id, reason) => rpc('cancel_collection', { p_id: id, p_reason: reason })
export const correctCollection = (id, quantity, reason) => rpc('correct_collection', { p_id: id, p_quantity: Number(quantity), p_reason: reason })
export const collectionAudit = async (ids) => must(await supabase.from('collection_audit').select('*').in('collection_id', ids).order('created_at'))
export const sendPayout = (farmerId, method, reference) => rpc('send_payout', { p_farmer: farmerId, p_method: method, p_reference: reference || null })
export const demoAnswerPayout = (id, confirm) => rpc('demo_farmer_answer_payout', { p_id: id, p_confirm: confirm })
export const farmerPayouts = async (farmerId) => must(await supabase.from('farmer_payouts').select('*').eq('farmer_id', farmerId).order('created_at', { ascending: false }).limit(50))
export const collectionById = async (id) => must(await supabase.from('milk_collections').select('*, farmer:farmers(id, full_name, village)').eq('id', id).single())
export const undoUsage = (id) => rpc('undo_usage', { p_id: id })
export const adminAudit = async () => must(await supabase.from('collection_audit')
  .select('*, center:area_managers(center_name, city), collection:milk_collections(quantity_l, milk_type, farmer:farmers(full_name))')
  .order('created_at', { ascending: false }).limit(200))
export const adminDisputes = async () => must(await supabase.from('farmer_payouts')
  .select('*, center:area_managers(center_name, city), farmer:farmers(full_name, phone)').eq('status', 'disputed').order('answered_at', { ascending: false }).limit(100))
export const adminUsageAudit = async () => must(await supabase.from('usage_audit')
  .select('*, center:area_managers(center_name, city)').order('created_at', { ascending: false }).limit(100))
export const auditLabel = { cancelled: 'Cancelled', corrected: 'Corrected', expired: 'Offer expired', usage_undone: 'Stock entry undone' }
// ---------- stock and orders: fresh stock, delivery codes, bid limits ----------
export const myMilkShelf = () => rpc('my_milk_shelf')
export const myBidCapacity = (type) => rpc('my_bid_capacity', { p_type: type }).then((r) => (Array.isArray(r) ? r[0] : r))
export const demoDeliveryCode = (kind, id) => rpc('demo_delivery_code', { p_kind: kind, p_order: id })
// ---------- the real iot device (esp32 → firebase → edge function → device_readings) ----------
export const myDevice = async () => must(await supabase.from('iot_devices').select('*').maybeSingle())
export const deviceLog = async (limit = 12) => must(await supabase.from('device_readings').select('*').order('received_at', { ascending: false }).limit(limit))
export async function takeDeviceReading() {
  const { data, error } = await supabase.functions.invoke('iot-reading', { body: {} })
  if (error) {
    let msg = 'Could not reach the device service. Check your internet and try again.'
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error } catch { /* keep the general message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data.reading
}
export const payoutStatusLabel = { sent: 'Waiting for farmer', confirmed: 'Confirmed', disputed: 'Disputed by farmer' }
export const payoutTone = { sent: 'amber', confirmed: 'green', disputed: 'red' }
