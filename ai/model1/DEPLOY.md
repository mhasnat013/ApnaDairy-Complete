# Putting Model 1 online

The portal sends every IoT milk test to this FastAPI service and shows its answer:
quality (SVM), freshness score, remaining shelf life and spoilage risk (random forests).
The service loads `models/*.joblib` with `joblib.load`, unchanged.

```
IoT device → Firebase "Result" → iot-reading edge function (averages 1 minute of readings)
          → Model 1 service (this folder) → saved in Supabase → Record milk, IoT readings, AI price engine
```

## 1. Hugging Face Space (free)

1. huggingface.co → New Space. Name it e.g. `apnadairy-model1`. SDK: **Docker**, template: **Blank**. Public is fine.
2. Files → Add file → Upload files. Upload from this folder, keeping the folders:
   - `Dockerfile`
   - `api_requirements.txt`
   - `app/main.py` and `app/__init__.py`
   - `models/quality_model.joblib`, `models/freshness_model.joblib`, `models/shelf_life_model.joblib`, `models/spoilage_risk_model.joblib`
3. Settings → Variables and secrets → **New secret**: `MODEL1_API_KEY` = any long random text. Only callers that know it can use the model.
4. Wait until the Space says **Running**. Then open `https://<your-name>-apnadairy-model1.hf.space/health`. It should answer `{"ok": true, ...}`.

## 2. Supabase

1. Run `supabase/26_model1.sql` in the SQL editor.
2. Edge Functions → Secrets → add:
   - `MODEL1_URL` = `https://<your-name>-apnadairy-model1.hf.space`
   - `MODEL1_KEY` = the same text as `MODEL1_API_KEY`
3. Edge Functions → `iot-reading` → paste the new `supabase/functions/iot-reading/index.ts` → Deploy.

## 3. Check it

- Record milk → take a reading → the AI card shows **"Model 1: trained SVM + random forests"**.
- If it shows **"Model 1 not reached, backup rules used"**, check the Space is running and the two secrets.
- A free Space goes to sleep after two days without use. Open the `/health` link a minute before a demo to wake it.

## Run it on your own computer

```
pip install -r api_requirements.txt
uvicorn app.main:app --port 7860
```
Then open http://localhost:7860/docs to try `/predict` with `{"temperature": 5, "ph": 6.78, "ec": 4.46}`.

## Notes for the ML side

- The shelf-life forest was trained on `log1p(hours)`, so its output is turned back into hours with `expm1`.
  `src/predict.py` now does this too (before, it printed the log value, e.g. "4.4 hours" instead of about 80).
- EC sent to the model is `TDS ÷ 640` (team formula). If the firmware's TDS is already corrected to 25 °C,
  turn on "TDS sensor corrects to 25 °C" for that device on the admin IoT devices page.
- Readings outside the training range come back with a `warnings` list; impossible values (e.g. negative EC) are refused.
