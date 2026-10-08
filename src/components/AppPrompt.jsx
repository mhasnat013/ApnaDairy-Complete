import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import ProductImage from './ProductImage'

// the website is view only: buying happens in the ApnaDairy mobile app
export default function AppPrompt({ item, onClose }) {
  const [soon, setSoon] = useState(false)
  useEffect(() => {
    if (!item) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [item, onClose])
  if (!item) return null
  return createPortal(
    <div className="fixed inset-0 z-[70] grid place-items-center p-4" role="dialog" aria-modal="true" aria-labelledby="app-prompt-title">
      <div className="absolute inset-0 bg-forest-deep/45 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative w-full max-w-[420px] animate-pop overflow-hidden rounded-[28px] bg-surface shadow-2xl">
        <div className="furrows relative bg-forest-deep px-6 pb-6 pt-7 text-cream">
          <button onClick={onClose} className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-full bg-cream/10 hover:bg-cream/20" aria-label="Close"><Icon name="x" size={17} /></button>
          <ProductImage category={item.category ?? 'milk'} size={56} className="ring-4 ring-cream/15" />
          <h2 id="app-prompt-title" className="display mt-4 text-[28px] leading-tight">Want to purchase {item.category && item.category !== 'milk' ? 'dairy products' : 'milk'}?</h2>
          <p className="mt-2 text-[15px] text-cream/80">Download the ApnaDairy mobile app to order and purchase dairy products{item.shop_name ? `, like ${item.name.toLowerCase()} from ${item.shop_name}` : ''}.</p>
        </div>
        <div className="grid gap-2.5 p-6">
          {soon && (
            <p className="flex items-start gap-2 rounded-2xl bg-haldi-soft px-4 py-3 text-[14px] text-amber" role="status">
              <Icon name="clock" size={16} className="mt-0.5 shrink-0" />The ApnaDairy app is coming soon to Google Play. Until then you can keep browsing here.
            </p>
          )}
          <button className="btn-primary h-12 w-full" onClick={() => setSoon(true)}><Icon name="phone" size={17} />Get the ApnaDairy App</button>
          <button className="btn-secondary h-12 w-full" onClick={onClose}>Continue browsing</button>
          <p className="text-center text-[12.5px] text-muted">The website is for browsing. Orders and payments happen in the app.</p>
        </div>
      </div>
    </div>,
    document.body,
  )
}
