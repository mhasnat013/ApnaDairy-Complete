// iot-reading: fetches the latest reading of the caller's iot device from firebase,
// works out ec from tds, checks it, stores it in device_readings and returns it.
// deploy: supabase dashboard → edge functions → deploy a new function → via editor, name "iot-reading".
// secret needed: FIREBASE_SECRET (edge functions → secrets). SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are provided by supabase automatically.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// --- reading-logic-start ---
// the device sends text values. ec is derived from tds (the team's formula, in mS/cm):
//   ec = tds / 640,  ec25 = ec / (1 + 0.02 (t - 25))
// a reading that is physically impossible means the probe is not in the milk or needs calibrating.
function parseReading(raw: Record<string, unknown>) {
  const num = (v: unknown) => {
    const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim())
    return Number.isFinite(n) ? n : null
  }
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(raw).find((x) => x.toLowerCase() === k.toLowerCase())
      if (hit !== undefined) return num(raw[hit])
    }
    return null
  }
  const temperature = pick('TEMP', 'temperature', 'temp')
  const ph = pick('PH', 'ph')
  const tds = pick('TDS', 'tds')
  const problems: string[] = []
  if (temperature === null || temperature < -5 || temperature > 60) problems.push('The temperature sensor gave no usable value.')
  if (ph === null || ph < 0 || ph > 14) problems.push(`pH ${ph ?? 'missing'} is not possible. Put the pH probe in the milk, or calibrate it.`)
  else if (ph < 3 || ph > 10) problems.push(`pH ${ph} is far outside milk. Check the pH probe is in the milk.`)
  if (tds === null || tds <= 0) problems.push('TDS is 0. Put the TDS probe in the milk.')
  const ec = tds !== null && tds > 0 ? tds / 640 : null
  const ec25 = ec !== null && temperature !== null ? ec / (1 + 0.02 * (temperature - 25)) : null
  // if the firmware ever adds a time stamp (ms since 1970), use it and refuse stale readings
  const ts = pick('ts', 'timestamp', 'time')
  const readingAt = ts && ts > 1e12 ? new Date(ts) : new Date()
  if (ts && ts > 1e12 && Date.now() - ts > 5 * 60 * 1000) problems.push('The device has not sent a new reading in the last 5 minutes. Check it is on and connected to WiFi.')
  const r2 = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d)
  return {
    temperature_c: r2(temperature), ph: r2(ph), tds_ppm: r2(tds, 1), ec_ms: r2(ec, 3), ec25_ms: r2(ec25, 3),
    status: problems.length ? 'check' : 'ok', problems, reading_at: readingAt.toISOString(),
  }
}
// --- reading-logic-end ---

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    // who is asking: a signed-in, approved milk center
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return reply({ error: 'Sign in again.' }, 401)
    const { data: center } = await admin.from('area_managers').select('id, verification_status')
      .eq('user_id', user.id).eq('type', 'milk_center').maybeSingle()
    if (!center || center.verification_status !== 'active') return reply({ error: 'Only an approved milk center can take readings.' }, 403)

    const { data: device } = await admin.from('iot_devices').select('*').eq('area_manager_id', center.id).maybeSingle()
    if (!device) return reply({ error: 'No IoT device is linked to your center yet. Ask ApnaDairy to assign one.' })
    if (!device.is_active) return reply({ error: `Device ${device.serial} is switched off by ApnaDairy.` })

    const secret = Deno.env.get('FIREBASE_SECRET')
    if (!secret) return reply({ error: 'The device connection is not set up yet (FIREBASE_SECRET is missing).' })
    const res = await fetch(`${device.db_url.replace(/\/$/, '')}/${device.path}.json?auth=${encodeURIComponent(secret)}`)
    if (!res.ok) return reply({ error: `Could not reach the device database (${res.status}). Try again.` })
    const raw = await res.json()
    if (!raw || typeof raw !== 'object') return reply({ error: 'The device has not sent any reading yet.' })

    const r = parseReading(raw)
    const { data: row, error } = await admin.from('device_readings').insert({
      device_serial: device.serial, area_manager_id: center.id, raw, ...r,
    }).select().single()
    if (error) return reply({ error: error.message }, 500)
    return reply({ reading: row })
  } catch (e) {
    return reply({ error: `Reading failed: ${(e as Error).message}` }, 500)
  }
})
