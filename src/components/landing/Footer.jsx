import { Link } from 'react-router-dom'
import Logo from '../Logo'

export default function Footer() {
  return (
    <footer className="mx-auto max-w-[1320px] px-4 py-14 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-10 border-t border-line pt-10">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3 text-[15px] text-muted">A dairy procurement and marketplace platform for Pakistan.</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2 text-[15px] sm:grid-cols-3 sm:gap-x-14" aria-label="Footer">
          <a href="/#how" className="text-muted hover:text-ink">How it works</a>
          <a href="/#modules" className="text-muted hover:text-ink">Platform</a>
          <Link to="/requests" className="text-muted hover:text-ink">Bulk requests</Link>
          <Link to="/signup" className="text-muted hover:text-ink">Join</Link>
          <Link to="/login" className="text-muted hover:text-ink">Sign in</Link>
          <a href="/#who" className="text-muted hover:text-ink">Who it's for</a>
          <Link to="/privacy" className="text-muted hover:text-ink">Privacy</Link>
          <Link to="/terms" className="text-muted hover:text-ink">Terms</Link>
        </nav>
      </div>
    </footer>
  )
}
