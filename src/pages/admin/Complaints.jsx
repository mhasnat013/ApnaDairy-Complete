import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { supportInbox, topics, ticketState } from '../../lib/support'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import StatCard, { StatRow } from '../../components/StatCard'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import EmptyState from '../../components/EmptyState'
import { SkeletonBlock } from '../../components/Skeleton'
import { TicketRow } from '../support/Support'

// every ticket on the platform. admins reply, and resolve once it is sorted.
export default function Complaints() {
  const { data, loading, error } = useLoad(supportInbox, [])
  const [tab, setTab] = useState('open')
  const [topic, setTopic] = useState('')
  const [q, setQ] = useState('')

  const rows = data ?? []
  const open = rows.filter((t) => t.status === 'open')
  const answered = rows.filter((t) => t.status === 'answered')
  const resolved = rows.filter((t) => t.status === 'resolved')
  const orderComplaints = rows.filter((t) => t.center_id && t.status !== 'resolved').length
  const byTab = { open, answered, resolved, all: rows }[tab]
  const needle = q.trim().toLowerCase()
  const shown = byTab.filter((t) => (!topic || t.topic === topic) && (!needle || [t.subject, t.opener_name, t.opener_org, t.center_name, String(t.ticket_no)]
    .some((s) => s?.toLowerCase().includes(needle))))
  const oldest = open.length ? Math.max(...open.map((t) => (Date.now() - new Date(t.last_at ?? t.updated_at)) / 36e5)) : 0

  return (
    <>
      <PageHeader title="Complaints & support" description="Tickets from businesses and area managers. Complaints about an order are also shown to that seller, who can reply. Only you or the person who opened a ticket can resolve it." />

      <div className="mb-6"><StatRow cols={3}>
        <StatCard label="Need a reply" value={open.length} tone={open.length ? 'haldi' : 'plain'} note={open.length ? `Oldest waiting ${oldest < 1 ? 'under an hour' : oldest < 48 ? `${Math.round(oldest)} hours` : `${Math.round(oldest / 24)} days`}` : 'All caught up'} />
        <StatCard label="Open order complaints" value={orderComplaints} note="About a seller's order" />
        <StatCard label="Resolved" value={resolved.length} note={`${rows.length} tickets in all`} />
      </StatRow></div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'open', label: 'Needs reply', count: open.length },
          { value: 'answered', label: 'Replied', count: answered.length },
          { value: 'resolved', label: 'Resolved', count: resolved.length },
          { value: 'all', label: 'All', count: rows.length },
        ]} />
        <div className="flex flex-1 flex-wrap gap-2 sm:justify-end">
          <label className="relative min-w-[200px] flex-1 sm:max-w-[260px]">
            <span className="sr-only">Search tickets</span>
            <Icon name="search" size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
            <input className="input pl-10" placeholder="Search name, subject, #" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="input w-auto" value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="Topic">
            <option value="">Any topic</option>
            {Object.entries(topics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <Alert>{error}</Alert>
      <div className="grid gap-3">
        {loading && !data && [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-[92px] rounded-[20px]" />)}
        {!loading && shown.length === 0 && (
          <div className="panel"><EmptyState title={tab === 'open' && !needle && !topic ? 'Nothing waiting for a reply' : 'No tickets here'}>
            {tab === 'open' && !needle && !topic ? 'New tickets from businesses and area managers show up here.' : 'Try another tab, topic or search.'}
          </EmptyState></div>
        )}
        {shown.map((t) => <TicketRow key={t.id} t={t} to={`/admin/complaints/${t.id}`} viewer="admin" showFrom />)}
      </div>
      {shown.some((t) => ticketState(t, 'admin').waiting) && <p className="mt-4 text-[13px] text-muted">Tickets with a yellow edge are waiting for ApnaDairy.</p>}
    </>
  )
}
