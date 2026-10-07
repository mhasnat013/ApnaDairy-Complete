import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useUi } from '../../context/UiContext'
import { SkeletonRows } from '../../components/Skeleton'
import PageHeader from '../../components/PageHeader'
import Alert from '../../components/Alert'
import Badge from '../../components/Badge'
import Segmented from '../../components/Segmented'
import EmptyState from '../../components/EmptyState'
import { date, cap } from '../../lib/format'
import DocsDrawer from '../../components/DocsDrawer'
import { hasRequiredDocs } from '../../lib/docs'
import { sendAccountEmail, removeRejectedAccount, rejectedApplications } from '../../lib/center'

const tabs = [
  { id: 'area_manager', label: 'Area Managers', table: 'area_managers', fk: 'area_managers_user_id_fkey' },
  { id: 'business', label: 'Businesses', table: 'business_profiles', fk: 'business_profiles_user_id_fkey' },
]
const statuses = ['pending', 'active', 'rejected', 'suspended']


export default function Approvals() {
  const [tab, setTab] = useState(tabs[0])
  const [status, setStatus] = useState('pending')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [docsByUser, setDocsByUser] = useState({})
  const [viewing, setViewing] = useState(null)
  const [history, setHistory] = useState([])
  const { toast, confirm } = useUi()

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from(tab.table)
      .select(`*, profile:profiles!${tab.fk}(full_name, email, phone)`)
      .eq('verification_status', status)
      .order('created_at', { ascending: false })
    setError(error?.message ?? '')
    setRows(data ?? [])
    // rejected applications whose login was removed (the email can sign up again)
    setHistory(status === 'rejected' ? await rejectedApplications(tab.id).catch(() => []) : [])

    // document counts for the listed applicants
    const ids = (data ?? []).map((r) => r.user_id)
    if (ids.length) {
      const { data: docs } = await supabase.from('verification_documents').select('user_id, doc_type').in('user_id', ids)
      const grouped = {}
      ;(docs ?? []).forEach((d) => { (grouped[d.user_id] ??= []).push(d) })
      setDocsByUser(grouped)
    }
    setLoading(false)
  }, [tab, status])

  useEffect(() => { load() }, [load])

  const act = async (row, next) => {
    const name = row.center_name ?? row.business_name
    let reason = null
    if (next !== 'active') {
      const rejecting = next === 'rejected'
      const answer = await confirm({
        title: rejecting ? `Reject ${name}?` : `Suspend ${name}?`,
        body: rejecting ? 'Say why. The reason is emailed to them, then their account is removed so they can apply again later with the same email.' : 'They lose access to the portal until you reactivate them.',
        input: rejecting ? 'e.g. The CNIC photo is not clear and the utility bill is for a different address.' : 'Reason (optional, shown to them)',
        inputRequired: rejecting ? 10 : undefined,
        confirmLabel: rejecting ? 'Reject' : 'Suspend', danger: true,
      })
      if (!answer) return
      reason = typeof answer === 'string' ? answer : null
    }
    const { error } = await supabase.rpc('set_verification', { p_kind: tab.id, p_id: row.id, p_status: next, p_reason: reason })
    if (error) return toast(error.message, 'error')
    const reactivated = next === 'active' && row.verification_status === 'suspended'
    if (next === 'rejected' || (next === 'active' && !reactivated)) {
      // tell them by email too; the decision stands even if the email cannot be sent
      const done = next === 'active' ? 'approved' : 'rejected'
      let sent = null
      try {
        sent = await sendAccountEmail(row.user_id, next === 'active' ? 'account_approved' : 'account_rejected')
      } catch (e) {
        toast(next === 'rejected'
          ? `${name} rejected, but the email was not sent (${e.message}). Their account stays so they can read the reason when they sign in. Remove it from the Rejected tab later.`
          : `${name} approved, but the email was not sent: ${e.message}`, 'error')
      }
      if (sent && next === 'rejected') {
        // the reason reached them, so free the email for a new application
        try { await removeRejectedAccount(row.user_id); toast(`${name} rejected. Email sent to ${sent.to}, and they can sign up again later.`) }
        catch (e) { toast(`${name} rejected and emailed, but the account could not be removed: ${e.message}`, 'error') }
      } else if (sent) toast(`${name} ${done}. Email sent to ${sent.to}.`)
    } else {
      toast(reactivated ? `${name} reactivated.` : `${name} suspended.`)
    }
    load()
  }

  const removeOld = async (r) => {
    const name = r.center_name ?? r.business_name
    if (!(await confirm({ title: `Remove ${name}'s account?`, body: 'The rejection stays in your records below. Their login is removed, so they can sign up again with the same email.', confirmLabel: 'Remove account', danger: true }))) return
    try { await removeRejectedAccount(r.user_id); toast(`${name} removed. The email can sign up again.`); load() } catch (e) { toast(e.message, 'error') }
  }

  return (
    <>
      <PageHeader title="Approvals" description="Area managers and businesses can only use the portal after you check their details and documents." />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented value={tab.id} onChange={(id) => setTab(tabs.find((t) => t.id === id))}
          options={tabs.map((t) => ({ value: t.id, label: t.label }))} />
        <Segmented value={status} onChange={setStatus} options={statuses.map((s) => ({ value: s, label: cap(s) }))} />
      </div>

      <Alert>{error}</Alert>

      <div className="panel mt-3 overflow-x-auto">
        <table className="table min-w-[860px]">
          <thead>
            <tr>
              <th>{tab.id === 'area_manager' ? 'Center' : 'Business'}</th>
              <th>Owner</th>
              <th>City</th>
              <th>Documents</th>
              <th>Applied</th>
              <th>Status</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading && <SkeletonRows cols={7} />}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7}><EmptyState title={status === 'rejected' ? 'No rejected accounts waiting' : `No ${status} applications`}>{status === 'rejected' ? 'Rejected applicants are emailed and removed, and are listed below.' : 'New sign-ups appear under Pending.'}</EmptyState></td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <p className="font-semibold text-ink">{r.center_name ?? r.business_name}</p>
                  <p className="text-[13px] text-muted">
                    {tab.id === 'area_manager' ? (r.type === 'milk_center' ? 'Milk collection center' : 'Dairy byproducts') : cap(r.business_type)}
                  </p>
                </td>
                <td>
                  <p>{r.profile?.full_name}</p>
                  <p className="text-[13px] text-muted">{r.profile?.email}</p>
                  <p className="text-[13px] text-muted">{r.profile?.phone}</p>
                </td>
                <td>{r.city}</td>
                <td>
                  {(() => {
                    const docs = docsByUser[r.user_id] ?? []
                    const ok = hasRequiredDocs(docs, tab.id)
                    return (
                      <button onClick={() => setViewing(r)} className="text-left hover:underline">
                        <span className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${r.docs_submitted_at && ok ? 'bg-forest-2' : docs.length ? 'bg-amber' : 'bg-danger'}`} />
                          <span className="text-xs">{docs.length} file{docs.length === 1 ? '' : 's'}</span>
                        </span>
                        <span className={`text-xs ${r.docs_submitted_at ? 'text-forest' : 'text-amber'}`}>{r.docs_submitted_at ? 'Submitted' : ok ? 'Uploaded, not submitted' : 'Not submitted yet'}</span>
                      </button>
                    )
                  })()}
                </td>
                <td className="num text-muted">{date(r.created_at)}</td>
                <td>
                  <Badge status={r.verification_status} />
                  {r.verification_status !== 'active' && r.rejection_reason && <p className="mt-1 max-w-[220px] text-[12px] text-muted">{r.rejection_reason}</p>}
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    {r.verification_status === 'pending' && (
                      <button onClick={() => act(r, 'active')} className="btn-primary btn-sm" disabled={!r.docs_submitted_at}
                        title={r.docs_submitted_at ? undefined : 'They have not submitted their documents yet'}>Approve</button>
                    )}
                    {r.verification_status === 'suspended' && (
                      <button onClick={() => act(r, 'active')} className="btn-primary btn-sm">Reactivate</button>
                    )}
                    {r.verification_status === 'rejected' && <button onClick={() => removeOld(r)} className="btn-secondary btn-sm" title="Remove the login so this email can sign up again">Remove account</button>}
                    {r.verification_status === 'pending' && (
                      <button onClick={() => act(r, 'rejected')} className="btn-danger btn-sm">Reject</button>
                    )}
                    {r.verification_status === 'active' && (
                      <button onClick={() => act(r, 'suspended')} className="btn-secondary btn-sm">Suspend</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {status === 'rejected' && history.length > 0 && (
        <div className="panel mt-5 overflow-x-auto">
          <p className="px-5 pt-4 text-[13.5px] text-muted">Rejected and removed. Each of these emails can sign up again.</p>
          <table className="table min-w-[860px]">
            <thead><tr><th>{tab.id === 'area_manager' ? 'Center' : 'Business'}</th><th>Owner</th><th>City</th><th>Documents</th><th>Rejected</th><th>Reason</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td><p className="font-semibold text-ink">{h.place_name}</p><p className="text-[13px] text-muted">{cap(h.place_type)}</p></td>
                  <td><p>{h.full_name}</p><p className="text-[13px] text-muted">{h.email}</p><p className="text-[13px] text-muted">{h.phone}</p></td>
                  <td>{h.city}</td>
                  <td className="num text-[13px]">{h.documents} file{h.documents === 1 ? '' : 's'}</td>
                  <td className="num text-muted">{date(h.rejected_at)}</td>
                  <td className="max-w-[280px] text-[13px]">{h.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewing && <DocsDrawer row={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
