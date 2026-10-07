import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { allAdmins, inviteAdmin, resendAdminInvite, cancelAdminInvite, adminInvites, removeAdmin } from '../../lib/center'
import { date, relative } from '../../lib/format'
import { nameError, emailError, phoneError, firstError, prettyPhone } from '../../lib/validate'
import PageHeader from '../../components/PageHeader'
import Card from '../../components/Card'
import Badge from '../../components/Badge'
import Alert from '../../components/Alert'
import Icon from '../../components/Icon'
import Sheet from '../../components/Sheet'
import { SkeletonRows } from '../../components/Skeleton'

// super admins get their own accounts. area managers, businesses and farmers are never turned into admins.
export default function Admins() {
  const { profile: me } = useAuth()
  const { toast, confirm } = useUi()
  const { data: all, error, loading, reload } = useLoad(async () => {
    const [admins, invites] = await Promise.all([allAdmins(), adminInvites().catch(() => [])])
    return { admins, invites }
  })
  const data = all?.admins
  const invites = all?.invites ?? []
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(null)
  const active = (data ?? []).filter((a) => a.status === 'active')

  const remove = async (a) => {
    if (!(await confirm({ title: `Remove ${a.full_name} as admin?`, body: 'Their account is switched off and they can no longer sign in to the admin portal.', confirmLabel: 'Remove admin', danger: true, cancelLabel: 'Keep' }))) return
    setBusy(a.id)
    try { await removeAdmin(a.id); toast(`${a.full_name} is no longer an admin.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }
  const resend = async (i) => {
    setBusy(i.user_id)
    try { await resendAdminInvite(i.user_id); toast(`Invite sent again to ${i.email}.`) } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }
  const cancel = async (i) => {
    if (!(await confirm({ title: `Cancel the invite for ${i.full_name}?`, body: 'The link in their email stops working.', confirmLabel: 'Cancel invite', danger: true, cancelLabel: 'Keep' }))) return
    setBusy(i.user_id)
    try { await cancelAdminInvite(i.user_id); toast('Invite cancelled.'); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Admins" description="People who run ApnaDairy. New admins are invited by email and become admins only after they open the link. Other accounts can never be turned into admins.">
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={17} />Invite admin</button>
      </PageHeader>
      <Alert>{error}</Alert>
      <Card title={`${active.length} active ${active.length === 1 ? 'admin' : 'admins'}`} subtitle="Admins approve accounts, manage billing, devices and market rates, and see everything on the platform." bodyClass="pt-3">
        <div className="overflow-x-auto">
          <table className="table min-w-[620px]">
            <thead><tr><th>Admin</th><th>Phone</th><th>Since</th><th>Status</th><th /></tr></thead>
            <tbody>
              {loading && !data && <SkeletonRows cols={5} />}
              {(data ?? []).map((a) => (
                <tr key={a.id}>
                  <td><p className="font-semibold">{a.full_name}{a.id === me.id && <span className="ml-2 text-[12px] font-normal text-muted">(you)</span>}</p><p className="text-[13px] text-muted">{a.email}</p></td>
                  <td className="num text-muted">{a.phone ?? '—'}</td>
                  <td className="num text-muted">{date(a.created_at)}</td>
                  <td><Badge status={a.status} /></td>
                  <td className="text-right">{a.id !== me.id && a.status === 'active' && (
                    <button className="btn-ghost btn-sm text-danger" disabled={busy === a.id} onClick={() => remove(a)}>Remove</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {invites.length > 0 && (
        <Card className="mt-4 sm:mt-5" title={`${invites.length} ${invites.length === 1 ? 'invite' : 'invites'} not opened yet`} subtitle="They become admins once they open the email link and set a password." bodyClass="pt-3">
          <div className="overflow-x-auto">
            <table className="table min-w-[620px]">
              <thead><tr><th>Invited</th><th>Sent</th><th /></tr></thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.user_id}>
                    <td><p className="font-semibold">{i.full_name}</p><p className="text-[13px] text-muted">{i.email}</p></td>
                    <td className="text-muted">{relative(i.invited_at)}</td>
                    <td className="text-right">
                      <button className="btn-secondary btn-sm" disabled={busy === i.user_id} onClick={() => resend(i)}>Send again</button>
                      <button className="btn-ghost btn-sm ml-2 text-danger" disabled={busy === i.user_id} onClick={() => cancel(i)}>Cancel</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {adding && <AdminSheet onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  )
}

function AdminSheet({ onClose, onSaved }) {
  const { toast } = useUi()
  const [f, setF] = useState({ full_name: '', email: '', phone: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    const bad = firstError(nameError(f.full_name, 'full name'), emailError(f.email), phoneError(f.phone, { required: true }))
    if (bad) return setErr(bad)
    setErr(''); setBusy(true)
    try {
      const a = await inviteAdmin({ ...f, full_name: f.full_name.trim(), email: f.email.trim().toLowerCase(), phone: prettyPhone(f.phone) })
      toast(`Invite sent to ${a.email}. ${a.full_name} becomes an admin after opening it.`); onSaved(); onClose()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <Sheet open onClose={onClose} title="Invite an admin" subtitle="They get an email with a link. Opening it confirms their email; then they set their own password and become an admin."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="admin-form" disabled={busy}>{busy ? 'Sending…' : 'Send invite'}</button></>}>
      <form id="admin-form" onSubmit={submit} noValidate className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="an">Full name</label><input id="an" className="input" maxLength={80} value={f.full_name} onChange={set('full_name')} autoFocus /></div>
        <div className="field"><label htmlFor="ae">Email</label><input id="ae" className="input" type="email" maxLength={120} autoComplete="off" value={f.email} onChange={set('email')} />
          <span className="hint">Must be a new address. An area manager or business account can never become an admin.</span></div>
        <div className="field"><label htmlFor="aph">Mobile number</label><input id="aph" className="input num" type="tel" inputMode="tel" maxLength={16} placeholder="0300 1234567" value={f.phone} onChange={set('phone')} />
          <span className="hint">For records only. No SMS is sent.</span></div>
        <p className="rounded-2xl bg-haldi-soft px-4 py-3 text-[13px] text-amber">Admins can approve or suspend anyone and change platform rules. Invite only people who run ApnaDairy.</p>
      </form>
    </Sheet>
  )
}
