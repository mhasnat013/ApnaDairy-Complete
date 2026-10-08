#!/usr/bin/env python3

"""
APNADAIRY Model 2 - Water Adulteration Detection

Purpose:
    Detect whether milk has been adulterated with WATER.

Inputs:
    temperature_c
    ph
    ec_ms_cm
    tds_ppm

Target:
    Water
    No Water

The original dataset contains:
    None, Water, Urea, Salt, Sugar

For APNADAIRY deployment:
    Water -> Water
    Everything else -> No Water

The model therefore answers only:
    "Is water adulteration detected?"
"""

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

from sklearn.base import BaseEstimator, TransformerMixin
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    balanced_accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    confusion_matrix,
)
from sklearn.model_selection import (
    StratifiedKFold,
    cross_val_predict,
    train_test_split,
)
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.ensemble import RandomForestClassifier


ROOT = Path(__file__).resolve().parent.parent

SEED = 42

INPUTS = [
    "temperature_c",
    "ph",
    "ec_ms_cm",
    "tds_ppm",
]

TARGETS = ["No Water", "Water"]


class BackendFeatures(BaseEstimator, TransformerMixin):
    """
    Deterministic features calculated only from the four IoT readings.
    """

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = pd.DataFrame(X, columns=INPUTS)

        out = X.copy()

        # EC normalized approximately to 25 C
        out["ec25"] = (
            X["ec_ms_cm"]
            / (1 + 0.022 * (X["temperature_c"] - 25.0))
        )

        # TDS / EC relationship
        out["tds_ec_ratio"] = (
            X["tds_ppm"]
            / (X["ec_ms_cm"] * 1000.0)
        )

        return out.values


def make_models():

    feature_pipeline = lambda estimator: make_pipeline(
        BackendFeatures(),
        estimator
    )

    return {
        "Logistic Regression": feature_pipeline(
            make_pipeline(
                StandardScaler(),
                LogisticRegression(
                    max_iter=3000,
                    C=2,
                    random_state=SEED
                )
            )
        ),

        "Random Forest": feature_pipeline(
            RandomForestClassifier(
                n_estimators=400,
                min_samples_leaf=5,
                random_state=SEED,
                n_jobs=-1
            )
        ),

        "SVM": feature_pipeline(
            make_pipeline(
                StandardScaler(),
                SVC(
                    C=3,
                    probability=True,
                    random_state=SEED
                )
            )
        ),

        "HistGradientBoosting": feature_pipeline(
            HistGradientBoostingClassifier(
                max_depth=3,
                learning_rate=0.05,
                max_iter=200,
                random_state=SEED
            )
        ),
    }


def main():

    # ---------------------------------------------------------
    # Load dataset
    # ---------------------------------------------------------

    data_path = (
        ROOT
        / "data"
        / "apnadairy_model2_adulteration_dataset.csv"
    )

    df = pd.read_csv(
        data_path,
        keep_default_na=False
    )

    # ---------------------------------------------------------
    # Convert original 5-class target to Water / No Water
    # ---------------------------------------------------------

    df["water_target"] = np.where(
        df["adulteration_type"] == "Water",
        "Water",
        "No Water"
    )

    X = df[INPUTS]
    y = df["water_target"]

    print("\nAPNADAIRY MODEL 2")
    print("=================")
    print("Target: Water Adulteration Detection\n")

    print("Target distribution:")
    print(y.value_counts())
    print()

    # ---------------------------------------------------------
    # Hold out final test set
    # ---------------------------------------------------------

    Xpool, Xtest, ypool, ytest = train_test_split(
        X,
        y,
        test_size=0.15,
        stratify=y,
        random_state=SEED
    )

    # ---------------------------------------------------------
    # Cross-validation model comparison
    # ---------------------------------------------------------

    cv = StratifiedKFold(
        n_splits=5,
        shuffle=True,
        random_state=SEED
    )

    rows = []

    print("MODEL COMPARISON")
    print("================")

    for name, model in make_models().items():

        predictions = cross_val_predict(
            model,
            Xpool,
            ypool,
            cv=cv
        )

        accuracy = accuracy_score(
            ypool,
            predictions
        )

        balanced_acc = balanced_accuracy_score(
            ypool,
            predictions
        )

        f1 = f1_score(
            ypool,
            predictions,
            pos_label="Water"
        )

        precision = precision_score(
            ypool,
            predictions,
            pos_label="Water"
        )

        recall = recall_score(
            ypool,
            predictions,
            pos_label="Water"
        )

        rows.append({
            "model": name,
            "accuracy": accuracy,
            "balanced_accuracy": balanced_acc,
            "precision_water": precision,
            "recall_water": recall,
            "f1_water": f1,
        })

    results = pd.DataFrame(rows).round(3)

    print(
        results.to_string(index=False)
    )

    # ---------------------------------------------------------
    # Final model
    # ---------------------------------------------------------

    print("\nFINAL MODEL")
    print("===========")

    base_model = make_pipeline(
        BackendFeatures(),
        HistGradientBoostingClassifier(
            max_depth=3,
            learning_rate=0.05,
            max_iter=200,
            random_state=SEED
        )
    )

    final_model = CalibratedClassifierCV(
        base_model,
        method="sigmoid",
        cv=5
    )

    final_model.fit(
        Xpool,
        ypool
    )

    # ---------------------------------------------------------
    # Evaluate on untouched test set
    # ---------------------------------------------------------

    predictions = final_model.predict(Xtest)

    accuracy = accuracy_score(
        ytest,
        predictions
    )

    balanced_acc = balanced_accuracy_score(
        ytest,
        predictions
    )

    precision = precision_score(
        ytest,
        predictions,
        pos_label="Water"
    )

    recall = recall_score(
        ytest,
        predictions,
        pos_label="Water"
    )

    f1 = f1_score(
        ytest,
        predictions,
        pos_label="Water"
    )

    print(
        f"Test accuracy:           {accuracy:.3f}"
    )

    print(
        f"Balanced accuracy:       {balanced_acc:.3f}"
    )

    print(
        f"Water precision:         {precision:.3f}"
    )

    print(
        f"Water recall:            {recall:.3f}"
    )

    print(
        f"Water F1:                {f1:.3f}"
    )

    # ---------------------------------------------------------
    # Confusion matrix
    # ---------------------------------------------------------

    cm = confusion_matrix(
        ytest,
        predictions,
        labels=TARGETS
    )

    print("\nConfusion Matrix")
    print("================")
    print(
        pd.DataFrame(
            cm,
            index=["Actual No Water", "Actual Water"],
            columns=["Predicted No Water", "Predicted Water"]
        )
    )

    # ---------------------------------------------------------
    # Refit deployment model on ALL 5,000 rows
    # ---------------------------------------------------------

    print("\nTraining deployment model on all 5,000 rows...")

    deployment_model = CalibratedClassifierCV(
        make_pipeline(
            BackendFeatures(),
            HistGradientBoostingClassifier(
                max_depth=3,
                learning_rate=0.05,
                max_iter=200,
                random_state=SEED
            )
        ),
        method="sigmoid",
        cv=5
    )

    deployment_model.fit(
        X,
        y
    )

    # ---------------------------------------------------------
    # Save model
    # ---------------------------------------------------------

    models_dir = ROOT / "models"
    models_dir.mkdir(exist_ok=True)

    model_bundle = {
        "model": deployment_model,
        "classes": list(deployment_model.classes_),
        "inputs": INPUTS,
        "train_ranges": {
            column: [
                float(X[column].min()),
                float(X[column].max())
            ]
            for column in INPUTS
        },
        "target": "Water adulteration only",
        "note": (
            "Synthetic-data prototype. "
            "Retrain and validate with real IoT and laboratory "
            "verified milk samples before production use."
        ),
    }

    joblib.dump(
        model_bundle,
        models_dir / "model2_adulteration.joblib"
    )

    # ---------------------------------------------------------
    # Save model card
    # ---------------------------------------------------------

    model_card = {
        "model": "APNADAIRY Model 2",
        "purpose": "Water adulteration detection",
        "inputs": INPUTS,
        "outputs": [
            "Water",
            "No Water"
        ],
        "dataset_rows": len(df),
        "training_type": "Synthetic prototype",
        "final_model": (
            "HistGradientBoosting + sigmoid calibration"
        ),
        "test_accuracy": round(float(accuracy), 3),
        "test_balanced_accuracy": round(
            float(balanced_acc), 3
        ),
        "water_precision": round(
            float(precision), 3
        ),
        "water_recall": round(
            float(recall), 3
        ),
        "water_f1": round(
            float(f1), 3
        ),
    }

    (
        models_dir / "model_card.json"
    ).write_text(
        json.dumps(
            model_card,
            indent=2
        )
    )

    # ---------------------------------------------------------
    # Save results
    # ---------------------------------------------------------

    results_dir = ROOT / "results"
    results_dir.mkdir(exist_ok=True)

    results.to_markdown(
        results_dir / "model_comparison.md",
        index=False
    )

    final_results = f"""
# APNADAIRY Model 2 - Water Adulteration Detection

## Purpose

This model detects whether the milk sample contains **water adulteration**.

The original dataset contains five classes:

- None
- Water
- Urea
- Salt
- Sugar

For APNADAIRY deployment, the target is converted to binary:

- Water -> Water
- None, Urea, Salt, Sugar -> No Water

## IoT Inputs

- Temperature
- pH
- EC
- TDS

## Final Model

HistGradientBoosting + sigmoid probability calibration.

## Test Results

- Accuracy: {accuracy:.3f}
- Balanced Accuracy: {balanced_acc:.3f}
- Water Precision: {precision:.3f}
- Water Recall: {recall:.3f}
- Water F1: {f1:.3f}

## Important Limitation

This model was trained using synthetic data.

Real deployment requires real IoT readings paired with laboratory-verified water-adulteration results.
"""

    (
        results_dir / "final_model_results.md"
    ).write_text(
        final_results.strip()
    )

    print(
        "\nModel saved successfully:"
    )

    print(
        models_dir / "model2_adulteration.joblib"
    )

    print(
        "\nModel 2 is now configured for WATER ADULTERATION ONLY."
    )


if __name__ == "__main__":
    main()