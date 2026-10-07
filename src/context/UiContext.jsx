import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { niceError } from '../lib/validate'

// app-wide toasts and confirm dialogs (replaces window.alert / window.confirm)
const UiContext = createContext(null)

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [dialog, setDialog] = useState(null)
  const resolver = useRef(null)

  const toast = useCallback((text, type = 'success') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t, { id, text: type === 'error' ? niceError(text) : text, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  // usage: if (!(await confirm({ title, body, confirmLabel, danger }))) return
  // with input: 'placeholder' the promise resolves to the typed text (or true if left empty)
  // inputRequired: n  makes the text required, at least n characters
  const confirm = useCallback((opts) => new Promise((resolve) => {
    resolver.current = resolve
    setDialog(opts)
  }), [])

  const [text, setText] = useState('')
  const close = (answer) => { resolver.current?.(answer && dialog?.input ? text.trim() || true : answer); setDialog(null); setText('') }

  return (
    <UiContext.Provider value={{ toast, confirm }}>
      {children}

      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:inset-x-auto sm:right-6 sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`pointer-events-auto flex max-w-sm animate-rise items-start gap-3 rounded-2xl px-4 py-3 text-[14.5px] shadow-[0_12px_30px_-12px_rgb(23_58_40/.45)] ${
            t.type === 'error' ? 'bg-danger text-white' : 'bg-forest-deep text-cream'}`}>
            <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${t.type === 'error' ? 'bg-white text-danger' : 'bg-haldi text-forest-deep'}`}>
              {t.type === 'error' ? '!' : '✓'}
            </span>
            {t.text}
          </div>
        ))}
      </div>

      {dialog && (
        <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
          <div className="absolute inset-0 bg-forest-deep/40 backdrop-blur-[2px]" onClick={() => close(false)} />
          <div className="relative w-full max-w-md animate-pop rounded-3xl bg-surface p-6 shadow-2xl">
            <h2 id="dlg-title" className="display text-[24px]">{dialog.title}</h2>
            {dialog.body && <p className="mt-2 text-muted">{dialog.body}</p>}
            {dialog.input && (
              <>
                <textarea className="input mt-4 w-full" rows={3} maxLength={300} placeholder={dialog.input} value={text} onChange={(e) => setText(e.target.value)} />
                {dialog.inputRequired && <p className={`mt-1 text-[12.5px] ${text.trim().length >= dialog.inputRequired ? 'text-muted' : 'text-danger'}`}>Required, at least {dialog.inputRequired} characters.</p>}
              </>
            )}
            <div className="mt-6 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => close(false)} autoFocus>{dialog.cancelLabel ?? 'Go back'}</button>
              <button className={dialog.danger ? 'btn-danger' : 'btn-primary'} disabled={!!dialog.inputRequired && text.trim().length < dialog.inputRequired} onClick={() => close(true)}>{dialog.confirmLabel ?? 'Confirm'}</button>
            </div>
          </div>
        </div>
      )}
    </UiContext.Provider>
  )
}

export const useUi = () => useContext(UiContext)
