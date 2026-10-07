# Putting Model 1 online

Every IoT milk test is sent to this FastAPI service, and the portal shows its answer:
quality (SVM), freshness score, remaining shelf life and spoilage risk (random forests).
The service loads `models/*.joblib` with `joblib.load`, unchanged.

```
IoT device → Firebase "Result" → iot-reading edge function (averages 1 minute of readings)
          → Model 1 service (this folder) → saved in Supabase → Record milk, IoT readings, stock, listings
```

## 1. Hugging Face Space (free)

1. Make a free account at huggingface.co, then **New Space**.
   - Name: `apnadairy-model1`
   - SDK: **Docker**, template **Blank**
   - Public is fine; the key below protects it.
2. Files → **Add file → Upload files**. Upload these from this folder, keeping the folders:
   - `Dockerfile`
   - `api_requirements.txt`
   - `app/main.py` and `app/__init__.py`
   - the four files in `models/`
3. Settings → Variables and secrets → **New secret**:
   - Name: `MODEL1_API_KEY`
   - Value: any long random text. Only callers that know it can use the model.
4. Wait until the Space says **Running**.
5. Open `https://<your-name>-apnadairy-model1.hf.space/health`. It should answer `{"ok": true, ...}`.

## 2. Supabase

1. Run `supabase/41_model1.sql` in the SQL editor.
2. Edge Functions → Secrets → add:
   - `MODEL1_URL` = `https://<your-name>-apnadairy-model1.hf.space`
   - `MODEL1_KEY` = the same text as `MODEL1_API_KEY`
3. Edge Functions → `iot-reading` → paste `supabase/functions/iot-reading/index.ts` → **Deploy**.

## 3. Check it

- Admin → IoT devices → **Check the model server**. It should say the server is awake and answering.
- The same card counts how many tests in the last 7 days the trained model answered.
- A free Space sleeps after two days without use.
  - The portal wakes it when the Record milk page opens, so it is ready before the one-minute test ends.
  - Before a demo, you can also open the `/health` link once.
- If the model cannot answer a test, the backup rules give the same four results, so recording never stops.

## Run it on your own computer

```
pip install -r api_requirements.txt
uvicorn app.main:app --port 7860
```

Then open http://localhost:7860/docs and try `/predict` with `{"temperature": 5, "ph": 6.78, "ec": 4.46}`.

## Notes for the ML side

- **Shelf life is converted back to hours.**
  - The shelf-life forest was trained on `log1p(hours)` (`src/train_optimized.py`), so the service turns its output back into hours with `expm1`.
  - The team's `src/predict.py` in the shared zip does not do this yet. Without it, every result is at most 4.8 "hours" (the log value). The copy here is fixed.
- **EC sent to the model is `TDS ÷ 640`** (team formula).
  - If the firmware's TDS is already corrected to 25 °C, turn on "TDS sensor corrects to 25 °C" for that device on the admin IoT devices page.
- **Out-of-range and impossible readings are handled.**
  - Readings outside the training range come back with a `warnings` list.
  - Impossible values (for example negative EC) are refused, as the README asks.
- **Quality comes straight from the SVM, as the README asks.**
  - No decision layer is added yet, so quality and freshness can disagree. For example, a sample at 5 °C can be rated "Poor" with a freshness score of 84.
  - The grade follows the quality class: Good = Premium, Acceptable = Fresh, Poor = Standard, and Spoiled milk is not bought.
