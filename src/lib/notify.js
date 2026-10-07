import { supabase } from './supabase'
import { callFunction } from './center'

// the notification inbox (supabase/34_notifications.sql)
export async function myNotifications() {
  const { data, error } = await supabase.from('notifications').select('id, kind, title, body, link, created_at, read_at')
    .order('created_at', { ascending: false }).limit(40)
  if (error) throw error
  return data ?? []
}

export async function markNotificationsRead(ids = null) {
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
  if (error) throw error
}

// emails waiting in the database go out through the send-email function; quiet if it is not set up
let flushing = null
export function flushEmailOutbox() {
  if (!flushing) flushing = callFunction('send-email', { kind: 'outbox' }).catch(() => null).finally(() => { setTimeout(() => { flushing = null }, 15000) })
  return flushing
}
