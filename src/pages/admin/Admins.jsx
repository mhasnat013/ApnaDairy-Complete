import { useState } from 'react'
import { useLoad } from '../../lib/useLoad'
import { useAuth } from '../../context/AuthContext'
import { useUi } from '../../context/UiContext'
import { allAdmins, createAdmin, removeAdmin } from '../../lib/center'
import { date } from '../../lib/format'
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
  const { data, error, loading, reload } = useLoad(allAdmins)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(null)
  const active = (data ?? []).filter((a) => a.status === 'active')

  const remove = async (a) => {
    if (!(await confirm({ title: `Remove ${a.full_name} as admin?`, body: 'Their account is switched off and they can no longer sign in to the admin portal.', confirmLabel: 'Remove admin', danger: true, cancelLabel: 'Keep' }))) return
    setBusy(a.id)
    try { await removeAdmin(a.id); toast(`${a.full_name} is no longer an admin.`); await reload() } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  return (
    <>
      <PageHeader title="Admins" description="People who run ApnaDairy. New admins get their own account here; other accounts can never be turned into admins.">
        <button className="btn-primary" onClick={() => setAdding(true)}><Icon name="plus" size={17} />Create admin</button>
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
      {adding && <AdminSheet onClose={() => setAdding(false)} onSaved={reload} />}
    </>
  )
}

function AdminSheet({ onClose, onSaved }) {
  const { toast } = useUi()
  const [f, setF] = useState({ full_name: '', email: '', password: '' })
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    if (f.full_name.trim().length < 3) return setErr('Enter the full name.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) return setErr('Enter a valid email address.')
    if (f.password.length < 8 || !/[0-9]/.test(f.password) || !/[a-zA-Z]/.test(f.password)) return setErr('The password needs at least 8 characters, with letters and numbers.')
    setBusy(true)
    try { const a = await createAdmin(f); toast(`${a.full_name} can now sign in as an admin.`); onSaved(); onClose() } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }
  return (
    <Sheet open onClose={onClose} title="Create admin" subtitle="A new account with full admin rights. Share the password with them privately."
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" form="admin-form" disabled={busy}>{busy ? 'Creating…' : 'Create admin'}</button></>}>
      <form id="admin-form" onSubmit={submit} className="grid gap-4">
        <Alert>{err}</Alert>
        <div className="field"><label htmlFor="an">Full name</label><input id="an" className="input" value={f.full_name} onChange={set('full_name')} autoFocus /></div>
        <div className="field"><label htmlFor="ae">Email</label><input id="ae" className="input" type="email" autoComplete="off" value={f.email} onChange={set('email')} /></div>
        <div className="field"><label htmlFor="ap">Password</label>
          <div className="flex gap-2"><input id="ap" className="input flex-1" type={show ? 'text' : 'password'} autoComplete="new-password" value={f.password} onChange={set('password')} />
            <button type="button" className="btn-secondary" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button></div>
          <span className="hint">At least 8 characters, with letters and numbers.</span></div>
        <p className="rounded-2xl bg-haldi-soft px-4 py-3 text-[13px] text-amber">Admins can approve or suspend anyone and change platform rules. Create admin accounts only for people who run ApnaDairy.</p>
      </form>
    </Sheet>
  )
}
