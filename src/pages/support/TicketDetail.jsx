import { useEffect, useRef, useState } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { useLoad } from '../../lib/useLoad'
import { supportThread, replyTicket, setTicketStatus, topics, ticketState, orderText } from '../../lib/support'
import { roleLabel } from '../../lib/roles'
import { rs, date, dateTime, cap } from '../../lib/format'
import { qtyText, perUnit } from '../../lib/b2b'
import PageHeader from '../../components/PageHeader'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Loader from '../../components/Loader'
import ProductImage from '../../components/ProductImage'

// one ticket: the conversation, a reply box and the details. used by admins, sellers and buyers.
export default function TicketDetail() {
  const { id } = useParams()
  const { profile } = useAuth()
  const { toast, confirm } = useUi()
  const { refreshSupport } = useOutletContext() ?? {}
  const admin = profile.role === 'super_admin'
  const list = admin ? '/admin/complaints' : profile.role === 'business' ? '/business/support' : '/manager/support'
  const { data, loading, error, reload } = useLoad(() => supportThread(id), [id])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const end = useRef(null)
  const count = data?.messages?.length ?? 0
  useEffect(() => { if (count) end.current?.scrollIntoView({ block: 'nearest' }) }, [count])

  if (loading && !data) return <Loader />
  if (error || !data?.ticket) return (
    <>
      <PageHeader back={{ to: list, label: admin ? 'Complaints & support' : 'Support' }} title="Ticket not found" />
      <Alert>{error || 'This ticket does not exist, or you cannot see it.'}</Alert>
    </>
  )

  const t = data.ticket
  const viewer = admin ? 'admin' : t.mine ? 'user' : 'seller'
  const st = ticketState(t, viewer)
  const resolved = t.status === 'resolved'
  const canChange = admin || t.mine
  const canReply = !(viewer === 'seller' && resolved)
  const o = t.order_info

  const send = async (e) => {
    e.preventDefault()
    if (!text.trim()) return setErr('Write a message first.')
    setErr(''); setBusy(true)
    try { await replyTicket(t.id, text); setText(''); await reload(); refreshSupport?.() } catch (e2) { setErr(e2.message) }
    setBusy(false)
  }
  const change = async (status) => {
    if (status === 'resolved' && !(await confirm({ title: 'Mark this ticket resolved?', body: t.mine ? 'Do this once your problem is sorted. You can still write again to reopen it.' : 'The person who opened it can still write again to reopen it.', confirmLabel: 'Mark resolved' }))) return
    setBusy(true)
    try { await setTicketStatus(t.id, status); await reload(); refreshSupport?.(); toast(status === 'resolved' ? 'Ticket resolved.' : 'Ticket reopened.') } catch (e2) { toast(e2.message, 'error') }
    setBusy(false)
  }

  return (
    <>
      <PageHeader back={{ to: admin ? list : `${list}${viewer === 'seller' ? '?tab=about' : ''}`, label: admin ? 'Complaints & support' : 'Support' }}
        title={t.subject} description={`Ticket #${t.ticket_no} · ${topics[t.topic]} · opened ${date(t.created_at)}`}>
        {canChange && !resolved && <button className="btn-secondary" onClick={() => change('resolved')} disabled={busy}>Mark resolved</button>}
        {canChange && resolved && <button className="btn-secondary" onClick={() => change('open')} disabled={busy}>Reopen</button>}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="panel flex min-w-0 flex-col p-0">
          <ol className="flex flex-col gap-4 p-4 sm:p-6" aria-label="Messages">
            {data.messages.map((m) => {
              const own = viewer === 'admin' ? m.side === 'admin' : m.mine
              return (
                <li key={m.id} className={`flex max-w-[88%] flex-col gap-1 sm:max-w-[78%] ${own ? 'items-end self-end' : 'items-start'}`}>
                  <p className="flex items-center gap-1.5 px-1 text-[12.5px] text-muted">
                    {m.side === 'admin' && !own && <span className="rounded-full bg-haldi px-1.5 py-px text-[10.5px] font-bold text-forest-deep">ApnaDairy</span>}
                    <span className="font-semibold text-ink/80">{own && viewer !== 'admin' ? 'You' : m.author}</span>
                    <span className="num">{dateTime(m.created_at)}</span>
                  </p>
                  <p className={`whitespace-pre-wrap break-words rounded-[18px] px-4 py-3 text-[14.5px] leading-relaxed ${own ? 'rounded-br-md bg-forest text-cream' : m.side === 'admin' ? 'rounded-bl-md bg-haldi-soft text-ink' : 'rounded-bl-md bg-cream-2 text-ink'}`}>{m.body}</p>
                </li>
              )
            })}
            <li ref={end} aria-hidden />
          </ol>

          <div className="mt-auto border-t border-line p-4 sm:p-5">
            {resolved && <p className="mb-3 rounded-2xl bg-cream px-4 py-3 text-[13.5px] text-muted">
              {viewer === 'seller' ? 'This ticket is resolved.' : t.mine ? 'This ticket is resolved. Write again if the problem is back, and it opens again.' : 'Resolved. Replying opens it again.'}
            </p>}
            {canReply && (
              <form onSubmit={send} noValidate className="grid gap-3">
                <Alert>{err}</Alert>
                <label htmlFor="reply" className="sr-only">Your reply</label>
                <textarea id="reply" className="input min-h-[96px] py-3" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={viewer === 'seller' ? 'Reply to the buyer. ApnaDairy sees this too.' : viewer === 'admin' ? 'Reply as ApnaDairy support' : 'Write a reply'} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[12.5px] text-muted">{viewer === 'seller' ? 'Only the buyer or ApnaDairy can mark this resolved.' : ''}</span>
                  <button className="btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send reply'}</button>
                </div>
              </form>
            )}
          </div>
        </section>

        <aside className="space-y-4 lg:sticky lg:top-10 lg:self-start">
          <div className="panel p-5">
            <div className="flex items-center justify-between gap-3"><p className="text-[13px] text-muted">Status</p><Badge tone={st.tone}>{st.label}</Badge></div>
            <dl className="mt-4 grid gap-3 text-[14px]">
              <Row k="Opened by" v={<>{t.opener_org || t.opener_name}<span className="block text-[12.5px] font-normal text-muted">{t.opener_org ? `${t.opener_name}, ` : ''}{t.opener_role === 'area_manager' ? 'Area manager' : roleLabel[t.opener_role] ?? cap(t.opener_role)}</span></>} />
              {admin && t.opener_email && <Row k="Email" v={<a href={`mailto:${t.opener_email}`} className="text-forest hover:underline">{t.opener_email}</a>} />}
              {admin && t.opener_phone && <Row k="Phone" v={<a href={`tel:${t.opener_phone}`} className="num text-forest hover:underline">{t.opener_phone}</a>} />}
              {t.center_name && <Row k="About" v={t.center_name} />}
              <Row k="Last update" v={<span className="num">{dateTime(t.updated_at)}</span>} />
              {resolved && t.resolved_at && <Row k="Resolved" v={<span className="num">{dateTime(t.resolved_at)}</span>} />}
            </dl>
          </div>

          {o && (
            <div className="panel p-5">
              <p className="text-[13px] text-muted">The order</p>
              {o.kind === 'bulk' ? (
                <div className="mt-3 flex items-start gap-3">
                  <ProductImage category={o.product} size={48} />
                  <div className="min-w-0 text-[14px]">
                    <p className="font-semibold">{orderText(o).replace('Bulk order: ', '')}</p>
                    <p className="num text-muted">{qtyText(o.quantity, o.unit)} at {rs(o.price)}/{perUnit(o.unit)}</p>
                    <p className="text-muted">{o.buyer} from {o.seller}</p>
                    <p className="mt-1"><Badge status={o.status} /></p>
                  </div>
                </div>
              ) : (
                <div className="mt-3 text-[14px]">
                  <p className="font-semibold">{orderText(o)}</p>
                  <p className="text-muted">{o.buyer} from {o.seller}</p>
                  <p className="mt-1"><Badge status={o.status} /></p>
                </div>
              )}
              {!admin && o.kind === 'bulk' && <Link to={profile.role === 'business' ? '/business/orders' : '/manager/bulk-orders'} className="mt-3 inline-block text-[13.5px] font-semibold text-forest hover:underline">Open bulk orders</Link>}
            </div>
          )}
        </aside>
      </div>
    </>
  )
}

const Row = ({ k, v }) => (
  <div className="flex justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
)
