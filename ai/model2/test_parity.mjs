// checks that ai model 2 inside the iot-reading edge function gives the same answers as the trained model.
//   python3 export_for_supabase.py            (writes the model file the function downloads)
//   python3 make_parity_reference.py ref.json (answers of src/predict.py on the dataset and random readings)
//   node --experimental-strip-types test_parity.mjs ref.json
// it runs the model code copied straight from supabase/functions/iot-reading/index.ts (between the model2 markers).
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = readFileSync(join(here, '../../supabase/functions/iot-reading/index.ts'), 'utf8')
const code = src.slice(src.indexOf('// --- model2-start ---'), src.indexOf('// --- model2-end ---'))
const dir = mkdtempSync(join(tmpdir(), 'm2-'))
writeFileSync(join(dir, 'm2.ts'), `${code}\nexport { parseModel2, runModel2, m2Proba }\n`)
const { parseModel2, runModel2, m2Proba } = await import(join(dir, 'm2.ts'))

const m = parseModel2(new Uint8Array(gunzipSync(readFileSync(join(here, '../../public/model2/apnadairy-model2-v1.bin')))))
const ref = JSON.parse(readFileSync(process.argv[2], 'utf8'))
let classDiff = 0, confDiff = 0, warnDiff = 0, worst = 0, water = 0
ref.x.forEach(([t, ph, ec, tds], i) => {
  const x = [t, ph, ec, tds, ec / (1 + 0.022 * (t - 25.0)), tds / (ec * 1000.0)]
  worst = Math.max(worst, Math.abs(m2Proba(m, x).water - ref.p_water[i]))
  const r = runModel2(m, t, ph, ec, tds)
  if ((r.water_detected ? 'Yes' : 'No') !== ref.detected[i]) classDiff++
  if (r.confidence !== ref.confidence[i]) confDiff++
  if (r.warnings.length !== ref.warnings[i]) warnDiff++
  if (r.water_detected) water++
})
console.log(`${ref.x.length} readings (${water} water): ${classDiff} answers differ, ${confDiff} confidences differ, ${warnDiff} warning counts differ`)
console.log('largest difference in P(water) before rounding:', worst)
process.exit(classDiff || confDiff || warnDiff ? 1 : 0)
