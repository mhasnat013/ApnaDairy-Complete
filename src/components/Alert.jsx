import { useEffect, useRef } from 'react'
import { niceError } from '../lib/validate'

export default function Alert({ type = 'error', children }) {
  const ref = useRef(null)
  const text = type === 'error' && typeof children === 'string' ? niceError(children) : children
  // a new message scrolls into view, so it is seen even at the bottom of a long form
  useEffect(() => {
    if (text && ref.current?.scrollIntoView) ref.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [text])
  if (!children) return null
  const styles = type === 'error' ? 'bg-[#f8e2dc] text-danger' : 'bg-mint-soft text-forest'
  return <div ref={ref} role="alert" className={`animate-pop rounded-2xl px-4 py-3 text-[14px] ${styles}`}>{text}</div>
}
