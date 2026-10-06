import { useEffect, useRef, useState } from 'react'
import Reveal from './Reveal'

// the illustrated farm-to-home film (source in tools/journey-animation)
// on laptops and desktops the film alone fills one screen: the 16:9 frame takes
// the full height (width follows from it, never wider than the page), with even padding.
// 40px = top + bottom padding of the section
const FILM_W = 'lg:w-[min(100%,calc((100svh-68px-40px)*16/9))]'

export default function Journey() {
  const video = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(true)
  const userPaused = useRef(false)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const scrubbing = useRef(false)

  // smooth progress: follow the film every frame (only re-renders when the time actually moves)
  useEffect(() => {
    const v = video.current
    if (!v) return
    let raf = 0, last = -1
    const tick = () => {
      if (!scrubbing.current && Math.abs(v.currentTime - last) > 0.04) { last = v.currentTime; setTime(last) }
      raf = requestAnimationFrame(tick)
    }
    const meta = () => setDur(v.duration || 0)
    if (v.readyState >= 1) meta()
    v.addEventListener('loadedmetadata', meta)
    v.addEventListener('durationchange', meta)
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); v.removeEventListener('loadedmetadata', meta); v.removeEventListener('durationchange', meta) }
  }, [])

  // plays when the film is in view, pauses once the visitor scrolls past it,
  // and starts again from the beginning when they come back to it
  useEffect(() => {
    const v = video.current
    if (!v) return
    let left = false
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio >= 0.55) {
        if (left) { v.currentTime = 0; userPaused.current = false; left = false }
        if (!userPaused.current) v.play().then(() => setPlaying(true)).catch(() => {})
      } else if (e.intersectionRatio < 0.2 && !v.paused) {
        v.pause(); setPlaying(false); left = true
      } else if (e.intersectionRatio < 0.2) {
        left = true
      }
    }, { threshold: [0, 0.2, 0.55, 1] })
    io.observe(v)
    return () => io.disconnect()
  }, [])

  const togglePlay = () => {
    const v = video.current
    if (!v) return
    if (v.paused) { v.play(); setPlaying(true); userPaused.current = false } else { v.pause(); setPlaying(false); userPaused.current = true }
  }
  // jump to any moment: click or drag along the bar, or use the arrow keys
  const seek = (e) => {
    const v = video.current
    if (!v) return
    const t = Number(e.target.value)
    v.currentTime = t
    setTime(t)
  }
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`
  const pct = dur ? (time / dur) * 100 : 0

  // browsers only allow sound after a click, so the film starts muted
  const toggleSound = () => {
    const v = video.current
    if (!v) return
    v.muted = !v.muted
    if (!v.muted) { v.currentTime = 0; v.play(); setPlaying(true); userPaused.current = false }
    setMuted(v.muted)
  }

  return (
    <section id="journey" aria-label="Farm se ghar tak, a one-minute film" className="screen px-4 py-16 sm:px-6 lg:py-5">
      <Reveal className={`mx-auto w-full ${FILM_W}`}>
        <figure className="relative overflow-hidden rounded-[28px] bg-forest-deep shadow-[0_30px_70px_-45px_rgb(23_58_40/.7)]">
          <video ref={video} className="aspect-video w-full object-cover" src="/media/apnadairy-journey.mp4" poster="/media/apnadairy-journey-poster.jpg"
            muted loop playsInline preload="metadata"
            aria-label="Animated film: milk travels from a Pakistani farm to the area manager's milk shop, is tested and priced, then delivered to a family" />
          <div className="film-bar absolute inset-x-0 bottom-0 flex items-center gap-2 px-2.5 pb-2 pt-8 sm:gap-4 sm:px-5 sm:pb-4 sm:pt-10">
            <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream/90 text-forest-deep backdrop-blur transition-colors hover:bg-cream sm:h-10 sm:w-10">
              {playing
                ? <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1.2" /><rect x="14" y="5" width="4" height="14" rx="1.2" /></svg>
                : <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>}
            </button>
            <input type="range" className="film-seek min-w-0 flex-1" min="0" max={dur || 0} step="0.1" value={Math.min(time, dur || 0)}
              style={{ '--p': `${pct}%` }} aria-label="Seek the film" aria-valuetext={`${fmt(time)} of ${fmt(dur)}`}
              onPointerDown={() => { scrubbing.current = true }} onPointerUp={() => { scrubbing.current = false }}
              onInput={seek} onChange={seek} />
            <span className="num shrink-0 text-[11.5px] font-semibold text-cream sm:text-[13.5px]">{fmt(time)} / {fmt(dur)}</span>
            <button onClick={toggleSound} aria-label={muted ? 'Sound on' : 'Mute'}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-cream/90 text-[14px] font-semibold text-forest-deep backdrop-blur transition-colors hover:bg-cream sm:h-auto sm:w-auto sm:px-4 sm:py-2">
              <svg className="sm:hidden" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
                {muted ? <path d="m16 9.5 5 5m0-5-5 5" /> : <path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" />}
              </svg>
              <span className="hidden sm:inline">{muted ? 'Sound on' : 'Mute'}</span>
            </button>
          </div>
        </figure>
      </Reveal>
    </section>
  )
}
