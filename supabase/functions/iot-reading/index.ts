// iot-reading: one-minute tests on the caller's iot device.
//   { action: 'start' }               opens a test session, returns { session, seconds, every }
//   { action: 'sample', session }     reads the device's latest values from firebase and stores them
//   { action: 'finish', session }     averages the samples on the server and stores the final reading
// only the final, averaged reading is used by the ai models and the collection.
// deploy: supabase dashboard → edge functions → deploy a new function → via editor, name "iot-reading".
//   { action: 'predict', temperature, ph, ec, tds }   asks ai models 1 and 2 directly (the try-it sliders)
//   { action: 'wake' }                loads both ai models ahead of a test (called when the test page opens), also for admins
// secret needed: FIREBASE_SECRET (edge functions → secrets). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
// are provided by supabase automatically. optional: TEST_SECONDS (default 60), SAMPLE_EVERY (default 3).
// ai model 1 runs inside this function: the team's trained models (ai/model1/models/*.joblib) exported by
// ai/model1/export_for_supabase.py into public/model1/apnadairy-model1-v1.bin, which the website serves.
// ai model 2 (added water) runs the same way: ai/model2/export_for_supabase.py → public/model2/apnadairy-model2-v1.bin.
// each file is downloaded once per cold start and checked against its sha256. optional secrets MODEL1_FILE_URL and
// MODEL2_FILE_URL load them from somewhere else.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// --- reading-logic-start ---
type Sample = { temperature_c: number | null; ph: number | null; tds_ppm: number | null; valid: boolean; problem: string | null; raw?: unknown }

const num = (v: unknown): number | null => {
  if (v && typeof v === 'object' && 'value' in (v as Record<string, unknown>)) v = (v as Record<string, unknown>).value
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim())
  return Number.isFinite(n) ? n : null
}

// one sample as the device sent it: text values, sometimes { value: "..." }
function parseSample(raw: Record<string, unknown>): Sample {
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const hit = Object.keys(raw).find((x) => x.toLowerCase() === k.toLowerCase())
      if (hit !== undefined) return num(raw[hit])
    }
    return null
  }
  const t = pick('TEMP', 'temperature', 'temp'), ph = pick('PH', 'ph'), tds = pick('TDS', 'tds')
  let problem: string | null = null
  if (t === null || t < -5 || t > 60) problem = 'The temperature sensor gave no usable value.'
  else if (ph === null || ph < 0 || ph > 14) problem = `pH ${ph ?? 'missing'} is not possible. Put the pH probe in the milk, or calibrate it.`
  else if (tds === null || tds <= 0) problem = 'TDS is 0. Put the TDS probe in the milk.'
  return { temperature_c: t, ph, tds_ppm: tds, valid: problem === null, problem }
}

// robust middle of a set of values: drop spikes far from the median, then average the rest
function robust(values: number[], minTol: number) {
  const s = [...values].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const dev = s.map((x) => Math.abs(x - med)).sort((a, b) => a - b)
  const mad = dev.length % 2 ? dev[(dev.length - 1) / 2] : (dev[dev.length / 2 - 1] + dev[dev.length / 2]) / 2
  const tol = Math.max(3 * 1.4826 * mad, minTol)
  const keep = (x: number) => Math.abs(x - med) <= tol
  const kept = values.filter(keep)
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length)
  return { mean, sd, keep }
}

// the final reading of a test. ec is worked out from tds (team formula, mS/cm):
//   ec = tds / 640,  ec25 = ec / (1 + 0.02 (t - 25))
function averageSamples(samples: Sample[], seconds: number) {
  const problems: string[] = [], notes: string[] = []
  const valid = samples.filter((s) => s.valid)
  const r2 = (n: number | null, d = 2) => (n === null ? null : Math.round(n * 10 ** d) / 10 ** d)
  if (samples.length < Math.max(5, Math.floor(seconds / 6))) {
    problems.push(`Only ${samples.length} readings arrived during the test. Check the device is on and connected to WiFi, then try again.`)
  }
  if (samples.length > valid.length && valid.length < Math.max(5, Math.ceil(samples.length * 0.6))) {
    const why = samples.find((s) => !s.valid)?.problem
    problems.push(`${samples.length - valid.length} of ${samples.length} readings were impossible values.${why ? ' ' + why : ''}`)
  }
  if (!valid.length) {
    return { temperature_c: null, ph: null, tds_ppm: null, ec_ms: null, ec25_ms: null, status: 'check', problems, notes, samples_total: samples.length, samples_used: 0, spread: null }
  }
  const T = robust(valid.map((s) => s.temperature_c!), 0.5)
  const P = robust(valid.map((s) => s.ph!), 0.08)
  const D = robust(valid.map((s) => s.tds_ppm!), 60)
  const used = valid.filter((s) => T.keep(s.temperature_c!) && P.keep(s.ph!) && D.keep(s.tds_ppm!)).length
  const bad = samples.length - valid.length, odd = valid.length - used
  if (bad + odd > 0) {
    const parts = [bad ? `${bad} impossible` : '', odd ? `${odd} far from the rest` : ''].filter(Boolean).join(', ')
    notes.push(`${bad + odd} of ${samples.length} readings were left out of the average (${parts}).`)
  }
  if (P.sd > 0.15 || D.sd > 150 || T.sd > 1.5) notes.push('The readings moved a lot during the test. Keep the probes still in the milk next time.')
  if (valid.length >= 5 && new Set(valid.map((s) => `${s.temperature_c}|${s.ph}|${s.tds_ppm}`)).size === 1) {
    notes.push('The values did not change at all during the test. The device may not be sending new readings.')
  }
  const ph = P.mean
  if (ph < 3 || ph > 10) problems.push(`pH ${r2(ph)} is far outside milk. Check the pH probe is in the milk.`)
  const ec = D.mean / 640
  const ec25 = ec / (1 + 0.02 * (T.mean - 25))
  return {
    temperature_c: r2(T.mean), ph: r2(ph), tds_ppm: r2(D.mean, 1), ec_ms: r2(ec, 3), ec25_ms: r2(ec25, 3),
    status: problems.length ? 'check' : 'ok', problems, notes,
    samples_total: samples.length, samples_used: used,
    spread: { temperature_c: r2(T.sd), ph: r2(P.sd, 3), tds_ppm: r2(D.sd, 1) },
  }
}
// --- reading-logic-end ---

// --- model1-start ---
// ai model 1: temperature, ph and ec at the milk's own temperature in; quality (svm), freshness score,
// shelf life and spoilage risk (random forests) out. gives the same answers as ai/model1/app/main.py
// (checked on every dataset row by ai/model1/test_parity.mjs).
type Model1 = { quality: string; freshness_score: number; remaining_shelf_life_hours: number; spoilage_risk_percent: number; warnings: string[] }
type M1Forest = { trees: number; start: Int32Array; left: Int16Array; right: Int16Array; feature: Int8Array; value: Float64Array }
type M1Model = {
  q: { mean: number[]; scale: number[]; gamma: number; classes: string[]; nSupport: number[]; intercept: number[]; sv: Float64Array; coef: Float64Array; nSv: number }
  freshness: M1Forest; shelf: M1Forest; spoilage: M1Forest
}
// the values the model was trained on (ai/model1 README, section 7), and values a working sensor can never give
const M1_TRAINED: Record<string, [number, number]> = { temperature: [2.5, 40.38], ph: [4.45, 7.22], ec: [1.62, 9.0] }
const M1_POSSIBLE: Record<string, [number, number]> = { temperature: [-5, 60], ph: [0, 14], ec: [0, 30] }

function parseModel1(bytes: Uint8Array): M1Model {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)))
  if (head.format !== 'apnadairy-model1' || head.version !== 1) throw new Error('unknown model file')
  let at = 4 + n
  while (at % 8) at++
  const buf = bytes.slice(at).buffer   // a fresh copy, so every array is aligned
  type Part = { offset: number; length: number }
  const f64 = (p: Part) => new Float64Array(buf, p.offset, p.length)
  const forest = (h: { trees: number; nodes: number[]; left: Part; right: Part; feature: Part; value: Part }): M1Forest => {
    const start = new Int32Array(h.trees + 1)
    for (let t = 0; t < h.trees; t++) start[t + 1] = start[t] + h.nodes[t]
    return { trees: h.trees, start, left: new Int16Array(buf, h.left.offset, h.left.length), right: new Int16Array(buf, h.right.offset, h.right.length),
             feature: new Int8Array(buf, h.feature.offset, h.feature.length), value: f64(h.value) }
  }
  const q = head.quality
  return {
    q: { mean: q.mean, scale: q.scale, gamma: q.gamma, classes: q.classes, nSupport: q.n_support, intercept: q.intercept, sv: f64(q.sv), coef: f64(q.coef), nSv: q.n_sv },
    freshness: forest(head.freshness), shelf: forest(head.shelf_life), spoilage: forest(head.spoilage),
  }
}

// a forest's answer is the mean of its trees. like scikit-learn, the inputs are compared as float32
function m1Forest(f: M1Forest, x: Float32Array) {
  let sum = 0
  for (let t = 0; t < f.trees; t++) {
    const b = f.start[t]
    let node = 0
    while (f.left[b + node] !== -1) node = x[f.feature[b + node]] <= f.value[b + node] ? f.left[b + node] : f.right[b + node]
    sum += f.value[b + node]
  }
  return sum / f.trees
}

// the svm's class, the way libsvm decides it: scale, rbf kernel, then one vote per pair of classes
function m1Quality(q: M1Model['q'], x: number[]) {
  const xs = x.map((v, k) => (v - q.mean[k]) / q.scale[k])
  const kv = new Float64Array(q.nSv)
  for (let i = 0; i < q.nSv; i++) {
    let d = 0
    for (let k = 0; k < 4; k++) { const e = xs[k] - q.sv[i * 4 + k]; d += e * e }
    kv[i] = Math.exp(-q.gamma * d)
  }
  const nc = q.classes.length, start = [0]
  for (let i = 1; i < nc; i++) start[i] = start[i - 1] + q.nSupport[i - 1]
  const vote = new Array(nc).fill(0)
  let p = 0
  for (let i = 0; i < nc; i++) {
    for (let j = i + 1; j < nc; j++) {
      let sum = 0
      for (let k = 0; k < q.nSupport[i]; k++) sum += q.coef[(j - 1) * q.nSv + start[i] + k] * kv[start[i] + k]
      for (let k = 0; k < q.nSupport[j]; k++) sum += q.coef[i * q.nSv + start[j] + k] * kv[start[j] + k]
      sum += q.intercept[p++]
      if (sum > 0) vote[i]++; else vote[j]++
    }
  }
  let best = 0
  for (let i = 1; i < nc; i++) if (vote[i] > vote[best]) best = i
  return q.classes[best]
}

const m1Round = (v: number) => Number(v.toFixed(2))
function runModel1(m: M1Model, temperature: number, ph: number, ec: number): Model1 {
  const inputs: Record<string, number> = { temperature, ph, ec }
  for (const [k, [lo, hi]] of Object.entries(M1_POSSIBLE)) {
    if (!Number.isFinite(inputs[k]) || inputs[k] < lo || inputs[k] > hi) throw new Error(`${k} ${inputs[k]} is not a possible sensor value`)
  }
  const ec25 = ec / (1 + 0.022 * (temperature - 25.0))   // same engineered feature as training
  const x = [temperature, ph, ec, ec25]
  const x32 = Float32Array.from(x)
  const clip = (v: number, hi: number) => Math.min(hi, Math.max(0, v))
  return {
    quality: m1Quality(m.q, x),
    freshness_score: m1Round(clip(m1Forest(m.freshness, x32), 100)),
    remaining_shelf_life_hours: m1Round(clip(Math.expm1(m1Forest(m.shelf, x32)), 120)),   // trained on log1p(hours)
    spoilage_risk_percent: m1Round(clip(m1Forest(m.spoilage, x32), 100)),
    warnings: Object.entries(M1_TRAINED).filter(([k, [lo, hi]]) => inputs[k] < lo || inputs[k] > hi)
      .map(([k, [lo, hi]]) => `${k} ${inputs[k]} is outside what the model was trained on (${lo} to ${hi})`),
  }
}
// --- model1-end ---

// --- model2-start ---
// ai model 2: temperature, ph, ec (at the milk's own temperature) and tds in; whether water was added, with a
// confidence. gives the same answers as ai/model2/src/predict.py (checked by ai/model2/test_parity.mjs).
// the model: 5 calibrated folds of boosted trees; P(water) is the mean of 1 / (1 + exp(a * raw + b)).
type Model2 = { water_detected: boolean; adulteration_type: 'Water' | 'None'; confidence: number; water_probability: number; warnings: string[] }
type M2Fold = { a: number; b: number; baseline: number; trees: number; start: Int32Array; left: Int16Array; right: Int16Array; feature: Int8Array; missLeft: Uint8Array; value: Float64Array }
type M2Model = { folds: M2Fold[]; ranges: Record<string, [number, number]> }
const M2_NAMES: Record<string, string> = { temperature_c: 'temperature', ph: 'pH', ec_ms_cm: 'EC', tds_ppm: 'TDS' }

function parseModel2(bytes: Uint8Array): M2Model {
  const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true)
  const head = JSON.parse(new TextDecoder().decode(bytes.subarray(4, 4 + n)))
  if (head.format !== 'apnadairy-model2' || head.version !== 1 || head.classes?.[1] !== 'Water') throw new Error('unknown model file')
  let at = 4 + n
  while (at % 8) at++
  const buf = bytes.slice(at).buffer   // a fresh copy, so every array is aligned
  type Part = { offset: number; length: number }
  const folds = head.folds.map((h: { a: number; b: number; baseline: number; trees: number; nodes: number[]; left: Part; right: Part; feature: Part; missing_left: Part; value: Part }) => {
    const start = new Int32Array(h.trees + 1)
    for (let t = 0; t < h.trees; t++) start[t + 1] = start[t] + h.nodes[t]
    return { a: h.a, b: h.b, baseline: h.baseline, trees: h.trees, start,
             left: new Int16Array(buf, h.left.offset, h.left.length), right: new Int16Array(buf, h.right.offset, h.right.length),
             feature: new Int8Array(buf, h.feature.offset, h.feature.length), missLeft: new Uint8Array(buf, h.missing_left.offset, h.missing_left.length),
             value: new Float64Array(buf, h.value.offset, h.value.length) }
  })
  return { folds, ranges: head.train_ranges }
}

// one fold's raw score: the baseline plus every tree's leaf, trees walked like scikit-learn (x <= threshold goes left)
function m2Raw(f: M2Fold, x: number[]) {
  let raw = f.baseline
  for (let t = 0; t < f.trees; t++) {
    const b = f.start[t]
    let node = 0
    while (f.feature[b + node] !== -1) {
      const v = x[f.feature[b + node]]
      node = Number.isNaN(v) ? (f.missLeft[b + node] ? f.left[b + node] : f.right[b + node]) : v <= f.value[b + node] ? f.left[b + node] : f.right[b + node]
    }
    raw += f.value[b + node]
  }
  return raw
}

// the chance of each class, averaged over the folds the way CalibratedClassifierCV does
function m2Proba(m: M2Model, x: number[]) {
  let water = 0, none = 0
  for (const f of m.folds) {
    const p = 1 / (1 + Math.exp(f.a * m2Raw(f, x) + f.b))
    water += p; none += 1 - p
  }
  return { water: water / m.folds.length, none: none / m.folds.length }
}

function runModel2(m: M2Model, temperature: number, ph: number, ec: number, tds: number): Model2 {
  const inputs: Record<string, number> = { temperature_c: temperature, ph, ec_ms_cm: ec, tds_ppm: tds }
  if (![temperature, ph, ec, tds].every(Number.isFinite) || ec <= 0 || tds <= 0 || ph < 0 || ph > 14) throw new Error('these are not possible sensor values')
  // the same engineered features as training (BackendFeatures in ai/model2/src/train_models.py)
  const x = [temperature, ph, ec, tds, ec / (1 + 0.022 * (temperature - 25.0)), tds / (ec * 1000.0)]
  const p = m2Proba(m, x)
  const water = p.water > p.none
  return {
    water_detected: water, adulteration_type: water ? 'Water' : 'None',
    confidence: Math.round((water ? p.water : p.none) * 1000) / 10,
    water_probability: Math.round(p.water * 10000) / 100,
    warnings: Object.entries(m.ranges).filter(([k, [lo, hi]]) => !(lo <= inputs[k] && inputs[k] <= hi))
      .map(([k, [lo, hi]]) => `${M2_NAMES[k] ?? k} ${inputs[k]} is outside what the model was trained on (${lo} to ${hi})`),
  }
}
// --- model2-end ---

// the model files: downloaded once per cold start, checked, then kept in memory
const MODEL1_SHA256 = 'ad3229e9f4a5232e79458f68e77f6a1081f49d890d2685846a0803b8f70de352'
const MODEL2_SHA256 = '17a7f4ce32352a6c23d69b1ac933fb33454171bd57dd3059ffe6f1f512a1a7c7'
async function fetchModelFile(path: string, override: string, sha: string) {
  const site = (Deno.env.get('SITE_URL') ?? 'https://apnadairy-psi.vercel.app').trim().replace(/\/$/, '')
  const url = (Deno.env.get(override) ?? `${site}/${path}`).trim()
  const stop = new AbortController()
  const timer = setTimeout(() => stop.abort(), 20000)
  try {
    const res = await fetch(url, { signal: stop.signal })
    if (!res.ok) throw new Error(`model file answered ${res.status}`)
    const gz = new Uint8Array(await res.arrayBuffer())
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', gz))).map((b) => b.toString(16).padStart(2, '0')).join('')
    if (hash !== sha) throw new Error('the model file does not match this version')
    return new Uint8Array(await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}
let model1: Promise<M1Model> | null = null
function loadModel1(): Promise<M1Model> {
  if (!model1) {
    model1 = fetchModelFile('model1/apnadairy-model1-v1.bin', 'MODEL1_FILE_URL', MODEL1_SHA256).then(parseModel1)
    model1.catch(() => { model1 = null })   // try again on the next test
  }
  return model1
}
let model2: Promise<M2Model> | null = null
function loadModel2(): Promise<M2Model> {
  if (!model2) {
    model2 = fetchModelFile('model2/apnadairy-model2-v1.bin', 'MODEL2_FILE_URL', MODEL2_SHA256).then(parseModel2)
    model2.catch(() => { model2 = null })
  }
  return model2
}
async function askModel1(temperature: number, ph: number, ec: number): Promise<Model1> {
  return runModel1(await loadModel1(), temperature, ph, ec)
}
async function askModel2(temperature: number, ph: number, ec: number, tds: number): Promise<Model2> {
  return runModel2(await loadModel2(), temperature, ph, ec, tds)
}
// keep every answer, so the database uses it for this test (and the same values are never asked twice)
async function saveModel1(admin: ReturnType<typeof createClient>, t: number, ph: number, ec: number, m: Model1) {
  const { error } = await admin.from('model1_predictions').upsert({
    temperature_c: t, ph, ec_ms: ec, quality: m.quality, freshness_score: m.freshness_score,
    shelf_life_h: m.remaining_shelf_life_hours, spoilage_pct: m.spoilage_risk_percent, warnings: m.warnings ?? [],
  })
  if (error) throw new Error(error.message)
}
async function saveModel2(admin: ReturnType<typeof createClient>, t: number, ph: number, ec: number, tds: number, m: Model2) {
  const { error } = await admin.from('model2_predictions').upsert({
    temperature_c: t, ph, ec_ms: ec, tds_ppm: tds, water_detected: m.water_detected, confidence: m.confidence,
    water_probability: m.water_probability, warnings: m.warnings ?? [],
  })
  if (error) throw new Error(error.message)
}
// loads both models ahead of the test (the test page calls this when it opens), and says whether they work
async function wakeModels() {
  const out: Record<string, unknown> = { ok: true }
  try { runModel1(await loadModel1(), 6, 6.7, 4.4) } catch (e) { out.ok = false; out.error = `Model 1: ${(e as Error).message}` }
  try { runModel2(await loadModel2(), 6, 6.7, 4.4, 2800) } catch (e) { out.ok = false; out.error2 = `Model 2: ${(e as Error).message}` }
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const SECONDS = Number(Deno.env.get('TEST_SECONDS') ?? 60), EVERY = Number(Deno.env.get('SAMPLE_EVERY') ?? 3)
    const body = await req.json().catch(() => ({}))

    // who is asking: a signed-in, approved milk center with a device
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '')
    const { data: { user } } = await admin.auth.getUser(jwt)
    if (!user) return reply({ error: 'Sign in again.' }, 401)

    // waking the model needs no device: an approved center or an admin
    if (body.action === 'wake') {
      const { data: me } = await admin.from('profiles').select('role, status').eq('id', user.id).maybeSingle()
      if (!me || me.status !== 'active' || !['area_manager', 'super_admin'].includes(me.role)) return reply({ error: 'Not allowed.' }, 403)
      return reply(await wakeModels())
    }

    const { data: center } = await admin.from('area_managers').select('id, verification_status')
      .eq('user_id', user.id).eq('type', 'milk_center').maybeSingle()
    if (!center || center.verification_status !== 'active') return reply({ error: 'Only an approved milk center can take readings.' }, 403)
    const { data: device } = await admin.from('iot_devices').select('*').eq('area_manager_id', center.id).maybeSingle()
    if (!device) return reply({ error: 'No IoT device is linked to your center yet. Ask ApnaDairy to assign one.' })
    if (!device.is_active) return reply({ error: `Device ${device.serial} is switched off by ApnaDairy.` })

    if (body.action === 'predict') {
      const t = Math.round(Number(body.temperature) * 100) / 100, ph = Math.round(Number(body.ph) * 100) / 100
      const ec = Math.round(Number(body.ec) * 1000) / 1000
      const tds = body.tds == null ? null : Math.round(Number(body.tds) * 10) / 10
      if (![t, ph, ec].every(Number.isFinite)) return reply({ error: 'Send temperature, ph and ec.' }, 400)
      const out: Record<string, unknown> = {}
      try {
        const m = await askModel1(t, ph, ec)
        await saveModel1(admin, t, ph, ec, m)
        out.prediction = m
      } catch (e) {
        out.error = (e as Error).message
      }
      if (tds !== null && Number.isFinite(tds)) {
        try {
          const m = await askModel2(t, ph, ec, tds)
          await saveModel2(admin, t, ph, ec, tds, m)
          out.prediction2 = m
        } catch (e) {
          out.error2 = (e as Error).message
        }
      }
      return reply(out)
    }

    if (body.action === 'start') {
      const { data: s, error } = await admin.from('reading_sessions')
        .insert({ area_manager_id: center.id, device_serial: device.serial, seconds: SECONDS }).select().single()
      if (error) return reply({ error: error.message }, 500)
      return reply({ session: s.id, seconds: SECONDS, every: EVERY, serial: device.serial })
    }

    // sample and finish work on an open session of this center
    const { data: s } = await admin.from('reading_sessions').select('*').eq('id', body.session ?? '').maybeSingle()
    if (!s || s.area_manager_id !== center.id) return reply({ error: 'This test was not found. Start the reading again.' })
    if (s.finished_at) return reply({ error: 'This test is already finished. Start a new reading.' })
    const age = (Date.now() - new Date(s.started_at).getTime()) / 1000

    if (body.action === 'sample') {
      if (age > s.seconds + 60) return reply({ error: 'This test took too long. Start the reading again.' })
      const { count } = await admin.from('device_samples').select('id', { count: 'exact', head: true }).eq('session_id', s.id)
      if ((count ?? 0) >= Math.ceil(s.seconds / 2) + 10) return reply({ error: 'This test has enough readings. Finish it.' })
      const secret = Deno.env.get('FIREBASE_SECRET')
      if (!secret) return reply({ error: 'The device connection is not set up yet (FIREBASE_SECRET is missing).' })
      const res = await fetch(`${device.db_url.replace(/\/$/, '')}/${device.path}.json?auth=${encodeURIComponent(secret)}`)
      if (!res.ok) return reply({ error: `Could not reach the device database (${res.status}).` })
      const raw = await res.json()
      if (!raw || typeof raw !== 'object') return reply({ error: 'The device has not sent any reading yet.' })
      const smp = parseSample(raw)
      const { data: row, error } = await admin.from('device_samples').insert({ session_id: s.id, raw, ...smp }).select().single()
      if (error) return reply({ error: error.message }, 500)
      return reply({ sample: row })
    }

    if (body.action === 'finish') {
      // a test must run its full time, so it cannot be cut short to dodge the average
      if (age < s.seconds * 0.9) return reply({ error: `The test needs the full ${s.seconds} seconds.` })
      const { data: samples } = await admin.from('device_samples').select('*').eq('session_id', s.id).order('taken_at')
      const list = (samples ?? []).map((x) => ({ ...x, temperature_c: num(x.temperature_c), ph: num(x.ph), tds_ppm: num(x.tds_ppm) }))
      const r = averageSamples(list, s.seconds)
      // a tds sensor that already corrects to 25 °C: work back to ec at the milk's own temperature for the model
      if (device.tds_at_25c && r.tds_ppm !== null && r.temperature_c !== null) {
        const ec25 = r.tds_ppm / 640
        r.ec25_ms = Math.round(ec25 * 1000) / 1000
        r.ec_ms = Math.round(ec25 * (1 + 0.022 * (r.temperature_c - 25)) * 1000) / 1000
      }
      // ai models 1 and 2 on the averaged reading; the database reads their answers for this test
      let m1: Record<string, unknown> = {}, m2: Record<string, unknown> = {}
      if (r.status === 'ok' && r.temperature_c !== null && r.ph !== null && r.ec_ms !== null) {
        try {
          const m = await askModel1(r.temperature_c, r.ph, r.ec_ms)
          await saveModel1(admin, r.temperature_c, r.ph, r.ec_ms, m)
          m1 = { m1_quality: m.quality, m1_freshness: m.freshness_score, m1_shelf_life_h: m.remaining_shelf_life_hours,
                 m1_spoilage_pct: m.spoilage_risk_percent, m1_warnings: m.warnings ?? [] }
        } catch (e) {
          m1 = { m1_error: (e as Error).message.slice(0, 300) }
        }
      }
      if (r.status === 'ok' && r.temperature_c !== null && r.ph !== null && r.ec_ms !== null && r.tds_ppm !== null) {
        try {
          const m = await askModel2(r.temperature_c, r.ph, r.ec_ms, r.tds_ppm)
          await saveModel2(admin, r.temperature_c, r.ph, r.ec_ms, r.tds_ppm, m)
          m2 = { m2_water: m.water_detected, m2_confidence: m.confidence, m2_water_pct: m.water_probability, m2_warnings: m.warnings ?? [] }
        } catch (e) {
          m2 = { m2_error: (e as Error).message.slice(0, 300) }
        }
      }
      const { data: row, error } = await admin.from('device_readings').insert({
        device_serial: device.serial, area_manager_id: center.id, session_id: s.id,
        raw: { samples: list.length, last: samples?.at(-1)?.raw ?? null }, reading_at: new Date().toISOString(), ...r, ...m1, ...m2,
      }).select().single()
      if (error) return reply({ error: error.message }, 500)
      await admin.from('reading_sessions').update({ finished_at: new Date().toISOString(), reading_id: row.id }).eq('id', s.id)
      return reply({ reading: row })
    }

    return reply({ error: 'Unknown action.' }, 400)
  } catch (e) {
    return reply({ error: `Reading failed: ${(e as Error).message}` }, 500)
  }
})
