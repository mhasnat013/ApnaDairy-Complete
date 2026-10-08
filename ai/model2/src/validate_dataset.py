#!/usr/bin/env python3
"""Automated validation of the SYNTHETIC Model 2 dataset. Writes results/validation_report.md."""
from pathlib import Path
import numpy as np
import pandas as pd
from scipy.stats import kruskal, chi2_contingency
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier
from sklearn.model_selection import cross_val_predict, cross_val_score, StratifiedKFold
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import accuracy_score

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "data" / "apnadairy_model2_adulteration_dataset.csv"
AUDIT = ROOT / "audit" / "apnadairy_model2_hidden_latents_AUDIT_ONLY.csv"
REPORT = ROOT / "results" / "validation_report.md"
COLS = ["sample_id", "collection_timestamp", "temperature_c", "ph", "ec_ms_cm", "tds_ppm",
        "adulteration_detected", "adulteration_type"]
X = ["temperature_c", "ph", "ec_ms_cm", "tds_ppm"]
TYPES = ["None", "Water", "Urea", "Salt", "Sugar"]
RANGES = dict(temperature_c=(2.0, 42.0), ph=(6.0, 7.6), ec_ms_cm=(1.0, 14.0), tds_ppm=(500, 7000))

lines, res = [], []
def log(s=""): print(s); lines.append(s)
def check(name, ok, detail=""):
    res.append(ok); log(f"- [{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))

# keep_default_na=False: the string "None" is a real label, not a missing value
df = pd.read_csv(CSV, keep_default_na=False, na_values=[""])
log("# Validation report - APNADAIRY Model 2 (SYNTHETIC dataset)\n")
log("## Structure and integrity")
check("1 Exactly 5,000 rows", len(df) == 5000, str(len(df)))
check("2 Columns exactly as specified, in order", list(df.columns) == COLS)
check("3 No missing values", df.isna().sum().sum() == 0)
check("4/17 No duplicate rows (all columns) and no duplicate sensor+label rows",
      df.duplicated().sum() == 0 and df.duplicated(subset=X + ["adulteration_type"]).sum() == 0)
check("5 sample_id unique and format M2_00001..M2_05000",
      df.sample_id.is_unique and set(df.sample_id) == {f"M2_{i:05d}" for i in range(1, 5001)})
ts = pd.to_datetime(df.collection_timestamp, format="%Y-%m-%d %H:%M:%S", errors="coerce")
check("6 Timestamps parse as YYYY-MM-DD HH:MM:SS", ts.notna().all())
for c, (lo, hi) in RANGES.items():
    check(f"7 {c} within [{lo}, {hi}]", df[c].between(lo, hi).all(), f"min {df[c].min()}, max {df[c].max()}")
check("7b Values are not stuck at clip limits (<0.5% rows on any boundary)",
      all(((df[c] <= lo) | (df[c] >= hi)).mean() < 0.005 for c, (lo, hi) in RANGES.items()))
check("8 Valid label values", set(df.adulteration_detected) <= {"Yes", "No"} and set(df.adulteration_type) == set(TYPES))
bad = df[((df.adulteration_detected == "No") & (df.adulteration_type != "None")) |
         ((df.adulteration_detected == "Yes") & (df.adulteration_type == "None"))]
check("9 Zero label contradictions (No<->None, Yes<->non-None)", len(bad) == 0, f"{len(bad)} contradictions")

log("\n## Class distribution")
cnt = df.adulteration_type.value_counts().reindex(TYPES)
log("\n" + pd.DataFrame({"n": cnt, "percent": (100 * cnt / len(df)).round(1)}).to_markdown() + "\n")
pct = 100 * cnt / len(df)
check("10 Class shares within recommended bands (None 40-45, Water 15-20, others 10-15)",
      40 <= pct["None"] <= 45 and 15 <= pct["Water"] <= 20 and all(10 <= pct[k] <= 15 for k in ["Urea", "Salt", "Sugar"]))
check("19 Every class >= 500 samples", cnt.min() >= 500, f"min {cnt.min()}")

log("\n## Distributions")
ecr = df[["ec_ms_cm", "tds_ppm"]].corr(method="spearman").iloc[0, 1]
ecp = df[["ec_ms_cm", "tds_ppm"]].corr().iloc[0, 1]
log(f"\nEC-TDS: Pearson {ecp:.3f}, Spearman {ecr:.3f}")
check("11 EC and TDS positively but not perfectly correlated (0.5 < r < 0.98)", 0.5 < ecp < 0.98)
ratio = df.tds_ppm / (df.ec_ms_cm * 1000)
log(f"TDS/EC ratio (ppm per uS/cm): mean {ratio.mean():.3f}, sd {ratio.std():.3f}, min {ratio.min():.3f}, max {ratio.max():.3f}")
check("11b TDS != constant x EC (ratio coefficient of variation > 5%)", ratio.std() / ratio.mean() > 0.05,
      f"CV {100*ratio.std()/ratio.mean():.1f}%")
log("\nTemperature / pH / EC / TDS summary:\n\n" + df[X].describe().round(2).to_markdown() + "\n")
check("12 Temperature spans >= 25 C and is not label-driven (Kruskal p > 0.01)",
      df.temperature_c.max() - df.temperature_c.min() >= 25 and
      kruskal(*[df[df.adulteration_type == t].temperature_c for t in TYPES])[1] > 0.01,
      f"p={kruskal(*[df[df.adulteration_type == t].temperature_c for t in TYPES])[1]:.3f}")
check("13 pH centre in 6.5-6.9 and 99% of rows within 6.2-7.2", 6.5 < df.ph.median() < 6.9 and df.ph.between(6.2, 7.2).mean() > 0.99,
      f"median {df.ph.median():.2f}")
log("\n### Sensor distributions by class (mean / sd)\n\n" +
    df.groupby("adulteration_type")[X].agg(["mean", "std"]).reindex(TYPES).round(2).to_markdown() + "\n")
tb = pd.cut(df.temperature_c, [0, 12, 22, 32, 45])
share = df.groupby(tb, observed=True).adulteration_detected.apply(lambda s: (s == "Yes").mean())
log("Share adulterated by temperature band: " + ", ".join(f"{k}: {v:.2f}" for k, v in share.items()))
check("14 Temperature does not determine adulteration (adulterated share 0.45-0.70 in every band)", share.between(0.45, 0.70).all())
check("14b Every class occurs in both cold (<=15C) and warm (>=30C) milk",
      all(((df.adulteration_type == t) & (df.temperature_c <= 15)).sum() > 20 and
          ((df.adulteration_type == t) & (df.temperature_c >= 30)).sum() > 20 for t in TYPES))

log("\n## Leakage checks (5-fold stratified CV accuracy)")
cv = StratifiedKFold(5, shuffle=True, random_state=0)
y = df.adulteration_type
maj = y.value_counts(normalize=True).max()
rows = []
for f in X:
    rows.append((f"{f} only (depth-3 tree)", cross_val_score(DecisionTreeClassifier(max_depth=3, random_state=0), df[[f]], y, cv=cv).mean()))
tf = pd.DataFrame({"hour": ts.dt.hour + ts.dt.minute / 60, "dow": ts.dt.dayofweek, "month": ts.dt.month, "doy": ts.dt.dayofyear})
a_time = cross_val_score(RandomForestClassifier(200, min_samples_leaf=20, random_state=0, n_jobs=-1), tf, y, cv=cv).mean()
idnum = df.sample_id.str[3:].astype(int).to_frame("idnum")
a_id = cross_val_score(RandomForestClassifier(200, min_samples_leaf=20, random_state=0, n_jobs=-1), idnum, y, cv=cv).mean()
a_all = cross_val_score(RandomForestClassifier(300, min_samples_leaf=3, random_state=0, n_jobs=-1), df[X], y, cv=cv).mean()
rows += [("timestamp features only (RF)", a_time), ("sample_id number only (RF)", a_id), ("all 4 sensors (RF)", a_all), ("majority baseline", maj)]
log("\n" + pd.DataFrame(rows, columns=["inputs", "accuracy"]).round(3).to_markdown(index=False) + "\n")
check("15 No single sensor separates the 5 classes (best single-feature acc < 0.75)", max(a for _, a in rows[:4]) < 0.75,
      f"best {max(a for _, a in rows[:4]):.3f}")
check("16 Timestamp features carry no label information (within 3 pts of majority)", a_time <= maj + 0.03, f"{a_time:.3f} vs {maj:.3f}")
check("16b sample_id carries no label information (within 3 pts of majority)", a_id <= maj + 0.03, f"{a_id:.3f} vs {maj:.3f}")
H, p = kruskal(*[tf.hour[y == t] for t in TYPES])
check("16c Hour-of-day independent of class (Kruskal p > 0.01)", p > 0.01, f"p={p:.3f}")
ct = pd.crosstab(tf.month, y)
check("16d Month independent of class (chi-square p > 0.01)", chi2_contingency(ct)[1] > 0.01, f"p={chi2_contingency(ct)[1]:.3f}")
check("15b Public file holds no hidden columns", set(df.columns) == set(COLS))
check("15c Sensors + timestamp together are informative but not trivial (majority+0.10 < RF acc < 0.97)",
      maj + 0.10 < a_all < 0.97, f"{a_all:.3f}")

log("\n## Physical plausibility / overlap")
water_low = df[(df.adulteration_type == "Water")]
pure = df[df.adulteration_type == "None"]
# temperature-compensate EC for plausibility comparisons only (2.2 %/C)
ec25 = df.ec_ms_cm / (1 + 0.022 * (df.temperature_c - 25))
log(f"\nEC referenced to 25 C (analysis only): pure milk mean {ec25[pure.index].mean():.2f}, water {ec25[water_low.index].mean():.2f}, "
    f"salt {ec25[df.adulteration_type=='Salt'].mean():.2f}, sugar {ec25[df.adulteration_type=='Sugar'].mean():.2f}, urea {ec25[df.adulteration_type=='Urea'].mean():.2f}")
check("18a Pure milk EC@25C mostly in literature range 3.8-6.2 (>=95%)", ec25[pure.index].between(3.8, 6.2).mean() >= 0.95,
      f"{100*ec25[pure.index].between(3.8,6.2).mean():.1f}%")
check("18b Direction: water lowers and salt raises EC@25C vs pure milk",
      ec25[water_low.index].mean() < ec25[pure.index].mean() < ec25[df.adulteration_type == 'Salt'].mean())
check("18c Direction: urea raises pH vs pure milk", df.ph[df.adulteration_type == 'Urea'].mean() > df.ph[pure.index].mean())
check("18d No impossible combos: pH>7.3 never with EC<2 (impossible for milk-like fluid)", ((df.ph > 7.3) & (df.ec_ms_cm < 2)).sum() == 0)
check("18e TDS/EC ratio inside 0.25-1.2 ppm per uS/cm for every row (conversion factors of conductivity-based TDS meters are ~0.4-0.9; edges allow probe faults)",
      ratio.between(0.25, 1.2).all(), f"{100*(~ratio.between(0.35, 0.85)).mean():.1f}% of rows outside the typical 0.35-0.85 band (faults, cold-milk compensation error)")

Xs = StandardScaler().fit_transform(df[X])
nn = NearestNeighbors(n_neighbors=11).fit(Xs)
idx = nn.kneighbors(Xs)[1][:, 1:]
lab = y.values
mixed = np.array([(lab[idx[i]] != lab[i]).mean() for i in range(len(df))])
log(f"\nKNN neighbourhood mixing: {100*(mixed>=0.5).mean():.1f}% of rows have >=50% of their 10 nearest neighbours in another class; "
    f"{100*(mixed>0).mean():.1f}% have at least one.")
check("20 Difficult/overlapping samples exist (>=15% of rows have majority-other-class neighbours)", (mixed >= 0.5).mean() >= 0.15)
oof = cross_val_predict(RandomForestClassifier(300, min_samples_leaf=3, random_state=0, n_jobs=-1), df[X], y, cv=cv)
log("\nPer-class recall from RF out-of-fold predictions: " + ", ".join(f"{t} {100*(oof[y==t]==t).mean():.0f}%" for t in TYPES))
check("20b Dataset is not too easy: no class has recall > 0.98", all((oof[y == t] == t).mean() < 0.98 for t in TYPES))
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import f1_score, balanced_accuracy_score
Fe = df[X].copy(); Fe["ec25"] = df.ec_ms_cm / (1 + 0.022 * (df.temperature_c - 25)); Fe["ratio"] = ratio
yb = (df.adulteration_detected == "Yes").astype(int)
pb = cross_val_predict(HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, random_state=0), Fe, yb, cv=cv)
bacc = balanced_accuracy_score(yb, pb)
log(f"Binary detection (Yes/No), HistGB with backend features ec25+ratio: balanced accuracy {bacc:.3f}")
check("20c Detection (Yes/No) is learnable: balanced accuracy > 0.65 and < 0.97", 0.65 < bacc < 0.97, f"{bacc:.3f}")
weak = [t for t in TYPES if (oof[y == t] == t).mean() < 0.25]
log(f"WARN (informational, not scored): classes with RF recall < 25%: {weak or 'none'}. This is a scientific finding, not a bug: "
    "non-ionic adulterants (sugar, low-dose urea) barely change conductivity-type measurements. See README limitations.")

try:
    au = pd.read_csv(AUDIT, comment="#", keep_default_na=False, na_values=[""])
    m = df.merge(au, on="sample_id")
    log("\n## Audit against hidden generator state (developer only - never a model input)")
    sev = m[m.adulteration_type != "None"].assign(ok=lambda d: oof[d.index] == d.adulteration_type)
    log("\nRF recall by hidden severity (should rise with dose):\n\n" + sev.groupby(["adulteration_type", "h_severity"]).ok.mean().unstack().round(2)[["mild", "moderate", "strong"]].to_markdown() + "\n")
    mm = m[(m.adulteration_type == "None")]
    log(f"Pure milk: mastitis {100*mm.h_mastitis.mean():.1f}%, aged {100*mm.h_aged.mean():.1f}%; pure-milk RF recall for mastitis rows "
        f"{100*(oof[mm[mm.h_mastitis==1].index]=='None').mean():.0f}% (EC confounder, mostly confused with Salt)")
    r = sev.groupby("adulteration_type").ok.mean()
    check("Audit: recall higher for strong than mild doses in Water and Salt",
          all(sev[(sev.adulteration_type == t) & (sev.h_severity == "strong")].ok.mean() > sev[(sev.adulteration_type == t) & (sev.h_severity == "mild")].ok.mean() for t in ["Water", "Salt"]))
except FileNotFoundError:
    log("(audit file not found)")

log(f"\n## Summary: {sum(res)}/{len(res)} checks passed, {len(res)-sum(res)} failed")
REPORT.parent.mkdir(exist_ok=True)
REPORT.write_text("\n".join(lines))
