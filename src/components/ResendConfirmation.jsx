import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// sends the sign-up confirmation email again (supabase allows one about every minute)
export default function ResendConfirmation({ email, className = '' }) {
  const [wait, setWait] = useState(0)
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!wait) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])
  const send = async () => {
    setMsg('')
    const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: `${window.location.origin}/pending` } })
    if (error) setMsg(/seconds|rate/i.test(error.message) ? 'Please wait a minute before asking again.' : error.message)
    else { setMsg(`Sent again to ${email}. Check your inbox and spam folder.`); setWait(60) }
  }
  return (
    <div className={className}>
      <button type="button" className="font-semibold text-forest hover:underline disabled:text-muted disabled:no-underline" disabled={!email || wait > 0} onClick={send}>
        {wait > 0 ? `Send the email again in ${wait}s` : 'Send the confirmation email again'}
      </button>
      {msg && <p className="mt-1 text-[13px] text-muted">{msg}</p>}
    </div>
  )
}
