import os
import joblib
import numpy as np
import pandas as pd

from sklearn.model_selection import (
    train_test_split,
    StratifiedKFold,
    KFold,
    GridSearchCV
)

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from sklearn.svm import SVC, SVR
from sklearn.ensemble import (
    RandomForestClassifier,
    HistGradientBoostingClassifier,
    RandomForestRegressor,
    HistGradientBoostingRegressor
)

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
RESULT_DIR = "results"

os.makedirs(MODEL_DIR, exist_ok=True)
os.makedirs(RESULT_DIR, exist_ok=True)


# ============================================================
# LOAD DATA
# ============================================================

df = pd.read_csv(DATA_PATH)

# Engineered EC feature
df["ec25_est"] = df["ec_ms_cm"] / (
    1 + 0.022 * (df["temperature_c"] - 25.0)
)

RAW = [
    "temperature_c",
    "ph",
    "ec_ms_cm"
]

FEATURES = RAW + ["ec25_est"]


# ============================================================
# TRAIN / TEST SPLIT
# TEST REMAINS UNTOUCHED
# ============================================================

train_val, test = train_test_split(
    df,
    test_size=0.15,
    stratify=df["quality"],
    random_state=SEED
)

print(f"Train + Validation: {len(train_val)}")
print(f"Final Test: {len(test)}")


# ============================================================
# 1. QUALITY CLASSIFICATION
# ============================================================

print("\n" + "=" * 60)
print("QUALITY MODEL OPTIMIZATION")
print("=" * 60)

X_cls = train_val[FEATURES]
y_cls = train_val["quality"]

cv_cls = StratifiedKFold(
    n_splits=5,
    shuffle=True,
    random_state=SEED
)


classification_models = {

    "SVM": (
        Pipeline([
            ("scaler", StandardScaler()),
            ("model", SVC(probability=True, random_state=SEED))
        ]),
        {
            "model__C": [1, 3, 10, 30],
            "model__gamma": ["scale", 0.01, 0.03, 0.1],
            "model__kernel": ["rbf"],
            "model__class_weight": [None, "balanced"]
        }
    ),

    "Random Forest": (
        RandomForestClassifier(
            random_state=SEED,
            n_jobs=-1
        ),
        {
            "n_estimators": [300, 500],
            "max_depth": [None, 8, 12, 16],
            "min_samples_leaf": [1, 3, 5],
            "class_weight": [None, "balanced"]
        }
    ),

    "HistGradientBoosting": (
        HistGradientBoostingClassifier(
            random_state=SEED
        ),
        {
            "learning_rate": [0.03, 0.05, 0.08],
            "max_iter": [200, 300, 500],
            "max_leaf_nodes": [15, 31],
            "l2_regularization": [0, 0.1, 1]
        }
    )
}


classification_results = []
best_classification = None
best_classification_score = -1


for name, (model, params) in classification_models.items():

    print(f"\nTuning {name}...")

    search = GridSearchCV(
        model,
        params,
        scoring="f1_macro",
        cv=cv_cls,
        n_jobs=-1,
        verbose=0
    )

    search.fit(X_cls, y_cls)

    best_model = search.best_estimator_

    cv_accuracy = search.cv_results_["mean_test_score"][
        search.best_index_
    ]

    classification_results.append({
        "Model": name,
        "Best Macro F1": round(search.best_score_, 4),
        "Best Parameters": str(search.best_params_)
    })

    print(f"Best Macro F1: {search.best_score_:.4f}")
    print(f"Best Parameters: {search.best_params_}")

    if search.best_score_ > best_classification_score:
        best_classification_score = search.best_score_
        best_classification = best_model


classification_table = pd.DataFrame(classification_results)

print("\nQUALITY MODEL COMPARISON")
print(classification_table.to_string(index=False))


# ============================================================
# TRAIN BEST QUALITY MODEL ON FULL TRAIN+VALIDATION
# ============================================================

best_classification.fit(
    train_val[FEATURES],
    train_val["quality"]
)

quality_pred = best_classification.predict(
    test[FEATURES]
)

quality_accuracy = accuracy_score(
    test["quality"],
    quality_pred
)

quality_f1 = f1_score(
    test["quality"],
    quality_pred,
    average="macro"
)

print("\nFINAL QUALITY TEST")
print(f"Accuracy : {quality_accuracy:.4f}")
print(f"Macro F1 : {quality_f1:.4f}")


# Save quality model
joblib.dump(
    best_classification,
    os.path.join(MODEL_DIR, "quality_model.joblib")
)


# ============================================================
# REGRESSION MODELS
# ============================================================

regression_models = {

    "SVR": (
        Pipeline([
            ("scaler", StandardScaler()),
            ("model", SVR())
        ]),
        {
            "model__C": [10, 30, 100],
            "model__gamma": ["scale", 0.01, 0.03, 0.1],
            "model__epsilon": [0.05, 0.1, 0.2]
        }
    ),

    "Random Forest": (
        RandomForestRegressor(
            random_state=SEED,
            n_jobs=-1
        ),
        {
            "n_estimators": [300, 500],
            "max_depth": [None, 8, 12, 16],
            "min_samples_leaf": [1, 3, 5]
        }
    ),

    "HistGradientBoosting": (
        HistGradientBoostingRegressor(
            random_state=SEED
        ),
        {
            "learning_rate": [0.03, 0.05, 0.08],
            "max_iter": [200, 300, 500],
            "max_leaf_nodes": [15, 31],
            "l2_regularization": [0, 0.1, 1]
        }
    )
}


cv_reg = KFold(
    n_splits=5,
    shuffle=True,
    random_state=SEED
)


# ============================================================
# FUNCTION FOR REGRESSION OPTIMIZATION
# ============================================================

def optimize_regression(target, model_file):

    print("\n" + "=" * 60)
    print(f"{target.upper()} MODEL OPTIMIZATION")
    print("=" * 60)

    X = train_val[FEATURES]

    # Shelf life uses log transformation
    if target == "remaining_shelf_life_hours":
        y = np.log1p(
            train_val[target]
        )
    else:
        y = train_val[target]

    all_results = []

    best_model = None
    best_score = float("-inf")

    for name, (model, params) in regression_models.items():

        print(f"\nTuning {name}...")

        search = GridSearchCV(
            model,
            params,
            scoring="r2",
            cv=cv_reg,
            n_jobs=-1,
            verbose=0
        )

        search.fit(X, y)

        print(f"Best CV R2: {search.best_score_:.4f}")
        print(f"Best Parameters: {search.best_params_}")

        all_results.append({
            "Model": name,
            "Best CV R2": round(search.best_score_, 4),
            "Best Parameters": str(search.best_params_)
        })

        if search.best_score_ > best_score:
            best_score = search.best_score_
            best_model = search.best_estimator_

    results_df = pd.DataFrame(all_results)

    print("\nMODEL COMPARISON")
    print(results_df.to_string(index=False))

    # Train best model on complete train+validation data
    best_model.fit(X, y)

    predictions = best_model.predict(
        test[FEATURES]
    )

    if target == "remaining_shelf_life_hours":

        predictions = np.clip(
            np.expm1(predictions),
            0,
            120
        )

    else:

        predictions = np.clip(
            predictions,
            0,
            100
        )

    mae = mean_absolute_error(
        test[target],
        predictions
    )

    r2 = r2_score(
        test[target],
        predictions
    )

    print("\nFINAL TEST")
    print(f"MAE : {mae:.4f}")
    print(f"R2  : {r2:.4f}")

    # Save model
    joblib.dump(
        best_model,
        os.path.join(MODEL_DIR, model_file)
    )

    return results_df, mae, r2


# ============================================================
# RUN REGRESSION OPTIMIZATION
# ============================================================

freshness_results, freshness_mae, freshness_r2 = optimize_regression(
    "freshness_score",
    "freshness_model.joblib"
)

shelf_results, shelf_mae, shelf_r2 = optimize_regression(
    "remaining_shelf_life_hours",
    "shelf_life_model.joblib"
)

risk_results, risk_mae, risk_r2 = optimize_regression(
    "spoilage_risk_percent",
    "spoilage_risk_model.joblib"
)


# ============================================================
# SAVE EVIDENCE REPORT
# ============================================================

report = []

report.append("# APNADAIRY Model 1 - Optimized ML Results\n")

report.append("## Dataset\n")
report.append("- Total samples: 5000")
report.append("- Test set: 15%")
report.append("- Test set was kept untouched during model selection.")
report.append("- 5-fold cross-validation was used for model optimization.\n")

report.append("## Input Features\n")
report.append("- Temperature")
report.append("- pH")
report.append("- EC")
report.append("- EC normalized to 25°C (ec25_est)\n")


report.append("## Quality Classification\n")
report.append(
    classification_table.to_markdown(index=False)
)

report.append("\n### Final Quality Test Performance\n")
report.append(
    f"- Accuracy: **{quality_accuracy:.4f}**\n"
)
report.append(
    f"- Macro F1: **{quality_f1:.4f}**\n"
)


report.append("\n## Freshness Score\n")
report.append(
    freshness_results.to_markdown(index=False)
)
report.append(
    f"\nFinal Test MAE: **{freshness_mae:.4f}**\n"
)
report.append(
    f"Final Test R²: **{freshness_r2:.4f}**\n"
)


report.append("\n## Remaining Shelf Life\n")
report.append(
    shelf_results.to_markdown(index=False)
)
report.append(
    f"\nFinal Test MAE: **{shelf_mae:.4f} hours**\n"
)
report.append(
    f"Final Test R²: **{shelf_r2:.4f}**\n"
)


report.append("\n## Spoilage Risk\n")
report.append(
    risk_results.to_markdown(index=False)
)
report.append(
    f"\nFinal Test MAE: **{risk_mae:.4f}%**\n"
)
report.append(
    f"Final Test R²: **{risk_r2:.4f}**\n"
)


with open(
    os.path.join(
        RESULT_DIR,
        "optimized_model_results.md"
    ),
    "w",
    encoding="utf-8"
) as f:

    f.write("\n".join(report))


print("\n" + "=" * 60)
print("OPTIMIZATION COMPLETE")
print("=" * 60)

print("\nFinal models saved:")
print("models/quality_model.joblib")
print("models/freshness_model.joblib")
print("models/shelf_life_model.joblib")
print("models/spoilage_risk_model.joblib")

print("\nEvidence saved:")
print("results/optimized_model_results.md")