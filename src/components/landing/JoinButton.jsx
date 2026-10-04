import { Link } from 'react-router-dom'

const Arrow = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
)

// header call to action: gold light round the edge, letters roll into gold on hover
export default function JoinButton({ to = '/signup', label = 'Join ApnaDairy' }) {
  const follow = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`)
    e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`)
  }
  return (
    <Link to={to} className="jb" onMouseMove={follow} aria-label={label}>
      <span className="jb-beam" aria-hidden="true" />
      <span className="jb-roll" aria-hidden="true">
        {[...label].map((c, i) => {
          const ch = c === ' ' ? ' ' : c
          return <span key={i} style={{ '--i': i }} data-c={ch}>{ch}</span>
        })}
      </span>
      <span className="jb-badge" aria-hidden="true"><Arrow /><Arrow /></span>
      <i className="jb-spark s1" aria-hidden="true" />
      <i className="jb-spark s2" aria-hidden="true" />
      <i className="jb-spark s3" aria-hidden="true" />
    </Link>
  )
}
