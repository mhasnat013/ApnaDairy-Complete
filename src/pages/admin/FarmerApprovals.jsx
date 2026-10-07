import { useCallback, useEffect, useState } from 'react'
import { useUi } from '../../context/UiContext'
import { farmerApplications, setFarmerStatus } from '../../lib/farmers'
import { flushEmailOutbox } from '../../lib/notify'
import { milkLabel } from '../../lib/center'
import { date } from '../../lib/format'
import Alert from '../../components/Alert'
import Badge from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import FarmerPhoto from '../../components/FarmerPhoto'

// farmers who signed up in the app: the admin checks the picture and details, then approves or rejects.
// approved farmers choose their own milk center in the app; the admin never assigns them.
export default function FarmerApprovals({ status }) {
  const { toast, confirm } = useUi()
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try { setRows(await farmerApplications(status)); setError('') } catch (e) { setError(e.message); setRows([]) }
  }, [status])
  useEffect(() => { load() }, [load])

  const act = async (f, next) => {
    let reason = null
    if (next === 'rejected') {
      const answer = await confirm({ title: `Reject ${f.full_name}?`, body: 'Say why. The farmer sees it in the app and by email, and can fix the details and send them again.',
        input: 'e.g. The picture is not clear. Send a photo of yourself in good light.', inputRequired: 10, confirmLabel: 'Reject', danger: true })
      if (!answer) return
      reason = typeof answer === 'string' ? answer : null
    } else if (next === 'suspended') {
      if (!(await confirm({ title: `Suspend ${f.full_name}?`, body: 'They cannot use the app until you reactivate them.', confirmLabel: 'Suspend', danger: true }))) return
    }
    setBusy(f.user_id)
    try {
      await setFarmerStatus(f.user_id, next, reason)
      toast(next === 'active' ? (f.status === 'suspended' ? `${f.full_name} reactivated.` : `${f.full_name} approved. They can now choose a milk center in the app.`)
        : next === 'rejected' ? `${f.full_name} rejected. They were told why.` : `${f.full_name} suspended.`)
      flushEmailOutbox()
      await load()
    } catch (e) { toast(e.message, 'error') }
    setBusy(null)
  }

  if (!rows) return <div className="grid gap-3 md:grid-cols-2">{[0, 1].map((i) => <div key={i} className="skeleton h-[230px] rounded-[20px]" />)}</div>
  return (
    <>
      <Alert>{error}</Alert>
      {rows.length === 0 && (
        <div className="panel"><EmptyState title={`No ${status} farmers`}>
          {status === 'pending' ? 'Farmers sign up in the ApnaDairy app with their picture and farm details. They show up here for you to check.' : 'Nothing here yet.'}
        </EmptyState></div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((f) => (
          <article key={f.user_id} className={`panel p-5 ${busy === f.user_id ? 'pointer-events-none opacity-60' : ''}`}>
            <div className="flex items-start gap-4">
              <FarmerPhoto path={f.photo_path} name={f.full_name} size={76} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-[17px] font-semibold">{f.full_name}</p>
                  <Badge status={f.status} />
                </div>
                <p className="num text-[13.5px] text-muted">{f.phone ?? 'No phone'}</p>
                <p className="truncate text-[13.5px] text-muted">{f.email}</p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl bg-cream px-4 py-3 text-[13.5px]">
              <div><dt className="text-[12px] text-muted">Location</dt><dd className="font-medium">{[f.village, f.city].filter(Boolean).join(', ') || 'Not given'}</dd>
                {f.address && <dd className="text-[12.5px] text-muted">{f.address}</dd>}
                {f.latitude != null && <dd><a className="text-[12.5px] font-semibold text-forest hover:underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${f.latitude},${f.longitude}`}>Open on map</a></dd>}</div>
              <div><dt className="text-[12px] text-muted">Farm</dt><dd className="font-medium">{f.farm_name || 'No farm name'}</dd></div>
              <div><dt className="text-[12px] text-muted">Animals and milk</dt><dd className="font-medium">{f.cattle_count ?? '—'} cattle · {milkLabel[f.milk_type] ?? 'Milk'}</dd></div>
              <div><dt className="text-[12px] text-muted">Milk a day</dt><dd className="num font-medium">{f.daily_litres != null ? `About ${Number(f.daily_litres)} L` : 'Not given'}</dd></div>
              <div><dt className="text-[12px] text-muted">Registered</dt><dd className="num font-medium">{date(f.registered_at)}</dd></div>
              <div><dt className="text-[12px] text-muted">Details sent</dt><dd className={`num font-medium ${f.submitted_at ? '' : 'text-amber'}`}>{f.submitted_at ? date(f.submitted_at) : 'Not yet'}</dd></div>
              {f.notes && <div className="col-span-2"><dt className="text-[12px] text-muted">Notes</dt><dd>{f.notes}</dd></div>}
              {f.center_name && <div className="col-span-2"><dt className="text-[12px] text-muted">Sells to</dt><dd className="font-medium">{f.center_name}</dd></div>}
            </dl>
            {f.rejection_reason && status === 'rejected' && <p className="mt-3 rounded-2xl bg-[#f8e2dc] px-4 py-2.5 text-[13px] text-danger"><b>Reason:</b> {f.rejection_reason}. Waiting for them to send new details.</p>}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              {f.status === 'pending' && <>
                <button className="btn-danger btn-sm" onClick={() => act(f, 'rejected')}>Reject</button>
                <button className="btn-primary btn-sm" onClick={() => act(f, 'active')} disabled={!f.submitted_at || !f.photo_path}
                  title={f.submitted_at ? undefined : 'They have not sent their details and picture yet'}>Approve</button>
              </>}
              {f.status === 'active' && <button className="btn-secondary btn-sm" onClick={() => act(f, 'suspended')}>Suspend</button>}
              {f.status === 'suspended' && <button className="btn-primary btn-sm" onClick={() => act(f, 'active')}>Reactivate</button>}
            </div>
          </article>
        ))}
      </div>
    </>
  )
}
