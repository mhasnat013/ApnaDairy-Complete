import { useUi } from '../../context/UiContext'
import { answerFarmerRequest } from '../../lib/farmers'
import { flushEmailOutbox } from '../../lib/notify'
import { milkLabel } from '../../lib/center'
import { date, relative } from '../../lib/format'
import Badge from '../../components/Badge'
import EmptyState from '../../components/EmptyState'
import FarmerPhoto from '../../components/FarmerPhoto'

const stateLabel = { pending: 'Waiting for you', accepted: 'Accepted', rejected: 'Declined', cancelled: 'Withdrawn by farmer', ended: 'Left your center' }
const stateTone = { pending: 'amber', accepted: 'green', rejected: 'red', cancelled: 'grey', ended: 'grey' }

// farmers approved by ApnaDairy ask to sell to this center; the center accepts or declines with a reason
export default function FarmerRequests({ rows, reload }) {
  const { toast, confirm } = useUi()
  const pending = rows.filter((r) => r.status === 'pending')
  const past = rows.filter((r) => r.status !== 'pending')

  const answer = async (r, accept) => {
    let reason = null
    if (accept) {
      if (!(await confirm({ title: `Accept ${r.full_name}?`, body: 'They join your farmers and can bring milk to your center. You test and price every can as usual.', confirmLabel: 'Accept farmer' }))) return
    } else {
      const a = await confirm({ title: `Decline ${r.full_name}?`, body: 'Tell them why. They see it in the app and can choose another center.',
        input: 'e.g. We have too many farmers right now', inputRequired: 3, confirmLabel: 'Decline', danger: true })
      if (!a) return
      reason = typeof a === 'string' ? a : null
    }
    try {
      await answerFarmerRequest(r.id, accept, reason)
      toast(accept ? `${r.full_name} is now one of your farmers.` : `${r.full_name} was told why.`)
      flushEmailOutbox()
      reload()
    } catch (e) { toast(e.message, 'error') }
  }

  return (
    <div className="grid gap-6">
      {pending.length === 0 && (
        <div className="panel"><EmptyState title="No requests waiting">Farmers approved by ApnaDairy find centers in their city in the app and ask to sell to you. Their requests show up here.</EmptyState></div>
      )}
      {pending.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {pending.map((r) => (
            <article key={r.id} className="panel animate-rise p-5 ring-1 ring-haldi/60">
              <div className="flex items-start gap-4">
                <FarmerPhoto path={r.photo_path} name={r.full_name} size={72} />
                <div className="min-w-0 flex-1">
                  <p className="text-[17px] font-semibold">{r.full_name}</p>
                  <p className="num text-[13.5px] text-muted">{r.phone}</p>
                  <p className="text-[13px] text-muted">Asked {relative(r.created_at)}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-2xl bg-cream px-4 py-3 text-[13.5px]">
                <div><dt className="text-[12px] text-muted">Lives in</dt><dd className="font-medium">{[r.village, r.city].filter(Boolean).join(', ')}</dd></div>
                <div><dt className="text-[12px] text-muted">Farm</dt><dd className="font-medium">{r.farm_name || '—'}</dd></div>
                <div><dt className="text-[12px] text-muted">Animals</dt><dd className="font-medium">{r.cattle_count} · {milkLabel[r.milk_type] ?? 'Milk'}</dd></div>
                <div><dt className="text-[12px] text-muted">Milk a day</dt><dd className="num font-medium">{r.daily_litres != null ? `About ${Number(r.daily_litres)} L` : 'Not given'}</dd></div>
                {r.approved_at && <div className="col-span-2"><dt className="text-[12px] text-muted">Checked by ApnaDairy</dt><dd className="num font-medium">{date(r.approved_at)}</dd></div>}
              </dl>
              {r.note && <p className="mt-3 rounded-2xl bg-mint-soft px-4 py-2.5 text-[14px]">“{r.note}”</p>}
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn-secondary btn-sm" onClick={() => answer(r, false)}>Decline</button>
                <button className="btn-primary btn-sm" onClick={() => answer(r, true)}>Accept farmer</button>
              </div>
            </article>
          ))}
        </div>
      )}
      {past.length > 0 && (
        <div className="panel overflow-x-auto">
          <p className="px-5 pt-4 text-[13.5px] font-semibold">Earlier requests</p>
          <table className="table min-w-[640px]">
            <thead><tr><th>Farmer</th><th>Asked</th><th>Answer</th><th>Reason</th></tr></thead>
            <tbody>
              {past.map((r) => (
                <tr key={r.id}>
                  <td><div className="flex items-center gap-3"><FarmerPhoto path={r.photo_path} name={r.full_name} size={36} /><div><p className="font-medium">{r.full_name}</p><p className="num text-[12.5px] text-muted">{r.phone}</p></div></div></td>
                  <td className="num text-muted">{date(r.created_at)}</td>
                  <td><Badge tone={stateTone[r.status]}>{stateLabel[r.status]}</Badge></td>
                  <td className="max-w-[260px] text-[13px] text-muted">{r.reason || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
