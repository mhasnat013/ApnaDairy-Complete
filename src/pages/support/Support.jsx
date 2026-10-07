import { useState } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import { supportInbox, openTicket, topics, topicsFor, ticketState, orderText, sideName } from '../../lib/support'
import { businessOrders, centerOrders, qtyText, whatText } from '../../lib/b2b'
import { relative, date } from '../../lib/format'
import PageHeader from '../../components/PageHeader'
import Segmented from '../../components/Segmented'
import Badge from '../../components/Badge'
import Sheet from '../../components/Sheet'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import ProductImage from '../../components/ProductImage'
import { SkeletonBlock } from '../../components/Skeleton'
import EmptyState from '../../components/EmptyState'

// businesses and area managers: their own tickets with apnadairy, and (sellers) complaints about their orders
export default function Support() {
  const { profile } = useAuth()
  const { center } = useOutletContext() ?? {}
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const seller = profile.role === 'area_manager'
  const base = seller ? '/manager' : '/business'
  const { data, loading, error, reload } = useLoad(supportInbox, [])
  const [tab, setTab] = useState(params.get('tab') === 'about' ? 'about' : 'mine')
  const newOpen = params.has('new')
  const closeNew = () => setParams((p) => { p.delete('new'); p.delete('order'); return p }, { replace: true })

  const rows = data ?? []
  const mine = rows.filter((t) => t.mine)
  const about = rows.filter((t) => t.about_me)
  const shown = tab === 'about' ? about : mine
  const waitingAbout = about.filter((t) => ticketState(t, 'seller').waiting).length

  return (
    <>
      <PageHeader title="Support" description={seller
        ? 'Ask ApnaDairy for help, and answer buyers who report a problem with your orders.'
        : 'Ask ApnaDairy for help or report a problem with an order. Replies show up here.'}>
        <button className="btn-primary" onClick={() => setParams({ new: '1' })}><Icon name="plus" size={16} /> New ticket</button>
      </PageHeader>

      {seller && (
        <div className="mb-5">
          <Segmented value={tab} onChange={setTab} options={[
            { value: 'mine', label: 'Your tickets', count: mine.length },
            { value: 'about', label: 'About your orders', count: waitingAbout || about.length },
          ]} />
        </div>
      )}

      <Alert>{error}</Alert>
      <div className="grid gap-3">
        {loading && !data && [0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-[92px] rounded-[20px]" />)}
        {!loading && shown.length === 0 && (
          <div className="panel">
            {tab === 'about'
              ? <EmptyState title="No complaints about your orders">When a buyer reports a problem with one of your orders, it shows here and you can reply.</EmptyState>
              : <EmptyState title="No tickets yet" action={<button className="btn-secondary btn-sm" onClick={() => setParams({ new: '1' })}>Open a ticket</button>}>
                  Stuck with something, or a problem with an order? Open a ticket and ApnaDairy will reply here.
                </EmptyState>}
          </div>
        )}
        {shown.map((t) => <TicketRow key={t.id} t={t} to={`${base}/support/${t.id}`} viewer={t.mine ? 'user' : 'seller'} />)}
      </div>

      <p className="mt-6 text-[13.5px] text-muted">
        Quick answers to common questions are on the <Link to={`${base}/help`} className="font-semibold text-forest hover:underline">Help</Link> page.
      </p>

      <NewTicket open={newOpen} onClose={closeNew} role={profile.role} center={center} presetOrder={params.get('order')}
        onDone={(id) => { reload(); nav(`${base}/support/${id}`) }} />
    </>
  )
}

export function TicketRow({ t, to, viewer, showFrom = false }) {
  const st = ticketState(t, viewer)
  // the last writer by name where we know it: the buyer's business, the seller's center, or apnadairy
  const who = t.last_side === viewer || t.last_side === 'admin' ? sideName(t.last_side, viewer)
    : t.last_side === 'seller' ? t.center_name || 'Seller' : t.opener_org || t.opener_name || 'Customer'
  const last = t.last_side ? `${who}: ` : ''
  return (
    <Link to={to} className={`panel group flex animate-rise items-start gap-4 p-4 transition-all hover:border-forest/40 sm:p-5 ${st.waiting ? 'ring-1 ring-haldi/60' : ''}`}>
      {t.order_info?.kind === 'bulk'
        ? <ProductImage category={t.order_info.product} size={44} />
        : <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-cream-2 text-forest"><Icon name="chat" size={19} /></span>}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-[15.5px] font-semibold text-ink group-hover:underline">{t.subject}</p>
          <Badge tone={st.tone}>{st.label}</Badge>
        </div>
        <p className="mt-0.5 text-[13px] text-muted">
          <span className="num">#{t.ticket_no}</span> · {topics[t.topic]}
          {showFrom && <> · {t.opener_org || t.opener_name}</>}
          {t.order_info && <> · {orderText(t.order_info)}</>}
        </p>
        {t.last_body && <p className="mt-2 line-clamp-2 text-[14px] text-ink/80"><span className="font-semibold">{last}</span>{t.last_body}</p>}
      </div>
      <span className="hidden shrink-0 text-[12.5px] text-muted sm:block">{relative(t.last_at ?? t.updated_at)}</span>
    </Link>
  )
}

function NewTicket({ open, onClose, role, center, presetOrder, onDone }) {
  const { toast } = useUi()
  const [f, setF] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: orders } = useLoad(() => (open ? (role === 'business' ? businessOrders() : centerOrders()).catch(() => []) : Promise.resolve(null)), [open, role])
  if (!open) return null
  const form = f ?? { topic: presetOrder ? 'order' : topicsFor(role)[0], subject: '', body: '', order: presetOrder ?? '' }
  const set = (k) => (e) => setF({ ...form, [k]: e.target.value })
  const orderTopic = ['order', 'quality', 'payment'].includes(form.topic)
  const close = () => { setF(null); setErr(''); onClose() }

  const submit = async (e) => {
    e.preventDefault()
    if (form.subject.trim().length < 3) return setErr('Write a short subject, like "Milk arrived late".')
    if (form.body.trim().length < 10) return setErr('Tell us what happened in a sentence or two.')
    setErr(''); setBusy(true)
    try {
      const id = await openTicket({ topic: form.topic, subject: form.subject, body: form.body, bulkOrderId: orderTopic ? form.order : null })
      toast('Ticket sent. ApnaDairy will reply here.')
      setF(null); onClose(); onDone(id)
    } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }

  const chosen = (orders ?? []).find((o) => o.id === form.order)
  return (
    <Sheet open title="New ticket" subtitle="Tell ApnaDairy what you need. We usually reply within a day." onClose={close}
      footer={<><button type="button" className="btn-secondary" onClick={close}>Cancel</button><button form="new-ticket" className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send ticket'}</button></>}>
      <form id="new-ticket" onSubmit={submit} noValidate className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="t-topic">What is it about?</label>
          <select id="t-topic" className="input" value={form.topic} onChange={set('topic')}>
            {topicsFor(role).map((k) => <option key={k} value={k}>{topics[k]}</option>)}
          </select></div>
        {orderTopic && (
          <div className="field"><label htmlFor="t-order">Which order? <span className="font-normal text-muted">(optional)</span></label>
            <select id="t-order" className="input" value={form.order} onChange={set('order')}>
              <option value="">Not about one order</option>
              {(orders ?? []).map((o) => (
                <option key={o.id} value={o.id}>
                  {qtyText(o.quantity_l, o.requirement?.unit)} {whatText(o.requirement ?? {})}, {role === 'business' ? o.center?.center_name : o.buyer?.business_name}, {date(o.delivery_date)}
                </option>
              ))}
            </select>
            {chosen && role === 'business' && <span className="hint">{chosen.center?.center_name} will see this ticket and can reply. Only you or ApnaDairy can mark it resolved.</span>}
            {chosen && role !== 'business' && <span className="hint">Only ApnaDairy sees this ticket, not the buyer.</span>}
          </div>
        )}
        <div className="field"><label htmlFor="t-subject">Subject</label>
          <input id="t-subject" className="input" maxLength={120} placeholder={form.topic === 'order' ? 'Milk arrived late' : 'Short summary'} value={form.subject} onChange={set('subject')} /></div>
        <div className="field"><label htmlFor="t-body">What happened?</label>
          <textarea id="t-body" className="input min-h-[140px] py-3" maxLength={2000} value={form.body} onChange={set('body')}
            placeholder="Give the details: what you expected, what happened, and when." />
          <span className="hint num">{form.body.length} / 2000</span></div>
        {center && role === 'area_manager' && <p className="text-[13px] text-muted">Sent as {center.center_name}.</p>}
      </form>
    </Sheet>
  )
}
