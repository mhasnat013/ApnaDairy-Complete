# Putting Model 1 online

The team's trained Model 1 runs inside the Supabase `iot-reading` edge function. No separate Python server or extra account is needed.

- Quality: SVM.
- Freshness score, shelf life and spoilage risk: random forests.

```
IoT device → Firebase "Result" → iot-reading edge function (averages 1 minute of readings, runs Model 1)
          → saved in Supabase → Record milk, IoT readings, stock, listings
```

## How it works

- **Export.** `export_for_supabase.py` reads `models/*.joblib` (unchanged) and writes every number the models need into one file, `public/model1/apnadairy-model1-v1.bin` (about 2 MB, gzipped).
- **Served by the website.** The file is in `public/`, so Vercel serves it with the website: https://apnadairy-psi.vercel.app/model1/apnadairy-model1-v1.bin
- **Loaded by the function.** The edge function downloads it once when it starts and checks its SHA-256 (`MODEL1_SHA256` in the function). It then computes the four answers with the same maths as scikit-learn:
  - the scaler, the RBF kernel and libsvm's one-against-one vote for the SVM
  - float32 splits and the mean of the trees for the forests
  - `expm1` for shelf life, then the same clipping as `app/main.py`
- **Checked against the originals.** `test_parity.mjs` compares the function's model code with the `.joblib` models on 15,000 readings:
  - all 5,000 dataset rows
  - 6,000 random readings
  - 4,000 readings rounded like the device sends them

  Result: 0 quality classes differ, and the numbers differ by less than 0.000000000001 before rounding.

## Setup

1. Run `supabase/41_model1.sql` in the SQL editor.
2. Edge Functions → `iot-reading` → paste `supabase/functions/iot-reading/index.ts` → **Deploy**.
3. Admin → IoT devices → **Check the models**. It should say both models are ready.

If the model file cannot be loaded, the database gives the same four outputs, so recording never stops. Nothing on screen says which one answered; `device_readings.m1_error` keeps the reason for the team.

## If the ML team retrains the models

1. Put the new `.joblib` files in `models/`.
2. Run `python3 export_for_supabase.py`. It prints a new sha256.
3. Put that sha256 in `MODEL1_SHA256` in `supabase/functions/iot-reading/index.ts`.
4. Run `python3 make_parity_reference.py ref.json` and `node --experimental-strip-types test_parity.mjs ref.json`. It must report 0 differences.
5. Push (the website serves the new file), then redeploy `iot-reading`.

## The Python service (optional)

`app/main.py` is the same model as a FastAPI service, for running it on your own computer:

```
pip install -r api_requirements.txt
uvicorn app.main:app --port 7860
```

Then open http://localhost:7860/docs and try `/predict` with `{"temperature": 5, "ph": 6.78, "ec": 4.46}`. The portal does not need it.

## Notes for the ML side

- **Shelf life is converted back to hours.**
  - The shelf-life forest was trained on `log1p(hours)` (`src/train_optimized.py`), so the answer is turned back into hours with `expm1`.
  - The team's `src/predict.py` in the shared zip does not do this yet. Without it, every result is at most 4.8 "hours" (the log value). The copy here is fixed.
- **EC sent to the model is `TDS ÷ 640`** (team formula).
  - If the firmware's TDS is already corrected to 25 °C, turn on "TDS sensor corrects to 25 °C" for that device on the admin IoT devices page.
- **Out-of-range and impossible readings are handled.**
  - Readings outside the training range get warnings.
  - Impossible values (for example negative EC) are refused, as the README asks.
- **Quality comes straight from the SVM, as the README asks.**
  - No decision layer is added yet, so quality and freshness can disagree. For example, a sample at 5 °C can be rated "Poor" with a freshness score of 84.
  - The grade follows the quality class: Good = Premium, Acceptable = Fresh, Poor = Standard, and Spoiled milk is not bought.
