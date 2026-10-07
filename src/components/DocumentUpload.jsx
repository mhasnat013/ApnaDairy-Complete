import { useEffect, useState, useCallback } from 'react'
import { docLabel, docPlan, listDocs, uploadDoc, removeDoc, openDoc, missingDocs, requiredDocs, submitDocuments } from '../lib/docs'
import { useUi } from '../context/UiContext'
import Alert from './Alert'
import Badge from './Badge'
import Icon from './Icon'

// sign-up documents: upload every required one, then submit them once for the admin to review.
// after submitting they are locked (read-only).
export default function DocumentUpload({ profile, submitted, onSubmitted }) {
  const { confirm } = useUi()
  const plan = docPlan[profile.role] ?? []
  const [docs, setDocs] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try { setDocs(await listDocs(profile.id)) } catch (e) { setError(e.message) }
    setLoaded(true)
  }, [profile.id])

  useEffect(() => { load() }, [load])

  const onPick = async (type, e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setError(''); setBusy(type)
    try { await uploadDoc(profile.id, type, file); await load() } catch (err) { setError(err.message) }
    setBusy(null)
  }

  const onRemove = async (doc) => {
    setError(''); setBusy(doc.id)
    try { await removeDoc(doc); await load() } catch (err) { setError(err.message) }
    setBusy(null)
  }

  const missing = missingDocs(docs, profile.role)
  const need = requiredDocs(profile.role).length
  const done = need - missing.length

  const submit = async () => {
    const ok = await confirm({ title: 'Submit your documents?', body: 'ApnaDairy will review them. After submitting you cannot change them.', confirmLabel: 'Submit' })
    if (!ok) return
    setError(''); setBusy('submit')
    try { await submitDocuments(); onSubmitted?.() } catch (err) { setError(err.message) }
    setBusy(null)
  }

  return (
    <div className="panel p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="font-semibold text-ink">Verification documents</p>
        {submitted
          ? <Badge tone="green">Submitted</Badge>
          : <Badge tone={missing.length ? 'amber' : 'green'}>{done} of {need} uploaded</Badge>}
      </div>
      {!submitted && (
        <p className="mt-1 text-[12.5px] text-muted">
          All documents marked required are needed before you can submit. JPG, PNG or PDF, up to 5 MB each.
        </p>
      )}

      <div className="mt-3"><Alert>{error}</Alert></div>

      <ul className="mt-1 divide-y divide-line/70">
        {plan.map((slot) => {
          const mine = docs.filter((d) => d.doc_type === slot.type)
          if (submitted && !mine.length) return null
          return (
            <li key={slot.type} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm">
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full ${mine.length ? 'bg-forest text-cream' : 'border border-line'}`}>
                    {mine.length > 0 && <Icon name="check" size={12} />}
                  </span>
                  {docLabel[slot.type]}
                  {slot.required && !mine.length && <span className="text-xs text-danger">required</span>}
                  {!slot.required && <span className="text-xs text-muted">optional</span>}
                </p>
                {!submitted && (
                  <label className={`btn-secondary btn-sm cursor-pointer ${busy === slot.type ? 'pointer-events-none opacity-50' : ''}`}>
                    {busy === slot.type ? 'Uploading…' : mine.length ? 'Add another' : 'Upload'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                      onChange={(e) => onPick(slot.type, e)} />
                  </label>
                )}
              </div>
              {mine.map((d) => (
                <div key={d.id} className="mt-2 flex items-center gap-3 rounded-lg bg-cream-2 px-3 py-2">
                  <button onClick={() => openDoc(d)} className="flex-1 truncate text-left text-[13px] text-forest hover:underline">
                    {d.file_name}
                  </button>
                  {!submitted && (
                    <button onClick={() => onRemove(d)} disabled={busy === d.id} className="text-[11px] text-danger hover:underline">
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </li>
          )
        })}
      </ul>

      {!submitted && loaded && (
        <div className="mt-4 border-t border-line pt-4">
          {missing.length > 0 && (
            <p className="mb-3 text-[13px] text-muted">Still needed: {missing.map((t) => docLabel[t]).join(', ')}.</p>
          )}
          <button className="btn-primary w-full" disabled={missing.length > 0 || busy === 'submit'} onClick={submit}>
            {busy === 'submit' ? 'Submitting…' : 'Submit documents'}
          </button>
        </div>
      )}
    </div>
  )
}
