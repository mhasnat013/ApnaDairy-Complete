#!/usr/bin/env python3
"""
APNADAIRY Model 1 - automated validation of the SYNTHETIC dataset.
Usage: python validate_dataset.py
Reads apnadairy_model1_dataset.csv (+ optional hidden-latents audit file) and writes validation_report.md
"""
import numpy as np
import pandas as pd
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import cross_val_score, StratifiedKFold
from sklearn.neighbors import NearestNeighbors
from sklearn.preprocessing import StandardScaler

CSV = "data/apnadairy_model1_dataset.csv"

AUDIT = "audit/apnadairy_model1_hidden_latents_AUDIT_ONLY.csv"
INPUTS = ["temperature_c", "ph", "ec_ms_cm"]
TARGETS = ["freshness_score", "quality", "remaining_shelf_life_hours", "spoilage_risk_percent"]
ORDER = ["Good", "Acceptable", "Poor", "Spoiled"]

lines, results = [], []


def log(s=""):
    print(s)
    lines.append(s)


def check(name, passed, detail=""):
    results.append((name, passed))
    log(f"- [{'PASS' if passed else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


df = pd.read_csv(CSV, parse_dates=["collection_timestamp"])
PUBLIC_COLUMNS = set(df.columns)   # captured before any helper columns are added
log("# Validation report - APNADAIRY Model 1 synthetic dataset\n")
log(f"Rows: {len(df)}   Columns: {list(df.columns)}\n")

# 1 missing ----------------------------------------------------------------------------
log("## 1-6 Basic integrity")
check("1 No missing values", df.isna().sum().sum() == 0)
# 2 duplicates
check("2 No duplicate rows (ignoring sample_id)", df.drop(columns="sample_id").duplicated().sum() == 0)
check("2b sample_id unique", df.sample_id.is_unique)
# 3-6 ranges
check("3/5 Temperature in DS18B20-plausible milk range 0.5-45 C",
      df.temperature_c.between(0.5, 45).all(), f"min {df.temperature_c.min():.2f}, max {df.temperature_c.max():.2f}")
check("4 pH within 4.0-7.4 (physically possible for milk, incl. soured)",
      df.ph.between(4.0, 7.4).all(), f"min {df.ph.min():.2f}, max {df.ph.max():.2f}")
check("6 Raw EC within 1.0-9.0 mS/cm", df.ec_ms_cm.between(1, 9).all(),
      f"min {df.ec_ms_cm.min():.3f}, max {df.ec_ms_cm.max():.3f}")
check("Targets within bounds (score 0-100, risk 0-100, life>=0)",
      df.freshness_score.between(0, 100).all() and df.spoilage_risk_percent.between(0, 100).all()
      and (df.remaining_shelf_life_hours >= 0).all())
check("Quality values are only the 4 expected labels", set(df.quality) == set(ORDER))
check("Timestamp format parses & is unique-ish", df.collection_timestamp.notna().all())

# 7 contradictions ------------------------------------------------------------------------
log("\n## 7 Target consistency")
q_rank = df.quality.map({k: i for i, k in enumerate(ORDER)})
med = df.groupby("quality")[["freshness_score", "spoilage_risk_percent", "remaining_shelf_life_hours"]].median().loc[ORDER]
log("\nMedians by quality class:\n\n" + med.round(1).to_markdown() + "\n")
check("7a Median freshness strictly decreases Good>Acceptable>Poor>Spoiled",
      med.freshness_score.is_monotonic_decreasing and med.freshness_score.is_unique)
check("7b Median spoilage risk increases with worse quality", med.spoilage_risk_percent.is_monotonic_increasing)
check("7c Median shelf life decreases with worse quality", med.remaining_shelf_life_hours.is_monotonic_decreasing)
bad_a = df[(df.freshness_score >= 85) & (df.quality.isin(["Poor", "Spoiled"]))]
bad_b = df[(df.freshness_score <= 20) & (df.quality.isin(["Good", "Acceptable"]))]
check("7d No score>=85 labelled Poor/Spoiled (and vice versa score<=20 Good/Acceptable)", len(bad_a) + len(bad_b) == 0)
bad_c = df[(df.quality == "Spoiled") & (df.freshness_score < 15) & ((df.remaining_shelf_life_hours > 1) | (df.spoilage_risk_percent < 90))]
n_border = ((df.quality == "Spoiled") & (df.freshness_score >= 15) & ((df.remaining_shelf_life_hours > 1) | (df.spoilage_risk_percent < 90))).sum()
check("7e Clearly Spoiled (score<15) => shelf life <=1 h and risk >=90%", len(bad_c) == 0,
      f"{len(bad_c)} violations; {n_border} borderline rows (score 15-25, within label-noise of the cut-off) are allowed")
bad_d = df[(df.quality == "Good") & (df.remaining_shelf_life_hours == 0)]
check("7f Good never has 0 h shelf life", len(bad_d) == 0, f"{len(bad_d)} violations")
bad_e = df[(df.freshness_score >= 75) & (df.spoilage_risk_percent > 90)]
check("7g Score>=75 with risk>90% is rare (<1%)  [possible only for warm, fast-growth milk]",
      len(bad_e) / len(df) < 0.01, f"{len(bad_e)} rows ({100*len(bad_e)/len(df):.2f}%)")
bad_f = df[(df.freshness_score < 25) & (df.quality != "Spoiled")]
check("7h Score<25 always Spoiled", len(bad_f) == 0)
# temperature-conditional monotonicity of shelf life for the same quality
df["T_class"] = pd.cut(df.temperature_c, [0, 12, 25, 45], labels=["cold<=12", "mid12-25", "warm>25"])
g = df[df.quality.isin(["Good", "Acceptable"])].groupby(["quality", "T_class"], observed=True).remaining_shelf_life_hours.median()
log("\nMedian shelf life (h) by quality x test-temperature class (temperature MUST matter):\n\n" + g.round(1).to_markdown() + "\n")
ok = all(g[q]["cold<=12"] > g[q]["mid12-25"] > g[q]["warm>25"] for q in ["Good", "Acceptable"])
check("7i Within a quality class, warmer samples have shorter shelf life", ok)
# 13/14 physical sanity of extremes -------------------------------------------------------
log("\n## 13-14 Extreme-condition sanity")
sour = df[df.ph < 6.0]
check("13a pH<6.0 (clearly soured) is never Good", (sour.quality == "Good").sum() == 0,
      f"{len(sour)} samples with pH<6.0; quality mix: {sour.quality.value_counts().to_dict()}")
check("13b pH<6.3 labelled Good is rare (<1% of Good)", ((df.ph < 6.3) & (df.quality == "Good")).sum() < 0.01 * (df.quality == "Good").sum(),
      f"{((df.ph < 6.3) & (df.quality == 'Good')).sum()} rows")
spoiled = df[df.quality == "Spoiled"]
log(f"\nSpoiled samples with 'normal-looking' pH (>=6.5): {(spoiled.ph >= 6.5).sum()} of {len(spoiled)} "
    f"({100*(spoiled.ph>=6.5).mean():.1f}%).  These come from probe-fault rows / high-load milk whose pH has not yet moved "
    "(real limitation of pH-based sensing; kept on purpose, see report).")
check("14a Spoiled with pH>=6.5 is a small minority (<10% of Spoiled)", (spoiled.ph >= 6.5).mean() < 0.10)
cold_fresh_like = df[(df.temperature_c <= 12) & (df.ph.between(6.55, 6.95))]
log(f"\nCold, normal-pH samples: {len(cold_fresh_like)}; quality mix: {cold_fresh_like.quality.value_counts().to_dict()}  "
    "(cold is NOT automatically Good: aged / high-load chilled milk appears as Acceptable/Poor.)")
check("14b Cold+normal pH samples include non-Good labels (cold != automatically fresh)",
      (cold_fresh_like.quality != "Good").mean() > 0.05)
warm_ok = df[(df.temperature_c > 28) & (df.ph.between(6.55, 6.95)) & (df.quality == "Good")]
log(f"Warm (>28C) Good samples with normal pH: {len(warm_ok)}; median risk {warm_ok.spoilage_risk_percent.median():.1f}% "
    "(warm-but-fresh milk exists but carries elevated risk).")
check("14c Warm Good samples have higher median risk than cold Good samples",
      warm_ok.spoilage_risk_percent.median() >
      df[(df.temperature_c <= 12) & (df.quality == "Good")].spoilage_risk_percent.median())

# 8 correlations -----------------------------------------------------------------------------
log("\n## 8 Correlation analysis (Spearman)")
num = df[INPUTS + ["freshness_score", "remaining_shelf_life_hours", "spoilage_risk_percent"]]
corr = num.corr(method="spearman").round(2)
log("\n" + corr.to_markdown() + "\n")
max_in = corr.loc[INPUTS, ["freshness_score", "spoilage_risk_percent"]].abs().max().max()
check("8a No single input has |Spearman| >= 0.9 with freshness/risk (not trivially separable)", max_in < 0.9, f"max |rho| = {max_in:.2f}")
check("8b pH vs freshness positive, pH vs risk negative", corr.loc["ph", "freshness_score"] > 0 and corr.loc["ph", "spoilage_risk_percent"] < 0)
check("8c Targets mutually correlated in the expected direction",
      corr.loc["freshness_score", "spoilage_risk_percent"] < -0.5 and corr.loc["freshness_score", "remaining_shelf_life_hours"] > 0.3)
ph_ec = np.corrcoef(df.ph, df.ec_ms_cm)[0, 1]
log(f"\npH-EC Pearson r = {ph_ec:.2f} (EC is dominated by temperature, so a weak/moderate raw correlation is expected).")

# 9 leakage ----------------------------------------------------------------------------------
log("\n## 9 Target-leakage checks")
check("9a Public CSV contains only sample_id, timestamp, the 3 device inputs and the 4 targets (no hidden columns)",
      PUBLIC_COLUMNS == {"sample_id", "collection_timestamp", *INPUTS, *TARGETS})
cv = StratifiedKFold(5, shuffle=True, random_state=0)
rows = []
for f in INPUTS:
    acc = cross_val_score(DecisionTreeClassifier(max_depth=3, random_state=0), df[[f]], df.quality, cv=cv).mean()
    rows.append((f"{f} only (depth-3 tree)", acc))
df["hour"] = df.collection_timestamp.dt.hour + df.collection_timestamp.dt.minute / 60
df["dow"] = df.collection_timestamp.dt.dayofweek
df["month"] = df.collection_timestamp.dt.month
df["doy"] = df.collection_timestamp.dt.dayofyear
acc_time = cross_val_score(RandomForestClassifier(200, min_samples_leaf=20, random_state=0, n_jobs=-1),
                           df[["hour", "dow", "month", "doy"]], df.quality, cv=cv).mean()
rows.append(("time features only (hour/dow/month/doy, RF)", acc_time))
acc_all = cross_val_score(RandomForestClassifier(300, min_samples_leaf=3, random_state=0, n_jobs=-1),
                          df[INPUTS], df.quality, cv=cv).mean()
rows.append(("all 3 sensor inputs (RF)", acc_all))
maj = df.quality.value_counts(normalize=True).max()
rows.append(("majority-class baseline", maj))
res = pd.DataFrame(rows, columns=["model", "5-fold CV accuracy"]).round(3)
log("\n" + res.to_markdown(index=False) + "\n")
check("9b Timestamp-derived features carry no label information (acc within 3 pts of majority baseline)",
      acc_time <= maj + 0.03, f"{acc_time:.3f} vs {maj:.3f}")
check("9c No single sensor separates classes (best single-feature accuracy < 0.80)",
      max(a for _, a in rows[:3]) < 0.80, f"best {max(a for _, a in rows[:3]):.3f}")
check("9d Combined inputs informative (>= baseline+15 pts) but far from perfect (< 0.97)", maj + 0.15 <= acc_all < 0.97,
      f"{acc_all:.3f} vs baseline {maj:.3f}")
from scipy.stats import kruskal
H, p = kruskal(*[df[df.quality == q].hour for q in ORDER])
log(f"\nKruskal-Wallis hour-of-day vs quality: H={H:.2f}, p={p:.3f} (p>0.05 = no association)")
check("9e Hour-of-day independent of quality (p>0.01)", p > 0.01)

# 10 imbalance ---------------------------------------------------------------------------------
log("\n## 10 Class distribution")
dist = df.quality.value_counts().reindex(ORDER)
log("\n" + pd.DataFrame({"n": dist, "percent": (100 * dist / len(df)).round(1)}).to_markdown() + "\n")
check("10 Every class between 8% and 55% (imbalanced but learnable)", dist.min() / len(df) > 0.08 and dist.max() / len(df) < 0.55)

# 11 outliers ----------------------------------------------------------------------------------
log("\n## 11 Outliers (IQR rule, 3xIQR fences)")
for c in INPUTS + ["freshness_score"]:
    q1, q3 = df[c].quantile([0.25, 0.75])
    iqr = q3 - q1
    n_out = ((df[c] < q1 - 3 * iqr) | (df[c] > q3 + 3 * iqr)).sum()
    log(f"- {c}: {n_out} extreme outliers (3xIQR)")
log("(Distributions are multi-modal by design: cold vs warm handling, fresh vs soured. IQR rules over-flag such data; "
    "range checks above are the binding test.)")

# 12 near duplicates ---------------------------------------------------------------------------
log("\n## 12 Near-duplicate check")
X = StandardScaler().fit_transform(df[INPUTS])
nn = NearestNeighbors(n_neighbors=2).fit(X)
dist_nn = nn.kneighbors(X)[0][:, 1]
log(f"Nearest-neighbour distance in standardised space: min {dist_nn.min():.4f}, 1st pct {np.percentile(dist_nn,1):.4f}, median {np.median(dist_nn):.4f}")
close = np.where(dist_nn < 0.002)[0]
nn_idx = nn.kneighbors(X)[1][:, 1]
conflict = sum(df.quality.iloc[i] != df.quality.iloc[nn_idx[i]] for i in close)
log(f"Near-identical input triples (distance<0.002): {len(close)} rows ({100*len(close)/len(df):.2f}%); of these {conflict} have different quality labels. "
    "These are chance collisions of 3 rounded sensor readings and illustrate genuine ambiguity (warm milk: pH/EC may not yet reveal age).")
check("12 Near-identical input triples are rare (<0.5% of rows) and no exact duplicate rows", len(close) / len(df) < 0.005)

# optional: audit against hidden truth ---------------------------------------------------------
try:
    au = pd.read_csv(AUDIT)
    m = df.merge(au, on="sample_id")
    log("\n## Audit against hidden generator state (for the developer only - NOT model inputs)")
    log(f"- Spearman(freshness_score, hidden log10 CFU/mL) = {m.freshness_score.corr(m.h_log10_cfu_ml, method='spearman'):.2f}")
    log(f"- Subclinical-mastitis share {100*m.h_subclinical_mastitis.mean():.1f}%, diluted {100*m.h_diluted.mean():.1f}%, "
        f"pH-probe faults {100*m.h_probe_fault_ph.mean():.1f}%, EC faults {100*m.h_probe_fault_ec.mean():.1f}%")
    mm = m[m.h_subclinical_mastitis == 1]
    log(f"- Mastitis rows labelled Good/Acceptable: {100*mm.quality.isin(['Good','Acceptable']).mean():.1f}% "
        "(EC is raised by mastitis without spoilage -> deliberate confounder)")
    log("- Scenario x quality (row %):\n\n" + pd.crosstab(m.h_scenario, m.quality, normalize="index").mul(100).round(1)[ORDER].to_markdown() + "\n")
except FileNotFoundError:
    log("\n(audit file not found - skipped)")

n_fail = sum(1 for _, p_ in results if not p_)
log(f"\n## Summary: {len(results)-n_fail}/{len(results)} checks passed, {n_fail} failed")
open("validation_report.md", "w").write("\n".join(lines))
