#!/usr/bin/env python3
"""
APNADAIRY Model 2 (adulteration detection) - SYNTHETIC / PROTOTYPE dataset generator.
NOT laboratory data. Fixed seed => reproducible.  Run from anywhere: python src/generate_dataset.py

Public model inputs : temperature_c, ph, ec_ms_cm, tds_ppm
Targets             : adulteration_detected (Yes/No), adulteration_type (None/Water/Urea/Salt/Sugar)
Metadata            : sample_id, collection_timestamp  (never predictors)

Mechanism: a hidden "true milk + adulterant" state is built first (composition, adulterant
dose, water quality, handling), then four noisy instruments read it.

FLAGGED ASSUMPTIONS (direction from literature, magnitude = prototype choice)
 B1  Raw-milk EC25 ~ N(4.75, 0.30) mS/cm, truncated 4.0-5.6 (Henningsson 2005 range 4.0-5.5).
 B2  EC temperature coefficient ~2.2 %/degC (literature 1.7-2.8).
 B3  Water: linear mixing of ions; tap/bore-water EC lognormal, median 0.6 mS/cm. pH moves
     toward water pH only weakly (milk is buffered): +0.35 * w * (pH_water - pH_milk).
 B4  Urea (non-ionic): small pH rise (+0.02 pH per g/L) and a small EC change that is
     near zero on average (literature disagrees: some report a decrease via ion hindrance,
     some a slight increase from impurities/hydrolysis). Weakest-evidence class.
 B5  Salt (NaCl): +1.0 mS/cm per g/L at 25 C in milk (pure-water value ~1.8-2.0, reduced by
     fat/protein hindrance), tiny pH drop (-0.01 pH per g/L).
 B6  Sugar (sucrose, non-ionic): EC25 falls ~1.1 % per g/100 mL (ion-mobility/viscosity effect).
     pH unchanged. NOTE: a purely conductivity-based TDS probe would NOT see sucrose at all.
     To keep the class learnable we assume the TDS channel has a small positive response to
     non-ionic solute (+1.2 % of reading per g/100 mL). THIS IS UNVERIFIED - test on hardware.
 B7  The TDS probe is modelled as a conductivity-derived sensor with its own cell,
     its own (imperfect) temperature compensation (fixed 2.0 %/degC), a device-specific
     conversion factor (~0.50 ppm per uS/cm), so TDS ~ EC but with scatter.
 B8  Nuisance (non-adulteration) variation: subclinical mastitis 8 % (EC up, pH up),
     mildly aged milk 12 % (pH down a little, EC up a little), natural cow-to-cow spread.
"""
import math
from pathlib import Path
import numpy as np
import pandas as pd

SEED = 20261006
COUNTS = {"None": 2100, "Water": 850, "Urea": 650, "Salt": 700, "Sugar": 700}   # = 5000
N_SHOPS = 40
ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "data" / "apnadairy_model2_adulteration_dataset.csv"
AUDIT = ROOT / "audit" / "apnadairy_model2_hidden_latents_AUDIT_ONLY.csv"
RANGES = dict(temperature_c=(2.0, 42.0), ph=(6.0, 7.6), ec_ms_cm=(1.0, 14.0), tds_ppm=(500.0, 7000.0))


def main():
    rng = np.random.default_rng(SEED)
    labels = np.concatenate([[k] * v for k, v in COUNTS.items()])
    rng.shuffle(labels)
    n = len(labels)

    shop_T = rng.normal(0, 0.15, N_SHOPS)
    shop_pH = rng.normal(0, 0.03, N_SHOPS)
    shop_ECg = rng.normal(1.0, 0.02, N_SHOPS)
    shop_kTDS = rng.normal(0.50, 0.015, N_SHOPS)     # ppm per uS/cm, device conversion factor
    shop_tdsg = rng.normal(1.0, 0.02, N_SHOPS)

    rows = []
    for i in range(n):
        lab = labels[i]
        # ---- collection temperature: independent of label ----
        T = float(rng.normal(14, 6)) if rng.random() < 0.30 else float(rng.normal(27, 6))
        T = float(np.clip(T, 3.0, 40.0))

        # ---- natural milk ----
        ec25 = float(np.clip(rng.normal(4.75, 0.30), 4.0, 5.6))
        pH = float(np.clip(rng.normal(6.68, 0.07), 6.48, 6.90))
        mastitis = rng.random() < 0.08
        aged = rng.random() < 0.12
        if mastitis:
            ec25 += rng.uniform(0.4, 1.4); pH += rng.uniform(0.02, 0.12)
        if aged:
            pH -= rng.uniform(0.02, 0.15); ec25 += rng.uniform(0.0, 0.3)
        ec25_milk0, pH_milk0 = ec25, pH

        dose = 0.0
        water_ec = np.nan
        tds_nonionic = 0.0
        severity = "none"
        if lab == "Water":
            sev = rng.choice(["mild", "moderate", "strong"], p=[0.35, 0.40, 0.25])
            w = {"mild": rng.uniform(0.03, 0.10), "moderate": rng.uniform(0.10, 0.25),
                 "strong": rng.uniform(0.25, 0.50)}[sev]
            water_ec = float(np.clip(rng.lognormal(math.log(0.6), 0.6), 0.05, 2.0))
            pH_w = rng.normal(7.4, 0.4)
            ec25 = (1 - w) * ec25 + w * water_ec
            pH = pH + 0.35 * w * (pH_w - pH)
            dose, severity = w * 100, sev                # % v/v
        elif lab == "Urea":
            sev = rng.choice(["mild", "moderate", "strong"], p=[0.35, 0.40, 0.25])
            u = {"mild": rng.uniform(0.5, 3), "moderate": rng.uniform(3, 8), "strong": rng.uniform(8, 15)}[sev]
            pH += 0.02 * u * rng.uniform(0.6, 1.4)
            ec25 += rng.normal(0.0, 0.05) + 0.004 * u
            dose, severity = u, sev                      # g/L
        elif lab == "Salt":
            sev = rng.choice(["mild", "moderate", "strong"], p=[0.35, 0.40, 0.25])
            s = {"mild": rng.uniform(0.2, 0.8), "moderate": rng.uniform(0.8, 2.0), "strong": rng.uniform(2.0, 5.0)}[sev]
            ec25 += rng.normal(1.0, 0.15) * s
            pH -= 0.01 * s * rng.uniform(0.5, 1.5)
            dose, severity = s, sev                      # g/L
        elif lab == "Sugar":
            sev = rng.choice(["mild", "moderate", "strong"], p=[0.35, 0.40, 0.25])
            c = {"mild": rng.uniform(0.5, 2), "moderate": rng.uniform(2, 5), "strong": rng.uniform(5, 8)}[sev]
            ec25 *= 1 - 0.011 * c * rng.uniform(0.7, 1.3)
            tds_nonionic = 0.012 * c * rng.uniform(0.6, 1.4)
            dose, severity = c, sev                      # g/100 mL

        # ---- physics of the instruments ----
        alpha = 0.0220 - 0.00018 * (T - 25) + rng.normal(0, 0.0012)
        ec_true_T = ec25 * (1 + alpha * (T - 25))
        pH_T = pH - 0.009 * (T - 25)

        shop = int(rng.integers(0, N_SHOPS))
        T_meas = T + shop_T[shop] + rng.normal(0, 0.2)
        T_meas = round(T_meas / 0.0625) * 0.0625
        ph_meas = pH_T + shop_pH[shop] + rng.normal(0, 0.04)
        if rng.random() < 0.015:
            ph_meas += rng.normal(0, 0.12)                # fouled/drifting probe
        ec_meas = ec_true_T * shop_ECg[shop] * (1 + rng.normal(0, 0.018)) + rng.normal(0, 0.03)
        if rng.random() < 0.01:
            ec_meas *= rng.normal(1.0, 0.07)              # bubble / poor contact

        # TDS probe: own cell, own compensation (fixed 2 %/C), device factor, non-ionic response
        cell = 1 + rng.normal(0, 0.03)
        ec_tds_cell_T = ec_true_T * cell
        ec25_tds_est = ec_tds_cell_T / (1 + 0.020 * (T_meas - 25))
        tds = ec25_tds_est * 1000.0 * shop_kTDS[shop] * shop_tdsg[shop] * (1 + tds_nonionic)
        tds += rng.normal(0, 25)
        if rng.random() < 0.01:
            tds *= rng.normal(1.0, 0.07)

        rows.append(dict(
            temperature_c=T_meas, ph=ph_meas, ec_ms_cm=ec_meas, tds_ppm=tds,
            adulteration_type=lab,
            # audit-only
            h_true_temp_c=T, h_ec25_natural_milk=ec25_milk0, h_ph25_natural_milk=pH_milk0,
            h_adulterant_dose=dose, h_dose_unit={"None": "", "Water": "pct_v_v", "Urea": "g_per_L",
                                               "Salt": "g_per_L", "Sugar": "g_per_100mL"}[lab],
            h_severity=severity, h_water_ec_ms_cm=water_ec, h_mastitis=int(mastitis), h_aged=int(aged),
            h_ec25_after_adulteration=ec25, h_ph25_after_adulteration=pH, h_ec_temp_coeff=alpha,
            h_tds_nonionic_response=tds_nonionic, h_shop=shop,
        ))

    df = pd.DataFrame(rows)

    # ---- timestamps: independent of label (no seasonality, no class-time patterns) ----
    days = rng.integers(0, 273, n)
    u = rng.random(n)
    hour = np.where(u < 0.65, rng.uniform(5.5, 9.5, n), np.where(u < 0.95, rng.uniform(16, 19.5, n), rng.uniform(0, 24, n)))
    ts = pd.Timestamp("2026-01-01") + pd.to_timedelta(days, unit="D") + pd.to_timedelta((hour * 3600).astype(int), unit="s")
    df.insert(0, "collection_timestamp", ts)
    df = df.sort_values("collection_timestamp").reset_index(drop=True)
    df.insert(0, "sample_id", [f"M2_{i+1:05d}" for i in range(n)])

    for c, (lo, hi) in RANGES.items():
        df[c] = df[c].clip(lo, hi)
    df["temperature_c"] = df["temperature_c"].round(2)
    df["ph"] = df["ph"].round(2)
    df["ec_ms_cm"] = df["ec_ms_cm"].round(3)
    df["tds_ppm"] = df["tds_ppm"].round(0).astype(int)
    df["adulteration_detected"] = np.where(df.adulteration_type == "None", "No", "Yes")
    df["collection_timestamp"] = df["collection_timestamp"].dt.strftime("%Y-%m-%d %H:%M:%S")

    pub_cols = ["sample_id", "collection_timestamp", "temperature_c", "ph", "ec_ms_cm", "tds_ppm",
                "adulteration_detected", "adulteration_type"]
    PUBLIC.parent.mkdir(parents=True, exist_ok=True)
    AUDIT.parent.mkdir(parents=True, exist_ok=True)
    df[pub_cols].to_csv(PUBLIC, index=False)
    audit = df[["sample_id"] + [c for c in df.columns if c.startswith("h_")]]
    with open(AUDIT, "w") as f:
        f.write("# AUDIT ONLY - DO NOT TRAIN MODEL ON THIS FILE. Hidden simulation state for validating the generator.\n")
        audit.to_csv(f, index=False)
    print(f"wrote {PUBLIC} ({len(df)} rows)\nwrote {AUDIT}")
    print(df.adulteration_type.value_counts())


if __name__ == "__main__":
    main()
