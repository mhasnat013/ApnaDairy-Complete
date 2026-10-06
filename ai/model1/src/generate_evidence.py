import os
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    r2_score,
    confusion_matrix,
    ConfusionMatrixDisplay,
)

import joblib


# ============================================================
# 1. PATHS
# ============================================================

DATA_PATH = "data/apnadairy_model1_dataset.csv"
MODEL_DIR = "models"
RESULTS_DIR = "results"

os.makedirs(RESULTS_DIR, exist_ok=True)


# ============================================================
# 2. LOAD DATA
# ============================================================

df = pd.read_csv(DATA_PATH)

# Same engineered feature used during training
df["ec25_est"] = df["ec_ms_cm"] / (
    1 + 0.022 * (df["temperature_c"] - 25)
)

FEATURES = [
    "temperature_c",
    "ph",
    "ec_ms_cm",
    "ec25_est",
]

X = df[FEATURES]

y_quality = df["quality"]
y_freshness = df["freshness_score"]
y_shelf = df["remaining_shelf_life_hours"]
y_risk = df["spoilage_risk_percent"]


# ============================================================
# 3. RECREATE THE SAME TEST SPLIT
# ============================================================

train_val, test = train_test_split(
    df,
    test_size=0.15,
    stratify=df["quality"],
    random_state=42
)

X_test = test[FEATURES]

y_quality_test = test["quality"]
y_freshness_test = test["freshness_score"]
y_shelf_test = test["remaining_shelf_life_hours"]
y_risk_test = test["spoilage_risk_percent"]


# ============================================================
# 4. LOAD FINAL TRAINED MODELS
# ============================================================

quality_model = joblib.load(
    os.path.join(MODEL_DIR, "quality_model.joblib")
)

freshness_model = joblib.load(
    os.path.join(MODEL_DIR, "freshness_model.joblib")
)

shelf_model = joblib.load(
    os.path.join(MODEL_DIR, "shelf_life_model.joblib")
)

risk_model = joblib.load(
    os.path.join(MODEL_DIR, "spoilage_risk_model.joblib")
)


# ============================================================
# 5. PREDICTIONS
# ============================================================

quality_pred = quality_model.predict(X_test)

freshness_pred = freshness_model.predict(X_test)

# Shelf-life model was trained using log1p()
shelf_pred = np.expm1(
    shelf_model.predict(X_test)
)

risk_pred = risk_model.predict(X_test)

# Keep predictions within meaningful ranges
freshness_pred = np.clip(freshness_pred, 0, 100)
shelf_pred = np.clip(shelf_pred, 0, 120)
risk_pred = np.clip(risk_pred, 0, 100)


# ============================================================
# 6. FINAL METRICS
# ============================================================

quality_accuracy = accuracy_score(
    y_quality_test,
    quality_pred
)

quality_f1 = f1_score(
    y_quality_test,
    quality_pred,
    average="macro"
)

freshness_mae = mean_absolute_error(
    y_freshness_test,
    freshness_pred
)

freshness_r2 = r2_score(
    y_freshness_test,
    freshness_pred
)

shelf_mae = mean_absolute_error(
    y_shelf_test,
    shelf_pred
)

shelf_r2 = r2_score(
    y_shelf_test,
    shelf_pred
)

risk_mae = mean_absolute_error(
    y_risk_test,
    risk_pred
)

risk_r2 = r2_score(
    y_risk_test,
    risk_pred
)


# ============================================================
# 7. PRINT FINAL RESULTS
# ============================================================

print("\n" + "=" * 60)
print("APNADAIRY MODEL 1 — FINAL TEST RESULTS")
print("=" * 60)

print(f"\nQuality Classification")
print(f"Accuracy : {quality_accuracy:.4f}")
print(f"Accuracy : {quality_accuracy * 100:.2f}%")
print(f"Macro F1 : {quality_f1:.4f}")

print(f"\nFreshness Score")
print(f"MAE      : {freshness_mae:.4f}")
print(f"R²       : {freshness_r2:.4f}")

print(f"\nRemaining Shelf Life")
print(f"MAE      : {shelf_mae:.4f} hours")
print(f"R²       : {shelf_r2:.4f}")

print(f"\nSpoilage Risk")
print(f"MAE      : {risk_mae:.4f}%")
print(f"R²       : {risk_r2:.4f}")

print("\n" + "=" * 60)


# ============================================================
# 8. FINAL METRICS TABLE
# ============================================================

metrics_df = pd.DataFrame({
    "Output": [
        "Quality",
        "Freshness Score",
        "Remaining Shelf Life",
        "Spoilage Risk"
    ],
    "Model": [
        "SVM",
        "Random Forest",
        "Random Forest",
        "Random Forest"
    ],
    "Metric 1": [
        quality_accuracy,
        freshness_mae,
        shelf_mae,
        risk_mae
    ],
    "Metric 1 Name": [
        "Accuracy",
        "MAE",
        "MAE (hours)",
        "MAE (%)"
    ],
    "Metric 2": [
        quality_f1,
        freshness_r2,
        shelf_r2,
        risk_r2
    ],
    "Metric 2 Name": [
        "Macro F1",
        "R²",
        "R²",
        "R²"
    ]
})

metrics_df.to_csv(
    os.path.join(RESULTS_DIR, "final_metrics.csv"),
    index=False
)

metrics_df.to_markdown(
    os.path.join(RESULTS_DIR, "final_metrics.md"),
    index=False
)


# ============================================================
# 9. MODEL COMPARISON DATA
# ============================================================

comparison = {
    "Quality": {
        "SVM": 0.6759,
        "Random Forest": 0.6710,
        "HistGradientBoosting": 0.6645
    },

    "Freshness Score": {
        "SVR": 0.7809,
        "Random Forest": 0.7922,
        "HistGradientBoosting": 0.7899
    },

    "Shelf Life": {
        "SVR": 0.9126,
        "Random Forest": 0.9221,
        "HistGradientBoosting": 0.9217
    },

    "Spoilage Risk": {
        "SVR": 0.7517,
        "Random Forest": 0.7815,
        "HistGradientBoosting": 0.7808
    }
}


# ============================================================
# 10. MODEL COMPARISON BAR CHARTS
# ============================================================

for title, values in comparison.items():

    plt.figure(figsize=(8, 5))

    names = list(values.keys())
    scores = list(values.values())

    bars = plt.bar(names, scores)

    plt.title(f"{title} — Model Comparison")
    plt.ylabel("Cross-Validation Score")
    plt.ylim(0, 1)

    plt.xticks(rotation=15)

    for bar, score in zip(bars, scores):
        plt.text(
            bar.get_x() + bar.get_width() / 2,
            score + 0.01,
            f"{score:.4f}",
            ha="center"
        )

    plt.tight_layout()

    filename = (
        title.lower()
        .replace(" ", "_")
        .replace("—", "")
    )

    plt.savefig(
        os.path.join(
            RESULTS_DIR,
            f"{filename}_model_comparison.png"
        ),
        dpi=300
    )

    plt.close()


# ============================================================
# 11. QUALITY CONFUSION MATRIX
# ============================================================

cm = confusion_matrix(
    y_quality_test,
    quality_pred,
    labels=[
        "Good",
        "Acceptable",
        "Poor",
        "Spoiled"
    ]
)

disp = ConfusionMatrixDisplay(
    confusion_matrix=cm,
    display_labels=[
        "Good",
        "Acceptable",
        "Poor",
        "Spoiled"
    ]
)

fig, ax = plt.subplots(figsize=(7, 6))

disp.plot(
    ax=ax,
    cmap="Blues",
    values_format="d"
)

plt.title("Quality Classification — Confusion Matrix")
plt.tight_layout()

plt.savefig(
    os.path.join(
        RESULTS_DIR,
        "quality_confusion_matrix.png"
    ),
    dpi=300
)

plt.close()


# ============================================================
# 12. ACTUAL VS PREDICTED FUNCTION
# ============================================================

def actual_vs_predicted(
    actual,
    predicted,
    title,
    filename,
    x_label
):

    plt.figure(figsize=(7, 6))

    plt.scatter(
        actual,
        predicted,
        alpha=0.6
    )

    minimum = min(
        np.min(actual),
        np.min(predicted)
    )

    maximum = max(
        np.max(actual),
        np.max(predicted)
    )

    plt.plot(
        [minimum, maximum],
        [minimum, maximum],
        linestyle="--"
    )

    plt.xlabel(f"Actual {x_label}")
    plt.ylabel(f"Predicted {x_label}")
    plt.title(title)

    plt.tight_layout()

    plt.savefig(
        os.path.join(
            RESULTS_DIR,
            filename
        ),
        dpi=300
    )

    plt.close()


# ============================================================
# 13. FRESHNESS ACTUAL VS PREDICTED
# ============================================================

actual_vs_predicted(
    y_freshness_test,
    freshness_pred,
    "Freshness Score — Actual vs Predicted",
    "freshness_actual_vs_predicted.png",
    "Freshness Score"
)


# ============================================================
# 14. SHELF LIFE ACTUAL VS PREDICTED
# ============================================================

actual_vs_predicted(
    y_shelf_test,
    shelf_pred,
    "Remaining Shelf Life — Actual vs Predicted",
    "shelf_life_actual_vs_predicted.png",
    "Shelf Life (hours)"
)


# ============================================================
# 15. SPOILAGE RISK ACTUAL VS PREDICTED
# ============================================================

actual_vs_predicted(
    y_risk_test,
    risk_pred,
    "Spoilage Risk — Actual vs Predicted",
    "spoilage_risk_actual_vs_predicted.png",
    "Spoilage Risk (%)"
)


# ============================================================
# 16. SAVE PREDICTIONS FOR EVIDENCE
# ============================================================

prediction_df = pd.DataFrame({
    "actual_quality": y_quality_test.values,
    "predicted_quality": quality_pred,

    "actual_freshness": y_freshness_test.values,
    "predicted_freshness": freshness_pred,

    "actual_shelf_life": y_shelf_test.values,
    "predicted_shelf_life": shelf_pred,

    "actual_spoilage_risk": y_risk_test.values,
    "predicted_spoilage_risk": risk_pred
})

prediction_df.to_csv(
    os.path.join(
        RESULTS_DIR,
        "test_predictions.csv"
    ),
    index=False
)


# ============================================================
# 17. DONE
# ============================================================

print("\nEvidence generated successfully!")

print("\nFiles created inside results/:")
print("- final_metrics.csv")
print("- final_metrics.md")
print("- test_predictions.csv")
print("- quality_model_comparison.png")
print("- freshness_score_model_comparison.png")
print("- shelf_life_model_comparison.png")
print("- spoilage_risk_model_comparison.png")
print("- quality_confusion_matrix.png")
print("- freshness_actual_vs_predicted.png")
print("- shelf_life_actual_vs_predicted.png")
print("- spoilage_risk_actual_vs_predicted.png")

print("\nYou can now use these graphs and metrics as evidence in your FYP report.")