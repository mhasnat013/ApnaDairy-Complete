import { useEffect, useState } from 'react'
import { farmerPhotoUrl } from '../lib/farmers'

// the farmer's picture (private, so it loads through a short-lived link), or their initials
export default function FarmerPhoto({ path, name = '', size = 56, className = '' }) {
  const [url, setUrl] = useState(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    farmerPhotoUrl(path).then((u) => alive && (setUrl(u), setFailed(false))).catch(() => {})
    return () => { alive = false }
  }, [path])
  const initials = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const style = { width: size, height: size }
  if (url && !failed) return <a href={url} target="_blank" rel="noreferrer" className={`shrink-0 ${className}`} title="Open the picture"><img src={url} alt={name} style={style} onError={() => setFailed(true)} className="rounded-2xl object-cover" /></a>
  return <span style={style} className={`grid shrink-0 place-items-center rounded-2xl bg-forest text-[15px] font-bold text-cream ${className}`}>{initials || '?'}</span>
}
