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
export const categoryLabel = { milk: 'Milk', ghee: 'Desi ghee', butter: 'Butter', yogurt: 'Yogurt (dahi)', cheese: 'Cheese', cream: 'Cream', lassi: 'Lassi', other: 'Other dairy' }
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

// shop data is public (customers browse it), so the seller's own rows are picked by id
const mySellerId = async () => must(await supabase.rpc('my_seller_id'))
export const products = async () => must(await supabase.from('products').select('*').eq('area_manager_id', await mySellerId()).order('category').order('name'))

const ORDER_FIELDS = '*, items:shop_order_items(id, name, quantity, unit, unit_price, line_total, category)'
export const activeOrders = async () =>
  must(await supabase.from('shop_orders').select(ORDER_FIELDS).in('status', ['pending', 'preparing', 'out_for_delivery']).order('created_at'))
// delivered or cancelled orders of one day (pakistan time): delivered by delivery time, cancelled by order time
export const pastOrders = async (status, day) => {
  const from = new Date(`${day}T00:00:00+05:00`).toISOString(), to = new Date(new Date(`${day}T00:00:00+05:00`).getTime() + 864e5).toISOString()
  const col = status === 'delivered' ? 'delivered_at' : 'created_at'
  return must(await supabase.from('shop_orders').select(ORDER_FIELDS).eq('status', status).gte(col, from).lt(col, to).order(col, { ascending: false }).limit(300))
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
    milk_type: p.milk_type || null,
    stock_qty: p.category === 'milk' ? null : Number(p.stock_qty) || 0,
    discount_pct: Number(p.discount_pct) || 0, made_on: p.made_on || null, expires_on: p.expires_on || null,
    is_available: p.is_available ?? true, description: p.description?.trim() || null,
  }
  return must(p.id
    ? await supabase.from('products').update(row).eq('id', p.id).select().single()
    : await supabase.from('products').insert(row).select().single())
}
export const setProduct = async (id, patch) => must(await supabase.from('products').update(patch).eq('id', id))
export const recordUsage = async (u) => must(await supabase.from('milk_usage').insert({ milk_type: u.milk_type, litres: Number(u.litres), reason: u.reason, note: u.note || null }))
export const saveSettings = async (centerId, s) =>
  must(await supabase.from('center_settings').upsert({ area_manager_id: centerId, cow_rate: Number(s.cow_rate), buffalo_rate: Number(s.buffalo_rate), mixed_rate: Number(s.mixed_rate), updated_at: new Date().toISOString() }))

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
  const keys = ['device_price', 'monthly_fee', 'discount_min_sales', 'discount_pct', 'order_min_l', 'order_max_l', 'farmer_min_pct', 'farmer_default_pct', 'markup_suggest_pct', 'markup_max_pct', 'payment_days']
  const row = Object.fromEntries(keys.map((k) => [k, Number(s[k])]))
  return must(await supabase.from('platform_settings').update({ ...row, updated_at: new Date().toISOString() }).eq('id', true))
}
export const paymentLabel = { jazzcash: 'JazzCash', easypaisa: 'EasyPaisa', bank: 'Bank transfer', cash: 'Cash' }
export const monthLabel = (d) => (d ? new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '')

// ---------- milk shop on the app: listings, profile, photos, reviews ----------
export const myPublicListings = async (centerId) => must(await supabase.from('public_listings').select('*').eq('shop_id', centerId))
export const myPublicProducts = async (centerId) => must(await supabase.from('public_products').select('*').eq('shop_id', centerId))
export const myPublicShop = async (centerId) => must(await supabase.from('public_shops').select('*').eq('id', centerId).maybeSingle())
export const shopProfile = async () => must(await supabase.from('shop_profiles').select('*').eq('area_manager_id', await mySellerId()).maybeSingle())
export const saveShopProfile = async (centerId, p) => must(await supabase.from('shop_profiles').upsert({
  area_manager_id: centerId, tagline: p.tagline || null, description: p.description || null, phone: p.phone || null,
  whatsapp: p.whatsapp || null, opening_hours: p.opening_hours || null,
  delivery_radius_km: p.delivery_radius_km === '' || p.delivery_radius_km == null ? null : Number(p.delivery_radius_km),
  updated_at: new Date().toISOString(),
}))
export const shopPhotos = async () => must(await supabase.from('shop_photos').select('*').eq('area_manager_id', await mySellerId()).order('sort').order('created_at'))
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
export const myReviews = async () => must(await supabase.from('shop_reviews').select('*').eq('area_manager_id', await mySellerId()).order('created_at', { ascending: false }).limit(200))
export const replyReview = (id, reply) => rpc('reply_review', { p_review: id, p_reply: reply })
// ratings businesses gave after a bulk order was delivered
export const myBulkReviews = async () => must(await supabase.from('bulk_reviews')
  .select('*, business:business_profiles(business_name, business_type), order:bulk_orders(quantity_l, delivery_date, delivered_at, requirement:bulk_requirements(milk_type))')
  .order('created_at', { ascending: false }).limit(100))
export const milkListings = async () => must(await supabase.from('products').select('*').eq('area_manager_id', await mySellerId()).eq('category', 'milk'))
export const createListing = async (type, price, litres, description) => must(await supabase.from('products').insert({
  name: `Fresh ${({ cow: 'cow', buffalo: 'buffalo', mixed: 'mixed' })[type]} milk`, category: 'milk', milk_type: type, unit: 'litre',
  price: Number(price), listed_l: Number(litres), description: description || null, is_available: true,
}).select().single())
// the discount is not set here: it changes only after a retest (retestListing, then setListingDiscount)
export const saveListing = async (l) => must(await supabase.from('products').update({
  price: Number(l.price), is_available: !!l.is_available,
  listed_l: Number(l.listed_l) || 0, description: l.description || null,
}).eq('id', l.id))
// retest milk still on the app; returns the ai's suggested discount, or takes failed milk off the app
export const retestListing = (productId, readingId) => rpc('retest_listing', { p_product: productId, p_reading: readingId })
export const setListingDiscount = (retestId, pct) => rpc('set_listing_discount', { p_retest: retestId, p_pct: Number(pct) })
export const stockGrade = (centerId, type) => rpc('listing_grade', { p_center: centerId, p_type: type })

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
// the farmer answers at the center; the area manager records it
export const recordFarmerAnswer = (id, accept) => rpc('record_farmer_answer', { p_id: id, p_accept: accept })
export const cancelCollection = (id, reason) => rpc('cancel_collection', { p_id: id, p_reason: reason })
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
export const demoDeliveryCode = (kind, id) => rpc('demo_delivery_code', { p_kind: kind, p_order: id })
// ---------- the real iot device (esp32 → firebase → edge function → device_readings) ----------
export const myDevice = async () => must(await supabase.from('iot_devices').select('*').maybeSingle())
export const deviceLog = async (limit = 12) => must(await supabase.from('device_readings').select('*').order('received_at', { ascending: false }).limit(limit))
// a device test runs about a minute: start, a sample every few seconds, then the server averages them
async function iot(body) { return callFunction('iot-reading', body) }
// edge functions return { error } in the body; show that message rather than a generic one
async function callFunction(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let msg = name === 'iot-reading' ? 'Could not reach the device service. Check your internet and try again.'
      : error.context?.status === 404 ? `The ${name} function is not deployed on Supabase yet.` : 'Could not reach ApnaDairy. Check your internet and try again.'
    try { const b = await error.context?.json?.(); if (b?.error) msg = b.error } catch { /* keep the general message */ }
    throw new Error(msg)
  }
  if (data?.error) throw new Error(data.error)
  return data
}
export const startDeviceTest = () => iot({ action: 'start' })
// ---------- super admins ----------
export const allAdmins = async () => must(await supabase.from('profiles').select('id, full_name, email, phone, status, created_at').eq('role', 'super_admin').order('created_at'))
// emails an account holder about their account (send-email edge function). kind: 'account_rejected' or 'account_approved'
export const sendAccountEmail = (userId, kind) => callFunction('send-email', { user_id: userId, kind })
export const createAdmin = (a) => callFunction('admin-users', { full_name: a.full_name, email: a.email, password: a.password }).then((d) => d.admin)
export const removeAdmin = (id) => rpc('set_admin', { p_user: id, p_make_admin: false })
export const takeDeviceSample = (session) => iot({ action: 'sample', session }).then((d) => d.sample)
export const finishDeviceTest = (session) => iot({ action: 'finish', session }).then((d) => d.reading)
// ---------- any date, listings, bulk capacity, admin ----------
export const myFirstDay = () => rpc('my_first_day')
export const dayBook = (day) => rpc('center_day_book', { p_day: day })
export const farmerUsual = (farmerId) => rpc('farmer_usual_litres', { p_farmer: farmerId })
export const bidCapacity = (type, date, requirementId, grade) => rpc('my_bid_capacity', { p_type: type, p_delivery: date, p_requirement: requirementId ?? null, p_grade: grade ?? 'standard' })
export const adminAnalytics = (days = 30) => rpc('admin_analytics', { p_days: days })
export const deviceActivity = () => rpc('device_activity')
export const allDevices = async () => must(await supabase.from('iot_devices').select('*, center:area_managers(id, center_name, city)').order('serial'))
export const saveDevice = async (d) => must(await supabase.from('iot_devices').upsert({
  serial: d.serial.trim().toUpperCase(), db_url: d.db_url.trim().replace(/\/$/, ''), path: 'Result', label: d.label?.trim() || null, is_active: d.is_active ?? true,
}).select().single())
export const assignDevice = (serial, centerId) => rpc('assign_device', { p_serial: serial, p_center: centerId })
export const activeCenters = async () => must(await supabase.from('area_managers').select('id, center_name, city').eq('type', 'milk_center').eq('verification_status', 'active').order('center_name'))
export const payoutStatusLabel = { sent: 'Waiting for farmer', confirmed: 'Confirmed', disputed: 'Disputed by farmer' }
export const payoutTone = { sent: 'amber', confirmed: 'green', disputed: 'red' }
