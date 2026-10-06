import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'

// side panel on desktop, bottom sheet on phones. used for short forms.
// drawn on <body> so a moving or transformed parent card cannot trap it
export default function Sheet({ open, title, subtitle, onClose, children, footer, wide = false }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-[65]" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-forest-deep/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`absolute inset-x-0 bottom-0 flex max-h-[92svh] flex-col rounded-t-[28px] bg-surface shadow-2xl animate-rise sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-full sm:rounded-none sm:rounded-l-[28px] ${wide ? 'sm:max-w-[560px]' : 'sm:max-w-[460px]'}`}>
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
          <div>
            <h2 className="display text-[24px] text-forest-deep">{title}</h2>
            {subtitle && <p className="mt-1 text-[14px] text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="btn-ghost h-10 w-10 shrink-0 p-0" aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
