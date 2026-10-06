#!/usr/bin/env python3
"""
APNADAIRY Model 1 - Final Model Training

Inputs:
    temperature_c
    ph
    ec_ms_cm

Outputs:
    1. Quality
    2. Freshness Score
    3. Remaining Shelf Life
    4. Spoilage Risk

The test set is used only once for final evaluation.
Final models are trained on train + validation data
and saved in the models/ folder.
"""

import os
import numpy as np
import pandas as pd
import joblib

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

from sklearn.svm import SVC, SVR
from sklearn.ensemble import HistGradientBoostingRegressor

from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    r2_score,
    confusion_matrix
)


# ============================================================
# SETTINGS
# ============================================================

SEED = 42

DATA_PATH = "data/apnadairy_model1_dataset.csv"
MODEL_DIR = "models"

ORDER = ["Good", "Acceptable", "Poor", "Spoiled"]

RAW = [
    "temperature_c",
    "ph",
    "ec_ms_cm"
]


# ============================================================
# LOAD DATA
# ============================================================

df = pd.read_csv(DATA_PATH)

# EC normalized to approximately 25°C
df["ec25_est"] = df["ec_ms_cm"] / (
    1 + 0.022 * (df["temperature_c"] - 25.0)
)

FEATS = RAW + ["ec25_est"]


# ============================================================
# TRAIN / VALIDATION / TEST SPLIT
# ============================================================

train_val, test = train_test_split(
    df,
    test_size=0.15,
    stratify=df["quality"],
    random_state=SEED
)

train, val = train_test_split(
    train_val,
    test_size=0.15 / 0.85,
    stratify=train_val["quality"],
    random_state=SEED
)

print(
    f"Train: {len(train)} | "
    f"Validation: {len(val)} | "
    f"Test: {len(test)}"
)

print("\nSelected final models:")
print("Quality          -> SVM (RBF)")
print("Freshness Score  -> HistGradientBoosting")
print("Shelf Life       -> SVR (RBF)")
print("Spoilage Risk    -> HistGradientBoosting")


# ============================================================
# COMBINE TRAIN + VALIDATION FOR FINAL TRAINING
# ============================================================

final_train = pd.concat([train, val], ignore_index=True)

X_train = final_train[FEATS]
X_test = test[FEATS]


# ============================================================
# 1. QUALITY MODEL
# ============================================================

quality_model = make_pipeline(
    StandardScaler(),
    SVC(
        C=3,
        probability=True,
        random_state=SEED
    )
)

quality_model.fit(
    X_train,
    final_train["quality"]
)

quality_pred = quality_model.predict(X_test)

quality_accuracy = accuracy_score(
    test["quality"],
    quality_pred
)

quality_f1 = f1_score(
    test["quality"],
    quality_pred,
    average="macro"
)

cm = confusion_matrix(
    test["quality"],
    quality_pred,
    labels=ORDER
)

print("\n================ QUALITY ================")
print(f"Accuracy : {quality_accuracy:.3f}")
print(f"Macro F1 : {quality_f1:.3f}")
print("\nConfusion Matrix:")
print(
    pd.DataFrame(
        cm,
        index=[f"True {x}" for x in ORDER],
        columns=[f"Pred {x}" for x in ORDER]
    )
)


# ============================================================
# 2. FRESHNESS SCORE MODEL
# ============================================================

freshness_model = HistGradientBoostingRegressor(
    max_depth=4,
    learning_rate=0.05,
    max_iter=300,
    random_state=SEED
)

freshness_model.fit(
    X_train,
    final_train["freshness_score"]
)

freshness_pred = np.clip(
    freshness_model.predict(X_test),
    0,
    100
)

freshness_mae = mean_absolute_error(
    test["freshness_score"],
    freshness_pred
)

freshness_r2 = r2_score(
    test["freshness_score"],
    freshness_pred
)

print("\n============= FRESHNESS SCORE =============")
print(f"MAE : {freshness_mae:.3f}")
print(f"R2  : {freshness_r2:.3f}")


# ============================================================
# 3. REMAINING SHELF LIFE MODEL
# ============================================================

shelf_life_model = make_pipeline(
    StandardScaler(),
    SVR(C=30)
)

# Log transform because shelf life is non-negative
y_shelf_train = np.log1p(
    final_train["remaining_shelf_life_hours"]
)

shelf_life_model.fit(
    X_train,
    y_shelf_train
)

shelf_life_pred = shelf_life_model.predict(X_test)

shelf_life_pred = np.clip(
    np.expm1(shelf_life_pred),
    0,
    120
)

shelf_life_mae = mean_absolute_error(
    test["remaining_shelf_life_hours"],
    shelf_life_pred
)

shelf_life_r2 = r2_score(
    test["remaining_shelf_life_hours"],
    shelf_life_pred
)

print("\n=========== SHELF LIFE ===========")
print(f"MAE : {shelf_life_mae:.3f} hours")
print(f"R2  : {shelf_life_r2:.3f}")


# ============================================================
# 4. SPOILAGE RISK MODEL
# ============================================================

spoilage_model = HistGradientBoostingRegressor(
    max_depth=4,
    learning_rate=0.05,
    max_iter=300,
    random_state=SEED
)

spoilage_model.fit(
    X_train,
    final_train["spoilage_risk_percent"]
)

spoilage_pred = np.clip(
    spoilage_model.predict(X_test),
    0,
    100
)

spoilage_mae = mean_absolute_error(
    test["spoilage_risk_percent"],
    spoilage_pred
)

spoilage_r2 = r2_score(
    test["spoilage_risk_percent"],
    spoilage_pred
)

print("\n========== SPOILAGE RISK ==========")
print(f"MAE : {spoilage_mae:.3f}%")
print(f"R2  : {spoilage_r2:.3f}")


# ============================================================
# SAVE MODELS
# ============================================================

os.makedirs(MODEL_DIR, exist_ok=True)

joblib.dump(
    quality_model,
    os.path.join(MODEL_DIR, "quality_model.joblib")
)

joblib.dump(
    freshness_model,
    os.path.join(MODEL_DIR, "freshness_model.joblib")
)

joblib.dump(
    shelf_life_model,
    os.path.join(MODEL_DIR, "shelf_life_model.joblib")
)

joblib.dump(
    spoilage_model,
    os.path.join(MODEL_DIR, "spoilage_risk_model.joblib")
)


# ============================================================
# SAVE MODEL INFORMATION
# ============================================================

results = f"""
# APNADAIRY Model 1 - Final Model Results

## Dataset

- Total samples: {len(df)}
- Training samples: {len(final_train)}
- Final test samples: {len(test)}
- Random seed: {SEED}

## Input Features

1. temperature_c
2. ph
3. ec_ms_cm
4. ec25_est (engineered from EC and temperature)

## Final Models

| Target | Model |
|---|---|
| Quality | SVM (RBF) |
| Freshness Score | HistGradientBoosting |
| Remaining Shelf Life | SVR (RBF) |
| Spoilage Risk | HistGradientBoosting |

## Final Test Results

### Quality

- Accuracy: {quality_accuracy:.3f}
- Macro F1: {quality_f1:.3f}

### Freshness Score

- MAE: {freshness_mae:.3f}
- R2: {freshness_r2:.3f}

### Remaining Shelf Life

- MAE: {shelf_life_mae:.3f} hours
- R2: {shelf_life_r2:.3f}

### Spoilage Risk

- MAE: {spoilage_mae:.3f}%
- R2: {spoilage_r2:.3f}
"""

with open(
    "results/final_model_results.md",
    "w",
    encoding="utf-8"
) as f:
    f.write(results)


print("\n========================================")
print("ALL 4 MODELS TRAINED SUCCESSFULLY")
print("========================================")

print("\nSaved models:")

print("models/quality_model.joblib")
print("models/freshness_model.joblib")
print("models/shelf_life_model.joblib")
print("models/spoilage_risk_model.joblib")

print("\nResults saved to:")
print("results/final_model_results.md")