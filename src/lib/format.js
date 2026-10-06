const nf = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 })

export const rs = (n) => (n == null ? '—' : `Rs ${nf.format(Number(n))}`)
export const litres = (n) => (n == null ? '—' : `${nf.format(Number(n))} L`)
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')

// "in 2 days" / "3 hours ago"
export const relative = (d) => {
  const diff = new Date(d).getTime() - Date.now()
  const abs = Math.abs(diff)
  const units = [['day', 864e5], ['hour', 36e5], ['minute', 6e4]]
  for (const [u, ms] of units) {
    if (abs >= ms) {
      const v = Math.round(abs / ms)
      return diff > 0 ? `in ${v} ${u}${v > 1 ? 's' : ''}` : `${v} ${u}${v > 1 ? 's' : ''} ago`
    }
  }
  return 'just now'
}

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '')
// 1 farmer, 2 farmers
export const plural = (n, word) => `${n} ${Number(n) === 1 ? word.replace(/s$/, '') : word}`
