#!/usr/bin/env python3
"""
Baseline classical-ML comparison for APNADAIRY Model 1 (SYNTHETIC data).
Split 70/15/15 stratified by quality. Models are compared on VALIDATION only;
the TEST set is scored once, at the end, for the single chosen model per task.
Features: temperature_c, ph, ec_ms_cm (+ optional engineered, documented below).
The timestamp is NOT used as a feature.
"""
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.tree import DecisionTreeClassifier, DecisionTreeRegressor
from sklearn.ensemble import (RandomForestClassifier, RandomForestRegressor,
                              HistGradientBoostingClassifier, HistGradientBoostingRegressor)
from sklearn.svm import SVC, SVR
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, r2_score, confusion_matrix

ORDER = ["Good", "Acceptable", "Poor", "Spoiled"]
RAW = ["temperature_c", "ph", "ec_ms_cm"]
SEED = 42

df = pd.read_csv("apnadairy_model1_dataset.csv")
# Documented engineered feature (deterministic function of the inputs, no leakage):
# EC referenced to 25 C with a fixed 2.2 %/C coefficient (literature 1.7-2.8 %/C).
df["ec25_est"] = df.ec_ms_cm / (1 + 0.022 * (df.temperature_c - 25.0))
FEATS = RAW + ["ec25_est"]

train_val, test = train_test_split(df, test_size=0.15, stratify=df.quality, random_state=SEED)
train, val = train_test_split(train_val, test_size=0.15 / 0.85, stratify=train_val.quality, random_state=SEED)
print(f"train {len(train)}  val {len(val)}  test {len(test)} (test untouched until the end)\n")

out = ["# Baseline model comparison (SYNTHETIC data; validation set only)\n",
       f"Split: train {len(train)} / validation {len(val)} / test {len(test)}  (70/15/15, stratified by quality, seed {SEED})\n"]


def adj_acc(y_true, y_pred):
    r = {k: i for i, k in enumerate(ORDER)}
    return float(np.mean(np.abs(pd.Series(y_true).map(r).values - pd.Series(y_pred).map(r).values) <= 1))


# ---------------- A. quality classification ----------------
clfs = {
    "Logistic Regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=3)),
    "Decision Tree (depth 6)": DecisionTreeClassifier(max_depth=6, min_samples_leaf=10, random_state=SEED),
    "SVM (RBF)": make_pipeline(StandardScaler(), SVC(C=3, probability=True, random_state=SEED)),
    "Random Forest": RandomForestClassifier(400, min_samples_leaf=3, random_state=SEED, n_jobs=-1),
    "Gradient Boosting (HistGB)": HistGradientBoostingClassifier(max_depth=4, learning_rate=0.05, max_iter=300, random_state=SEED),
}
rows = []
fitted = {}
for name, m in clfs.items():
    for fs_name, fs in [("raw 3 inputs", RAW), ("raw + ec25_est", FEATS)]:
        m.fit(train[fs], train.quality)
        p = m.predict(val[fs])
        rows.append((name, fs_name, accuracy_score(val.quality, p), f1_score(val.quality, p, average="macro"), adj_acc(val.quality, p)))
        fitted[(name, fs_name)] = fs
res = pd.DataFrame(rows, columns=["model", "features", "accuracy", "macro_F1", "within_1_class"]).round(3)
out += ["\n## A. Quality classification (validation)\n", res.to_markdown(index=False)]
print(res.to_string(index=False))

# ---------------- B/C/D. numeric targets ----------------
regs = {
    "Ridge (linear)": make_pipeline(StandardScaler(), Ridge(alpha=1.0)),
    "Decision Tree (depth 6)": DecisionTreeRegressor(max_depth=6, min_samples_leaf=10, random_state=SEED),
    "SVR (RBF)": make_pipeline(StandardScaler(), SVR(C=30)),
    "Random Forest": RandomForestRegressor(400, min_samples_leaf=3, random_state=SEED, n_jobs=-1),
    "Gradient Boosting (HistGB)": HistGradientBoostingRegressor(max_depth=4, learning_rate=0.05, max_iter=300, random_state=SEED),
}
for target in ["freshness_score", "remaining_shelf_life_hours", "spoilage_risk_percent"]:
    rows = []
    ytr = np.log1p(train[target]) if target == "remaining_shelf_life_hours" else train[target]
    for name, m in regs.items():
        m.fit(train[FEATS], ytr)
        p = m.predict(val[FEATS])
        if target == "remaining_shelf_life_hours":
            p = np.clip(np.expm1(p), 0, 120)
        else:
            p = np.clip(p, 0, 100)
        rows.append((name, mean_absolute_error(val[target], p), r2_score(val[target], p)))
    r = pd.DataFrame(rows, columns=["model", "MAE", "R2"]).round(3)
    out += [f"\n## {target} (validation; features raw + ec25_est" + ("; trained on log1p(target)" if target == "remaining_shelf_life_hours" else "") + ")\n", r.to_markdown(index=False)]
    print("\n", target, "\n", r.to_string(index=False))

# ---------------- final: chosen model, TEST set scored ONCE ----------------
final_clf = HistGradientBoostingClassifier(max_depth=4, learning_rate=0.05, max_iter=300, random_state=SEED)
final_clf.fit(pd.concat([train, val])[FEATS], pd.concat([train, val]).quality)
pt = final_clf.predict(test[FEATS])
cm = pd.DataFrame(confusion_matrix(test.quality, pt, labels=ORDER), index=[f"true {o}" for o in ORDER], columns=[f"pred {o}" for o in ORDER])
out += ["\n## FINAL TEST (scored once; HistGB trained on train+val)\n",
        f"accuracy {accuracy_score(test.quality, pt):.3f}, macro-F1 {f1_score(test.quality, pt, average='macro'):.3f}, within-1-class {adj_acc(test.quality, pt):.3f}\n",
        cm.to_markdown()]
print("\nTEST:", round(accuracy_score(test.quality, pt), 3), round(f1_score(test.quality, pt, average='macro'), 3), round(adj_acc(test.quality, pt), 3))
print(cm)
open("ml_baseline_results.md", "w").write("\n".join(out))
