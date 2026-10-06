// shared input checks. each returns an error message, or '' when the value is fine.
// the database checks the same rules again (supabase/23_validation.sql).

const digits = (s) => String(s ?? '').replace(/\D/g, '')

// 0300 1234567, 0300-1234567, +92 300 1234567 → 03001234567
export const normPhone = (s) => {
  const d = digits(s)
  return d.startsWith('92') && d.length === 12 ? `0${d.slice(2)}` : d
}
export const phoneError = (s, { required = false } = {}) => {
  if (!String(s ?? '').trim()) return required ? 'Enter a phone number.' : ''
  return /^03\d{9}$/.test(normPhone(s)) ? '' : 'Phone must be a mobile number like 0300 1234567.'
}
// shown as 0300 1234567
export const prettyPhone = (s) => {
  const p = normPhone(s)
  return /^03\d{9}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : String(s ?? '').trim()
}

export const nameError = (s, what = 'name') => {
  const v = String(s ?? '').trim()
  if (v.length < 2) return `Enter the ${what}.`
  if (v.length > 80) return `The ${what} is too long.`
  if (!/^[\p{L} .'-]+$/u.test(v)) return `The ${what} can only have letters, spaces, dots and dashes.`
  return ''
}
// shop, center and business names may have numbers and & (e.g. "Al-Noor Dairy 2", "Rashid & Sons")
export const titleError = (s, what = 'name') => {
  const v = String(s ?? '').trim()
  if (v.length < 2) return `Enter the ${what}.`
  if (v.length > 80) return `The ${what} is too long.`
  if (!/\p{L}/u.test(v)) return `The ${what} needs some letters.`
  return ''
}
export const cityError = (s) => {
  const v = String(s ?? '').trim()
  if (v.length < 2) return 'Enter the city.'
  if (v.length > 40 || !/^[\p{L} .'-]+$/u.test(v)) return 'Enter a real city name, letters only.'
  return ''
}
export const emailError = (s) => (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s ?? '').trim()) ? '' : 'Enter a valid email address.')
export const passwordError = (s) =>
  String(s ?? '').length < 8 || !/[a-z]/i.test(s) || !/\d/.test(s) ? 'Use at least 8 characters with letters and numbers.' : ''

// a number between min and max; whole = no decimals
export const numberError = (v, { min = 0, max = Infinity, whole = false, what = 'value', required = true } = {}) => {
  if (v === '' || v == null) return required ? `Enter the ${what}.` : ''
  const n = Number(v)
  if (!Number.isFinite(n)) return `The ${what} must be a number.`
  if (whole && !Number.isInteger(n)) return `The ${what} must be a whole number.`
  if (n < min) return `The ${what} must be at least ${min.toLocaleString('en-PK')}.`
  if (n > max) return `The ${what} can be at most ${max.toLocaleString('en-PK')}.`
  return ''
}

// payment transaction ids: letters and numbers, 6 to 30
export const refError = (s) => {
  const v = String(s ?? '').trim()
  if (!v) return 'Enter the transaction ID from your payment.'
  return /^[A-Za-z0-9-]{6,30}$/.test(v) ? '' : 'The transaction ID is 6 to 30 letters or numbers.'
}

// first message in a list of checks
export const firstError = (...msgs) => msgs.find(Boolean) || ''

// common pakistani cities, offered as suggestions so rates and searches match
export const CITIES = ['Islamabad', 'Rawalpindi', 'Lahore', 'Karachi', 'Faisalabad', 'Multan', 'Peshawar', 'Quetta', 'Gujranwala',
  'Sialkot', 'Sargodha', 'Bahawalpur', 'Sahiwal', 'Okara', 'Hyderabad', 'Sukkur', 'Abbottabad', 'Mardan', 'Jhelum', 'Gujrat',
  'Sheikhupura', 'Kasur', 'Chakwal', 'Attock', 'Mianwali', 'Dera Ghazi Khan', 'Rahim Yar Khan', 'Murree', 'Mansehra', 'Swat']
export const tidyCity = (s) => String(s ?? '').trim().replace(/\s+/g, ' ').replace(/\b\p{L}/gu, (m) => m.toUpperCase())

// database and network errors in plain words
export function niceError(msg) {
  let m = String(msg?.message ?? msg ?? '').trim()
  if (!m) return ''
  if (/failed to fetch|networkerror|load failed/i.test(m)) return 'No internet connection. Check it and try again.'
  if (/jwt expired|invalid jwt|refresh token/i.test(m)) return 'Your session ended. Please sign in again.'
  if (/duplicate key/i.test(m)) return 'This already exists.'
  if (/violates check constraint|violates not-null|invalid input syntax|value too long|out of range/i.test(m)) return 'Some of the details are not valid. Check them and try again.'
  if (/permission denied|row-level security/i.test(m)) return 'You are not allowed to do this.'
  if (/user already registered/i.test(m)) return 'An account with this email already exists. Sign in instead.'
  if (/invalid login credentials/i.test(m)) return 'The email or password is wrong.'
  if (/email not confirmed/i.test(m)) return 'Confirm your email first. The link is in your inbox.'
  if (/database error saving new user/i.test(m)) return 'The account could not be created. Check your phone number and name.'
  m = m.charAt(0).toUpperCase() + m.slice(1)
  return /[.!?)]$/.test(m) ? m : `${m}.`
}
