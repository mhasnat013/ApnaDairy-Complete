import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { myNotifications, markNotificationsRead, flushEmailOutbox } from '../lib/notify'
import { relative } from '../lib/format'
import Sheet from './Sheet'
import Icon from './Icon'

// the bell in the dashboard menu: unread count, and the list in a side panel
export default function NotificationBell({ light = false }) {
  const [list, setList] = useState([])
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const nav = useNavigate()

  useEffect(() => {
    let alive = true
    const load = () => myNotifications().then((l) => alive && setList(l)).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => { alive = false; clearInterval(t) }
  }, [pathname])
  useEffect(() => { flushEmailOutbox() }, [])

  const unread = list.filter((n) => !n.read_at).length
  const readAll = async () => {
    try { await markNotificationsRead(); setList((l) => l.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))) } catch { /* try again later */ }
  }
  const go = async (n) => {
    if (!n.read_at) markNotificationsRead([n.id]).catch(() => {})
    setList((l) => l.map((x) => (x.id === n.id ? { ...x, read_at: x.read_at ?? new Date().toISOString() } : x)))
    if (n.link) { setOpen(false); nav(n.link) }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label={unread ? `Notifications, ${unread} new` : 'Notifications'} title="Notifications"
        className={`relative grid h-10 w-10 place-items-center rounded-full transition-colors ${light ? 'text-cream/80 hover:bg-cream/10 hover:text-cream' : 'text-forest hover:bg-cream-2'}`}>
        <Icon name="bell" size={19} />
        {unread > 0 && <span className="num absolute right-0.5 top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-haldi px-1 text-[10.5px] font-bold text-forest-deep">{unread > 9 ? '9+' : unread}</span>}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Notifications" subtitle={unread ? `${unread} new` : 'You are all caught up.'}
        footer={unread > 0 ? <button className="btn-secondary" onClick={readAll}>Mark all as read</button> : null}>
        {list.length === 0 && <p className="py-10 text-center text-muted">Nothing yet. Updates about your account, orders and bids show up here.</p>}
        <ul className="grid gap-2">
          {list.map((n) => (
            <li key={n.id}>
              <button onClick={() => go(n)} className={`w-full rounded-2xl px-4 py-3 text-left transition-colors ${n.read_at ? 'bg-surface hover:bg-cream' : 'bg-haldi-soft/60 hover:bg-haldi-soft'}`}>
                <span className="flex items-start justify-between gap-3">
                  <span className={`text-[14.5px] ${n.read_at ? 'font-medium' : 'font-semibold'}`}>{n.title}</span>
                  <span className="num shrink-0 text-[12px] text-muted">{relative(n.created_at)}</span>
                </span>
                {n.body && <span className="mt-0.5 block whitespace-pre-line text-[13.5px] text-muted">{n.body}</span>}
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    </>
  )
}
