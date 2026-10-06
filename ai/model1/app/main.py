"""
ApnaDairy Model 1 as a web service (FastAPI).

The IoT test in the portal sends the averaged reading here and gets back:
quality, freshness score, remaining shelf life and spoilage risk.
It loads the trained models/*.joblib files with joblib.load, unchanged.

run locally (from ai/model1):  uvicorn app.main:app --port 7860
  POST /predict  {"temperature": 12.3, "ph": 6.61, "ec": 4.52}
  GET  /health
If the MODEL1_API_KEY environment variable is set, /predict needs the header  X-API-Key: <that key>.
"""
import math
import os
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "models"
FEATURES = ["temperature_c", "ph", "ec_ms_cm", "ec25_est"]

# the values the models were trained on (see README, section 7)
TRAINED_RANGE = {"temperature": (2.5, 40.38), "ph": (4.45, 7.22), "ec": (1.62, 9.0)}
# values a working sensor can never give in milk
POSSIBLE_RANGE = {"temperature": (-5.0, 60.0), "ph": (0.0, 14.0), "ec": (0.0, 30.0)}

quality_model = joblib.load(MODELS / "quality_model.joblib")
freshness_model = joblib.load(MODELS / "freshness_model.joblib")
shelf_life_model = joblib.load(MODELS / "shelf_life_model.joblib")
spoilage_model = joblib.load(MODELS / "spoilage_risk_model.joblib")

app = FastAPI(title="ApnaDairy Model 1", version="1.0.0",
              description="Milk quality, freshness, shelf life and spoilage risk from temperature, pH and EC.")


class Reading(BaseModel):
    temperature: float   # °C
    ph: float
    ec: float            # mS/cm, at the milk's own temperature


def features(r: Reading) -> pd.DataFrame:
    # same engineered feature as training: EC brought to 25 °C
    ec25 = r.ec / (1 + 0.022 * (r.temperature - 25.0))
    return pd.DataFrame([{"temperature_c": r.temperature, "ph": r.ph, "ec_ms_cm": r.ec, "ec25_est": ec25}])[FEATURES]


def predict(r: Reading) -> dict:
    X = features(r)
    quality = str(quality_model.predict(X)[0])
    freshness = float(np.clip(freshness_model.predict(X)[0], 0, 100))
    # the shelf-life forest was trained on log1p(hours), so turn its output back into hours
    shelf_life = float(np.clip(np.expm1(shelf_life_model.predict(X)[0]), 0, 120))
    spoilage = float(np.clip(spoilage_model.predict(X)[0], 0, 100))
    return {
        "quality": quality,
        "freshness_score": round(freshness, 2),
        "remaining_shelf_life_hours": round(shelf_life, 2),
        "spoilage_risk_percent": round(spoilage, 2),
        "ec25_est": round(float(X["ec25_est"].iloc[0]), 3),
    }


@app.get("/")
@app.get("/health")
def health():
    return {"ok": True, "model": "ApnaDairy Model 1", "inputs": ["temperature", "ph", "ec"],
            "outputs": ["quality", "freshness_score", "remaining_shelf_life_hours", "spoilage_risk_percent"],
            "models": {"quality": "SVM (RBF)", "freshness_score": "Random Forest",
                       "remaining_shelf_life_hours": "Random Forest", "spoilage_risk_percent": "Random Forest"},
            "trained_range": TRAINED_RANGE}


@app.post("/predict")
def predict_route(r: Reading, x_api_key: str | None = Header(default=None)):
    key = os.environ.get("MODEL1_API_KEY")
    if key and x_api_key != key:
        raise HTTPException(status_code=401, detail="wrong or missing X-API-Key")

    # a broken sensor reading is an input error, not something to predict on
    for name, (lo, hi) in POSSIBLE_RANGE.items():
        v = getattr(r, name)
        if not math.isfinite(v) or v < lo or v > hi:
            raise HTTPException(status_code=422, detail=f"{name} {v} is not a possible sensor value")

    warnings = [f"{name} {getattr(r, name)} is outside what the model was trained on ({lo} to {hi})"
                for name, (lo, hi) in TRAINED_RANGE.items() if not lo <= getattr(r, name) <= hi]
    return {**predict(r), "warnings": warnings, "temperature": r.temperature, "ph": r.ph, "ec": r.ec}
