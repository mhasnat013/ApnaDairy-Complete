import { supabase } from './supabase'

export const milkLabel = { cow: 'Cow milk', buffalo: 'Buffalo milk', mixed: 'Mixed milk' }
// bulk milk grades are the iot test grades (supabase/24_bulk_grades.sql)
export const qualityLabel = { standard: 'Standard', fresh: 'Fresh', premium: 'Premium' }
export const GRADES = ['standard', 'fresh', 'premium']
// what the dispatch test has to show
export const gradeRule = (q) => (q === 'premium' ? 'Premium' : `${qualityLabel[q] ?? 'Standard'} or better`)
export const gradeOk = (got, need) => GRADES.indexOf(got) >= GRADES.indexOf(need ?? 'standard')
export const qualityHint = {
  standard: 'Passes the IoT milk test',
  fresh: 'IoT quality score 82 or more',
  premium: 'IoT quality score 88 or more'
}
export const productQualityHint = { standard: 'Good everyday quality', premium: 'Best grade, pure and rich' }
export const orderSteps = ['confirmed', 'dispatched', 'delivered']

// what a business can ask for: fresh milk from milk centers, dairy products from byproduct sellers
export const productLabel = { milk: 'Milk', ghee: 'Desi ghee', butter: 'Butter', yogurt: 'Yogurt (dahi)', cheese: 'Cheese', cream: 'Cream', lassi: 'Lassi', other: 'Other dairy' }
export const PRODUCTS = ['ghee', 'butter', 'yogurt', 'cheese', 'cream', 'lassi', 'other']
export const defaultUnit = { ghee: 'kg', butter: 'kg', yogurt: 'kg', cheese: 'kg', cream: 'kg', lassi: 'litre', other: 'kg' }
const fmtN = (n) => Number(n).toLocaleString('en-PK', { maximumFractionDigits: 2 })
// "40 L", "12 kg", "6 packs"
export const qtyText = (n, unit = 'litre') => (n == null ? '—' : unit === 'kg' ? `${fmtN(n)} kg` : unit === 'pack' ? `${fmtN(n)} ${Number(n) === 1 ? 'pack' : 'packs'}` : `${fmtN(n)} L`)
export const perUnit = (unit = 'litre') => (unit === 'kg' ? 'kg' : unit === 'pack' ? 'pack' : 'L')
export const isMilk = (r) => !r?.product || r.product === 'milk'
// "400 L mixed milk", "50 kg desi ghee"
export const whatText = (r) => (isMilk(r) ? `${milkLabel[r.milk_type]?.toLowerCase() ?? 'milk'}` : productLabel[r.product]?.toLowerCase())
export const reqTitle = (r) => `${qtyText(r.quantity_l, r.unit)} ${whatText(r)}`

// litres already ordered on a requirement (several bids can cover one requirement)
export const coveredL = (req) => (req.orders ?? []).filter((o) => o.status !== 'cancelled').reduce((n, o) => n + Number(o.quantity_l), 0)
export const stillNeeded = (req) => Math.max(0, Number(req.quantity_l) - coveredL(req))
export const isExpired = (req) => req.status === 'open' && req.required_date < new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' })
const one = (x) => (Array.isArray(x) ? x[0] ?? null : x ?? null)

// the grade a milk bid or order really offers (it can be lower than the buyer asked for)
export const offeredGrade = (bid, req) => bid?.offered_quality ?? bid?.quality ?? req?.quality ?? 'standard'
export const lowerGrade = (bid, req) => isMilk(req) && GRADES.indexOf(offeredGrade(bid, req)) < GRADES.indexOf(req?.quality ?? 'standard')

// a bid "qualifies" when it covers the quantity still needed, arrives on time and offers the grade asked for
export function bidIssues(bid, req) {
  const issues = []
  if (lowerGrade(bid, req)) issues.push(`Offers ${qualityLabel[offeredGrade(bid, req)]} milk, you asked for ${qualityLabel[req.quality]}`)
  const need = req.orders ? stillNeeded(req) || Number(req.quantity_l) : Number(req.quantity_l)
  if (Number(bid.quantity_l) < need) issues.push(`Covers ${qtyText(bid.quantity_l, req.unit)} of ${qtyText(need, req.unit)}`)
  if (bid.delivery_date > req.required_date) issues.push('Arrives after your date')
  return issues
}

// best 3 qualifying bids by price, then everything else
export function rankBids(bids, req) {
  // accepted bids are already orders, so only bids still waiting are compared
  const live = bids.filter((b) => b.status === 'submitted')
  const byPrice = (a, b) => a.price_per_l - b.price_per_l || a.delivery_date.localeCompare(b.delivery_date)
  const qualifying = live.filter((b) => bidIssues(b, req).length === 0).sort(byPrice)
  const top = qualifying.slice(0, 3)
  const others = live.filter((b) => !top.includes(b)).sort(byPrice)
  return { top, others }
}

const BID_FIELDS = 'id, price_per_l, quantity_l, make_qty, delivery_date, max_age_hours, notes, status, created_at, updated_at, area_manager_id, offered_quality, removed_at, removed_reason'

// ---------- business ----------
export async function myRequirements() {
  const { data, error } = await supabase
    .from('bulk_requirements')
    .select('*, bids(id, status), orders:bulk_orders(quantity_l, status)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({ ...r, bid_count: r.bids.filter((b) => b.status === 'submitted').length }))
}

export async function requirementWithBids(id) {
  const { data, error } = await supabase
    .from('bulk_requirements')
    .select(`*, bids(${BID_FIELDS}, center:area_managers(center_name, city)), orders:bulk_orders(id, bid_id, quantity_l, status)`)
    .eq('id', id)
    .single()
  if (error) throw error
  const ids = [...new Set(data.bids.map((b) => b.area_manager_id))]
  const rec = ids.length ? await trackRecord(ids).catch(() => []) : []
  return { ...data, bids: data.bids.map((b) => ({ ...b, record: rec.find((r) => r.center_id === b.area_manager_id) ?? null })) }
}

// how each center has done: ai test results, on-time delivery and ratings from businesses
export async function trackRecord(ids) {
  const { data, error } = await supabase.rpc('center_track_record', { p_centers: ids })
  if (error) throw error
  return data ?? []
}

export async function businessOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*, center:area_managers(center_name, city), requirement:bulk_requirements(milk_type, quality, product, unit), review:bulk_reviews(rating, comment)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((o) => ({ ...o, review: one(o.review) }))
}

// ---------- milk center ----------
export async function requestBoard() {
  const { data, error } = await supabase.from('request_board').select('*').order('bid_deadline')
  if (error) throw error
  return data
}

export async function myBids() {
  const { data, error } = await supabase
    .from('bids')
    .select(`${BID_FIELDS}, requirement:bulk_requirements(id, milk_type, product, unit, quantity_l, required_date, delivery_city, target_price, status, bid_deadline)`)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data
}

export async function requirementForCenter(id) {
  const { data, error } = await supabase
    .from('bulk_requirements')
    .select('*, business:business_profiles(business_name, business_type, city)')
    .eq('id', id)
    .single()
  if (error) throw error
  const [{ data: bids }, { data: board }] = await Promise.all([
    supabase.from('bids').select(BID_FIELDS).eq('requirement_id', id),
    supabase.from('request_board').select('remaining_l').eq('id', id).maybeSingle(),
  ])
  return { ...data, my_bid: bids?.[0] ?? null, remaining_l: board ? Number(board.remaining_l) : null }
}

export async function centerOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*, buyer:business_profiles(business_name, business_type), requirement:bulk_requirements(milk_type, quality, product, unit), review:bulk_reviews(rating, comment)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((o) => ({ ...o, review: one(o.review) }))
}

// ---------- admin: the whole bulk market, and removing a request or a bid (soft, with a reason) ----------
export async function adminBulkMarket() {
  const { data, error } = await supabase.rpc('admin_bulk_market')
  if (error) throw error
  return data ?? []
}
export async function adminRemoveRequirement(id, reason) {
  const { error } = await supabase.rpc('admin_remove_requirement', { p_id: id, p_reason: reason })
  if (error) throw error
}
export async function adminRemoveBid(id, reason) {
  const { error } = await supabase.rpc('admin_remove_bid', { p_id: id, p_reason: reason })
  if (error) throw error
}

// ---------- open offers (visible to everyone) ----------
export async function publicBids(requirementId) {
  const { data, error } = await supabase
    .from('public_bids')
    .select('*')
    .eq('requirement_id', requirementId)
    .order('price_per_l')
  if (error) throw error
  return data
}

// ---------- actions (all checked again in the database) ----------
const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}
export const placeBid = (a) => rpc('place_bid', a)
export const myProductCapacity = (product, requirementId) => rpc('my_product_capacity', { p_product: product, p_requirement: requirementId ?? null })
export const withdrawBid = (id) => rpc('withdraw_bid', { p_bid: id })
export const acceptBid = (id) => rpc('accept_bid', { p_bid: id })
// what tested stock a bulk milk order would go out of (grade, test time, freshness)
export const myDispatchStock = (orderId) => rpc('my_dispatch_stock', { p_order: orderId })
export const cancelRequirement = (id) => rpc('cancel_requirement', { p_requirement: id })
export const rateOrder = (id, rating, comment) => rpc('rate_bulk_order', { p_order: id, p_rating: rating, p_comment: comment || null })
// returns null when done, or a message when the delivery code was wrong
export const updateBulkOrder = (id, status, code, readingId) => rpc('update_bulk_order', { p_order: id, p_status: status, p_code: code ?? null, p_reading: readingId ?? null })
export const myDeliveryCodes = async () => { const { data, error } = await supabase.from('delivery_codes').select('order_id, code').eq('order_kind', 'bulk'); if (error) throw error; return data }
