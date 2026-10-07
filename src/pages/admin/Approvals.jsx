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
      const answer = await confirm({
        title: next === 'rejected' ? `Reject ${name}?` : `Suspend ${name}?`,
        body: next === 'rejected' ? 'They will see that their application was not approved.' : 'They lose access to the portal until you reactivate them.',
        input: 'Reason (optional, shown to them)',
        confirmLabel: next === 'rejected' ? 'Reject' : 'Suspend', danger: true,
      })
      if (!answer) return
      reason = typeof answer === 'string' ? answer : null
    }
    const { error } = await supabase.rpc('set_verification', { p_kind: tab.id, p_id: row.id, p_status: next, p_reason: reason })
    if (error) return toast(error.message, 'error')
    toast(next === 'active' ? `${name} approved.` : next === 'rejected' ? `${name} rejected.` : `${name} suspended.`)
    load()
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
              <tr><td colSpan={7}><EmptyState title={`No ${status} applications`}>New sign-ups appear under Pending.</EmptyState></td></tr>
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
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    {r.verification_status !== 'active' && (
                      <button onClick={() => act(r, 'active')} className="btn-primary btn-sm" disabled={!r.docs_submitted_at}
                        title={r.docs_submitted_at ? undefined : 'They have not submitted their documents yet'}>Approve</button>
                    )}
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

      {viewing && <DocsDrawer row={viewing} onClose={() => setViewing(null)} />}
    </>
  )
}
