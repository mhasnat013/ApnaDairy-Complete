import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext'
import { homeFor } from '../../lib/roles'
import Logo from '../Logo'
import Icon from '../Icon'
import JoinButton from './JoinButton'

const links = [
  ['/#how', 'How it works'],
  ['/#modules', 'Platform'],
  ['/requests', 'Bulk requests'],
  ['/#who', "Who it's for"],
]

export default function PublicHeader() {
  const { profile } = useAuth()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header className={`sticky top-0 z-50 transition-all duration-300 ${scrolled ? 'bg-cream/90 shadow-[0_1px_0_var(--color-line)] backdrop-blur-md' : 'bg-cream'}`}>
      <div className="mx-auto flex h-[68px] max-w-[1320px] items-center justify-between gap-4 px-4 sm:px-8">
        <Link to="/" aria-label="ApnaDairy home"><Logo /></Link>
        <nav className="hidden items-center gap-1 lg:flex" aria-label="Site">
          {links.map(([to, label]) => (
            <a key={to} href={to} className="rounded-full px-4 py-2 text-[14.5px] font-medium text-ink/80 transition-colors hover:bg-cream-2 hover:text-ink">{label}</a>
          ))}
        </nav>
        <div className="flex items-center gap-3">
          {!profile && (
            <Link to="/login" className="btn-ghost btn-sm hidden sm:inline-flex">Sign in</Link>
          )}
          <JoinButton to={profile ? homeFor(profile.role) : '/signup'} />
          <button className="btn-ghost h-10 w-10 p-0 lg:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>
        </div>
      </div>
      {open && (
        <nav className="animate-rise border-t border-line bg-cream px-4 pb-4 lg:hidden" aria-label="Site">
          {[...links, ...(profile ? [] : [['/login', 'Sign in']])].map(([to, label]) => (
            <a key={to} href={to} onClick={() => setOpen(false)} className="block rounded-xl px-3 py-3 text-[16px] font-medium hover:bg-cream-2">{label}</a>
          ))}
        </nav>
      )}
    </header>
  )
}
