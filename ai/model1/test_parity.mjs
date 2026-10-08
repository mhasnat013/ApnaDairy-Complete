// checks that ai model 1 inside the iot-reading edge function gives the same answers as the trained models.
//   python3 export_for_supabase.py            (writes the model file the function downloads)
//   python3 make_parity_reference.py ref.json (answers of the .joblib models on the dataset and random readings)
//   node test_parity.mjs ref.json
// it runs the model code copied straight from supabase/functions/iot-reading/index.ts (between the model1 markers).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../../supabase/functions/iot-reading/index.ts'), 'utf8')
const code = src.slice(src.indexOf('// --- model1-start ---'), src.indexOf('// --- model1-end ---'))
const dir = mkdtempSync(join(tmpdir(), 'm1-'))
writeFileSync(join(dir, 'm1.ts'), `${code}\nexport { parseModel1, runModel1, m1Quality, m1Forest }\n`)
const { parseModel1, runModel1, m1Quality, m1Forest } = await import(join(dir, 'm1.ts'))

const m = parseModel1(new Uint8Array(gunzipSync(readFileSync(join(here, '../../public/model1/apnadairy-model1-v1.bin')))))
const ref = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let classDiff = 0, worst = { fresh: 0, shelf: 0, spoil: 0 }, roundDiff = 0
ref.x.forEach(([t, ph, ec], i) => {
  const x = [t, ph, ec, ec / (1 + 0.022 * (t - 25.0))], x32 = Float32Array.from(x)
  if (m1Quality(m.q, x) !== ref.quality[i]) classDiff++
  const got = { fresh: m1Forest(m.freshness, x32), shelf: Math.expm1(m1Forest(m.shelf, x32)), spoil: m1Forest(m.spoilage, x32) }
  for (const k of Object.keys(got)) worst[k] = Math.max(worst[k], Math.abs(got[k] - ref[k][i]))
  // the rounded answers the portal stores, against the same rounding of the trained models' answers
  if (t >= 0 && ph > 0 && ec > 0) {
    const r = runModel1(m, t, ph, ec)
    const clip = (v, hi) => Number(Math.min(hi, Math.max(0, v)).toFixed(2))
    if (r.freshness_score !== clip(ref.fresh[i], 100) || r.remaining_shelf_life_hours !== clip(ref.shelf[i], 120) || r.spoilage_risk_percent !== clip(ref.spoil[i], 100)) roundDiff++
  }
})
console.log(`${ref.x.length} readings: ${classDiff} quality classes differ, ${roundDiff} rounded answers differ`)
console.log('largest difference before rounding:', worst)
process.exit(classDiff || roundDiff ? 1 : 0)
