"""
answers of the trained .joblib model (through src/predict.py, the team's own code) for test_parity.mjs:
every dataset row, 6,000 random readings and 4,000 readings like the device sends them (ec = tds / 640).
    python3 make_parity_reference.py ref.json
"""
import json
import sys
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
from train_models import BackendFeatures  # noqa: E402,F401  (the model was saved from train_models.py run as a script)
from predict import load_model, predict  # noqa: E402

d = pd.read_csv("data/apnadairy_model2_adulteration_dataset.csv", keep_default_na=False)
rng = np.random.default_rng(7)
rand = np.c_[rng.uniform(-2, 45, 6000), rng.uniform(5.5, 7.8, 6000), rng.uniform(0.5, 14, 6000), rng.uniform(300, 8000, 6000)]
tds = np.round(rng.uniform(800, 5000, 4000), 1)
dev = np.c_[np.round(rng.uniform(2, 40, 4000), 2), np.round(rng.uniform(5.8, 7.4, 4000), 2), np.round(tds / 640, 3), tds]
X = np.vstack([d[["temperature_c", "ph", "ec_ms_cm", "tds_ppm"]].to_numpy(), rand, dev])
model = load_model()["model"]
p_water = model.predict_proba(pd.DataFrame(X, columns=["temperature_c", "ph", "ec_ms_cm", "tds_ppm"]))[:, 1]
out = [predict({"temperature": t, "ph": ph, "ec": ec, "tds": s}) for t, ph, ec, s in X]
json.dump({
    "x": X.tolist(), "p_water": p_water.tolist(),
    "detected": [o["adulteration_detected"] for o in out], "confidence": [o["confidence"] for o in out],
    "warnings": [len(o["warnings"]) for o in out],
}, open(sys.argv[1], "w"))
print(len(X), "readings")
