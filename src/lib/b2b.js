import { supabase } from './supabase'

export const milkLabel = { cow: 'Cow milk', buffalo: 'Buffalo milk', mixed: 'Mixed milk' }
export const qualityLabel = { fresh: 'Farm fresh', standard: 'Standard', premium: 'Premium' }
export const qualityHint = {
  fresh: 'Milked the same day',
  standard: 'Regular raw milk',
  premium: 'Best grade, rich and creamy',
}
export const orderSteps = ['confirmed', 'dispatched', 'delivered']

// a bid "qualifies" when it covers the full quantity, arrives on time,
// and — for farm fresh requests — promises milk under 24 hours old
export function bidIssues(bid, req) {
  const issues = []
  if (Number(bid.quantity_l) < Number(req.quantity_l)) issues.push(`Only ${Number(bid.quantity_l)} of ${Number(req.quantity_l)} L`)
  if (bid.delivery_date > req.required_date) issues.push('Arrives after your date')
  if (req.quality === 'fresh' && (!bid.max_age_hours || bid.max_age_hours > 24)) issues.push('Not same-day milk')
  return issues
}

export const freshnessText = (h) => (h ? `Under ${h} h old on arrival` : 'Freshness not stated')

// best 3 qualifying bids by price, then everything else
export function rankBids(bids, req) {
  const live = bids.filter((b) => b.status === 'submitted' || b.status === 'accepted')
  const byPrice = (a, b) => a.price_per_l - b.price_per_l || a.delivery_date.localeCompare(b.delivery_date)
  const qualifying = live.filter((b) => bidIssues(b, req).length === 0).sort(byPrice)
  const top = qualifying.slice(0, 3)
  const others = live.filter((b) => !top.includes(b)).sort(byPrice)
  return { top, others }
}

const BID_FIELDS = 'id, price_per_l, quantity_l, delivery_date, max_age_hours, notes, status, created_at, updated_at, area_manager_id'

// ---------- business ----------
export async function myRequirements() {
  const { data, error } = await supabase
    .from('bulk_requirements')
    .select('*, bids(id, status)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data.map((r) => ({ ...r, bid_count: r.bids.filter((b) => b.status === 'submitted' || b.status === 'accepted').length }))
}

export async function requirementWithBids(id) {
  const { data, error } = await supabase
    .from('bulk_requirements')
    .select(`*, bids(${BID_FIELDS}, center:area_managers(center_name, city))`)
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function businessOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*, center:area_managers(center_name, city), requirement:bulk_requirements(milk_type, quality)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
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
    .select(`${BID_FIELDS}, requirement:bulk_requirements(id, milk_type, quantity_l, required_date, delivery_city, target_price, status, bid_deadline)`)
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
  const { data: bids } = await supabase.from('bids').select(BID_FIELDS).eq('requirement_id', id)
  return { ...data, my_bid: bids?.[0] ?? null }
}

export async function centerOrders() {
  const { data, error } = await supabase
    .from('bulk_orders')
    .select('*, buyer:business_profiles(business_name, business_type), requirement:bulk_requirements(milk_type, quality)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
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
export const withdrawBid = (id) => rpc('withdraw_bid', { p_bid: id })
export const acceptBid = (id) => rpc('accept_bid', { p_bid: id })
export const cancelRequirement = (id) => rpc('cancel_requirement', { p_requirement: id })
// returns null when done, or a message when the delivery code was wrong
export const updateBulkOrder = (id, status, code) => rpc('update_bulk_order', { p_order: id, p_status: status, p_code: code ?? null })
export const myDeliveryCodes = async () => { const { data, error } = await supabase.from('delivery_codes').select('order_id, code').eq('order_kind', 'bulk'); if (error) throw error; return data }
