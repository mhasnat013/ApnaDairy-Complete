"""
answers of the trained .joblib models (through app/main.py's loaded models) for test_parity.mjs:
every dataset row, 6,000 random readings and 4,000 readings rounded like the device sends them.
    python3 make_parity_reference.py ref.json
"""
import json
import sys
import warnings

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
from app.main import FEATURES, freshness_model, quality_model, shelf_life_model, spoilage_model  # noqa: E402

d = pd.read_csv("data/apnadairy_model1_dataset.csv")
rng = np.random.default_rng(7)
rand = np.c_[rng.uniform(-2, 45, 6000), rng.uniform(4, 7.6, 6000), rng.uniform(0.5, 10, 6000)]
dev = np.c_[np.round(rng.uniform(2, 40, 4000), 2), np.round(rng.uniform(5.5, 7.1, 4000), 2), np.round(rng.uniform(2, 8, 4000), 3)]
X = np.vstack([d[["temperature_c", "ph", "ec_ms_cm"]].to_numpy(), rand, dev])
df = pd.DataFrame(X, columns=["temperature_c", "ph", "ec_ms_cm"])
df["ec25_est"] = df.ec_ms_cm / (1 + 0.022 * (df.temperature_c - 25.0))
df = df[FEATURES]
json.dump({
    "x": X.tolist(), "quality": quality_model.predict(df).astype(str).tolist(),
    "fresh": freshness_model.predict(df).tolist(), "shelf": np.expm1(shelf_life_model.predict(df)).tolist(),
    "spoil": spoilage_model.predict(df).tolist(),
}, open(sys.argv[1], "w"))
print(len(X), "readings")
