import { useState, Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { navFor } from '../lib/nav'
import { useLoad } from '../lib/useLoad'
import { myCenter } from '../lib/center'
import { supportWaiting } from '../lib/support'
import { roleLabel } from '../lib/roles'
import Logo from '../components/Logo'
import Icon from '../components/Icon'
import Loader from '../components/Loader'
import NotificationBell from '../components/NotificationBell'

export default function DashboardLayout() {
  const { profile, signOut } = useAuth()
  const [open, setOpen] = useState(false)
  // area managers are milk centers or byproduct sellers; each gets its own menu
  const { data: center } = useLoad(() => (profile.role === 'area_manager' ? myCenter(profile.id).catch(() => null) : Promise.resolve(null)), [profile.id, profile.role])
  const key = profile.role === 'area_manager' && center?.type === 'byproduct' ? 'byproduct' : profile.role
  const nav = profile.role === 'area_manager' && !center ? [] : navFor[key] ?? []
  const items = nav.filter((i) => i.ready)
  const later = nav.filter((i) => !i.ready)
  const base = profile.role === 'super_admin' ? '/admin' : profile.role === 'business' ? '/business' : '/manager'
  const { pathname } = useLocation()
  const { data: waiting, reload: refreshSupport } = useLoad(() => supportWaiting(), [pathname, profile.id])
  const initials = profile.full_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase()

  const sidebar = (
    <div className="furrows flex h-full flex-col bg-forest-deep text-cream">
      <div className="flex items-center justify-between gap-2 pb-8 pl-6 pr-3 pt-6"><Logo light /><span className="hidden lg:block"><NotificationBell light /></span></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3" aria-label="Main">
        {items.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} onClick={() => setOpen(false)}
            className={({ isActive }) =>
              `group flex items-center gap-3 rounded-full px-4 py-2.5 text-[14.5px] transition-all ${
                isActive ? 'bg-cream font-semibold text-forest-deep shadow-[0_6px_16px_-10px_rgb(0_0_0/.6)]' : 'text-cream/75 hover:bg-cream/10 hover:text-cream'}`}>
            {({ isActive }) => (
              <>
                <span className={`grid h-7 w-7 place-items-center rounded-full transition-colors ${isActive ? 'bg-haldi text-forest-deep' : 'bg-cream/5 group-hover:bg-cream/10'}`}>
                  <Icon name={i.icon} size={15} />
                </span>
                <span className="flex-1">{i.label}</span>
                {i.support && waiting > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-haldi px-1.5 text-[11.5px] font-bold text-forest-deep" aria-label={`${waiting} waiting`}>{waiting}</span>}
              </>
            )}
          </NavLink>
        ))}
        {later.length > 0 && (
          <div className="pt-7">
            <p className="px-4 pb-2 text-[12.5px] text-cream/45">Coming soon</p>
            {later.map((i) => (
              <div key={i.to} className="flex items-center gap-3 px-4 py-2 text-[14px] text-cream/40">
                <span className="grid h-7 w-7 place-items-center"><Icon name={i.icon} size={15} /></span>{i.label}
              </div>
            ))}
          </div>
        )}
      </nav>
      <div className="m-3 flex items-center gap-3 rounded-2xl bg-cream/5 p-3">
        <NavLink to={`${base}/account`} onClick={() => setOpen(false)} className="flex min-w-0 flex-1 items-center gap-3 rounded-xl transition-colors hover:bg-cream/5" title="My account">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-haldi text-[14px] font-bold text-forest-deep">{initials}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-semibold">{profile.full_name}</span>
            <span className="block truncate text-[12.5px] text-cream/60">{key === 'byproduct' ? 'Dairy seller' : roleLabel[profile.role]} · My account</span>
          </span>
        </NavLink>
        <button onClick={signOut} className="rounded-full p-2 text-cream/60 transition-colors hover:bg-cream/10 hover:text-cream" aria-label="Sign out" title="Sign out">
          <Icon name="logout" size={17} />
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-full lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>

      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-forest-deep/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[272px] animate-rise">{sidebar}</div>
        </div>
      )}

      <div className="min-w-0">
        <header className="flex h-16 items-center gap-3 border-b border-line bg-cream px-4 lg:hidden">
          <button onClick={() => setOpen(true)} aria-label="Open menu" className="btn-ghost h-10 w-10 p-0"><Icon name="menu" /></button>
          <Logo />
          <span className="ml-auto"><NotificationBell /></span>
        </header>
        <main className="mx-auto max-w-[1180px] px-4 py-8 sm:px-8 lg:py-10"><Suspense fallback={<Loader />}><Outlet context={{ center, refreshSupport }} /></Suspense></main>
      </div>
    </div>
  )
}
