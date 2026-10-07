import { supabase } from './supabase'
import { qtyText, milkLabel, productLabel } from './b2b'
import { rs, date } from './format'

// complaints and support tickets (supabase/31_support.sql)
export const topics = {
  order: 'An order',
  quality: 'Milk or product quality',
  payment: 'A payment',
  billing: 'My ApnaDairy bill',
  account: 'My account or documents',
  app: 'Something is not working',
  other: 'Something else',
}
// topics each kind of account can pick
export const topicsFor = (role) =>
  role === 'business' ? ['order', 'quality', 'payment', 'account', 'app', 'other'] : ['order', 'payment', 'billing', 'account', 'app', 'other']

// what a ticket's status means to the person looking at it
export function ticketState(t, viewer) {
  if (t.status === 'resolved') return { label: 'Resolved', tone: 'grey', waiting: false }
  if (viewer === 'admin') return t.status === 'open' ? { label: 'Needs reply', tone: 'amber', waiting: true } : { label: 'Replied', tone: 'green', waiting: false }
  if (t.mine) return t.status === 'answered' ? { label: 'New reply', tone: 'amber', waiting: true } : { label: 'Waiting for reply', tone: 'blue', waiting: false }
  // a complaint about this seller's order
  return t.status === 'open' && t.last_side === 'user' ? { label: 'Needs your reply', tone: 'amber', waiting: true } : { label: 'Replied', tone: 'green', waiting: false }
}

// who wrote the last message, from the viewer's side ('user' | 'seller' | 'admin')
export function sideName(side, viewer) {
  if (side === 'admin') return viewer === 'admin' ? 'ApnaDairy' : 'ApnaDairy support'
  if (side === viewer) return 'You'
  return side === 'seller' ? 'Seller' : 'Customer'
}

// one line about the order a ticket is about
export function orderText(o) {
  if (!o) return ''
  if (o.kind === 'bulk') {
    const what = o.product === 'milk' ? (milkLabel[o.milk_type] ?? 'Milk').toLowerCase() : (productLabel[o.product] ?? 'Dairy').toLowerCase()
    return `Bulk order: ${qtyText(o.quantity, o.unit)} ${what}, ${date(o.date)}`
  }
  return `Shop order: ${rs(o.total)}, ${date(o.date)}`
}

export async function supportInbox() {
  const { data, error } = await supabase.rpc('support_inbox')
  if (error) throw error
  return data ?? []
}

export async function supportThread(id) {
  const { data, error } = await supabase.rpc('support_thread', { p_ticket: id })
  if (error) throw error
  return data
}

export async function openTicket({ topic, subject, body, bulkOrderId = null }) {
  const { data, error } = await supabase.rpc('open_ticket', {
    p_topic: topic, p_subject: subject.trim(), p_body: body.trim(), p_bulk_order_id: bulkOrderId || null, p_shop_order_id: null, p_center_id: null,
  })
  if (error) throw error
  return data
}

export async function replyTicket(id, body) {
  const { error } = await supabase.rpc('reply_ticket', { p_ticket: id, p_body: body.trim() })
  if (error) throw error
}

export async function setTicketStatus(id, status) {
  const { error } = await supabase.rpc('set_ticket_status', { p_ticket: id, p_status: status })
  if (error) throw error
}

// the number on the menu
export async function supportWaiting() {
  const { data, error } = await supabase.rpc('support_waiting')
  if (error) return 0
  return data ?? 0
}
