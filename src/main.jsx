import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/opsz.css'
import './index.css'
import App from './App.jsx'

// number boxes: no e or +, no minus when the box cannot go below zero, and the mouse wheel does not change the value by accident
document.addEventListener('keydown', (e) => {
  const t = e.target
  if (!(t instanceof HTMLInputElement) || t.type !== 'number') return
  if (['e', 'E', '+'].includes(e.key) || (e.key === '-' && t.min !== '' && Number(t.min) >= 0)) e.preventDefault()
})
document.addEventListener('wheel', (e) => {
  if (e.target instanceof HTMLInputElement && e.target.type === 'number' && document.activeElement === e.target) e.target.blur()
}, { passive: true })

// tables: copy each column heading onto its cells, so phones can show rows as labelled cards (see .table in index.css)
let labelling = 0
const labelTables = () => {
  labelling = 0
  document.querySelectorAll('table.table').forEach((t) => {
    const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim())
    t.querySelectorAll('tbody tr').forEach((tr) => {
      let i = 0
      for (const td of tr.children) {
        const span = td.colSpan || 1
        const label = span > 1 ? '' : heads[i] ?? ''
        if (td.getAttribute('data-label') !== label) td.setAttribute('data-label', label)
        i += span
      }
    })
  })
}
new MutationObserver(() => { if (!labelling) labelling = requestAnimationFrame(labelTables) }).observe(document.body, { childList: true, subtree: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
