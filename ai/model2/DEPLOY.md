# Putting Model 2 online

The team's trained Model 2 (added water) runs inside the Supabase `iot-reading` edge function, the same way as Model 1. No separate Python server or extra account is needed.

- Inputs: temperature, pH, EC and TDS of the averaged one-minute device test. EC is the same value Model 1 uses (TDS ÷ 640, or worked back to the milk's temperature when the device's TDS is already at 25 °C).
- Output: whether water was added, the confidence of that answer, and the chance of added water.
- The model: `models/model2_adulteration.joblib`, calibrated HistGradientBoosting (5 folds, sigmoid), classes "No Water" and "Water".

```
IoT device → Firebase "Result" → iot-reading edge function (averages 1 minute of readings, runs Models 1 and 2)
          → saved in Supabase → Record milk, IoT readings, try-it page, marketplace ("AI: no added water")
```

## How it works

- **Export.** `export_for_supabase.py` reads the `.joblib` model (unchanged) and writes every number it needs into `public/model2/apnadairy-model2-v1.bin` (about 83 KB, gzipped).
- **Served by the website.** Vercel serves it with the website: https://apnadairy-psi.vercel.app/model2/apnadairy-model2-v1.bin
- **Loaded by the function.** The edge function downloads it once when it starts and checks its SHA-256 (`MODEL2_SHA256`). It then works out the answer with the same maths as scikit-learn:
  - the two engineered features, `ec25 = ec / (1 + 0.022 (t − 25))` and `tds_ec_ratio = tds / (ec × 1000)`
  - each fold's boosted trees (x ≤ threshold goes left), then its sigmoid, then the mean of the 5 folds
- **Checked against the original.** `test_parity.mjs` compares the function's model code with `src/predict.py` on 15,000 readings:
  - all 5,000 dataset rows
  - 6,000 random readings
  - 4,000 readings like the device sends them

  Result: 0 answers, 0 confidences and 0 warning counts differ. The chance of water differs by at most 0.0000000000000002.

## What the portal does with it

- Shown only: it never refuses milk and never changes the price.
- 50% chance of water or more is "added water", 80% or more is shown as detected, 50 to 80% as suspected.
- A listing shows "AI: no added water" when every fresh batch it sells was under 50%.

## Setup

1. Run `supabase/44_model2.sql` in the SQL editor.
2. Edge Functions → `iot-reading` → paste `supabase/functions/iot-reading/index.ts` → **Deploy**.
3. Admin → IoT devices → **Check the models**. It should say both models are ready.

## If the ML team retrains the model

1. Put the new `model2_adulteration.joblib` in `models/`.
2. Run `python3 export_for_supabase.py`. It prints a new sha256.
3. Put that sha256 in `MODEL2_SHA256` in `supabase/functions/iot-reading/index.ts`.
4. Run `python3 make_parity_reference.py ref.json` and `node --experimental-strip-types test_parity.mjs ref.json`. It must report 0 differences.
5. Push (the website serves the new file), then redeploy `iot-reading`.

## Notes for the ML side

- The saved model is the water-only version (`src/train_models.py`). The README still describes the older five-class model (water, urea, salt, sugar).
- The device has no separate EC probe, so EC comes from TDS. The model also uses the TDS/EC ratio, which is then the same for every test (0.64; the training data is around 0.52). The answers on device readings still look sensible (normal milk at 2,600 to 3,500 ppm has a low chance of water, 1,800 ppm a high one), but retraining on real device readings would make it more reliable.
