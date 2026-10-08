# APNADAIRY Model 2 - Milk Adulteration Detection (SYNTHETIC prototype dataset)

> **Everything here is synthetic.** The data come from a simulation built on published *qualitative* relationships; most *magnitudes* are my assumptions (section 3). It is suitable for initial ML development and FYP prototyping. It is **not** laboratory data, the model is **not** laboratory- or field-validated, and it must be retrained and validated on real IoT readings from real milk with known, lab-verified adulteration before any real-world use.

## 1. Purpose
Detect whether collected milk is adulterated and, if so, the type (Water, Urea, Salt, Sugar). Inputs are exactly four device readings: `temperature_c`, `ph`, `ec_ms_cm`, `tds_ppm`. Outputs: `adulteration_detected`, `adulteration_type`, `confidence`. This dataset is independent of Model 1 (no TDS in Model 1, no Model 2 output into Model 1).

## 2. Project layout and how to run
```
data/    apnadairy_model2_adulteration_dataset.csv   (5,000 rows, 8 columns - public)
audit/   apnadairy_model2_hidden_latents_AUDIT_ONLY.csv   (AUDIT ONLY - DO NOT TRAIN MODEL ON THIS FILE)
src/     generate_dataset.py  validate_dataset.py  train_models.py  predict.py
models/  model2_adulteration.joblib  model_card.json
results/ validation_report.md  model_comparison.md  final_model_results.md
```
```
pip install -r requirements.txt
python src/generate_dataset.py     # seed 20261006 (data), reproducible byte-for-byte
python src/validate_dataset.py     # 37 checks -> results/validation_report.md
python src/train_models.py         # CV comparison + final model (seed 42)
python src/predict.py '{"temperature": 28.5, "ph": 6.7, "ec": 5.2, "tds": 2600}'
```
**Reading the CSV:** the label `None` is a real value. In pandas use `pd.read_csv(path, keep_default_na=False)` or it becomes NaN.

## 3. Scientific basis and assumptions
What the literature supports (read from abstracts/excerpts; I did not verify every full text):
- **Normal milk EC** is about 4.0-5.5 mS/cm at 20-25 C (Henningsson et al., *J. Food Process Eng.*; mastitis papers incl. *Front. Vet. Sci.* 2025). EC rises ~1.7-2.8 %/C, so raw EC must be read together with temperature.
- **Milk pH** of fresh cow milk ~6.5-6.9 (an adulteration study reports 6.71 +/- 0.02 for unadulterated samples).
- **EC and pH together** are used as adulteration markers; water dilution is detectable down to ~1 % v/v with good electrodes (Singh et al., *Food Chem.* 2016). Ionic adulterants (salt) add charge carriers and raise EC.
- **Urea and lactose are uncharged**, so they do not conduct themselves. An impedance study reports urea *decreasing* milk conductivity via aggregates hindering ions.
- **TDS and EC** are both measures of dissolved material; an EC/TDS mastitis study (Bangladesh) used TDS cut-offs near 3100 mg/L alongside EC ~6.2 mS/cm.

Flagged assumptions (magnitudes are mine; **verify on hardware**):

| # | Assumption | Confidence |
|---|---|---|
| B1 | Natural milk EC@25C ~ N(4.75, 0.30), pH ~ N(6.68, 0.07) | Medium (literature ranges) |
| B2 | EC temperature coefficient 2.2 %/C (sample-to-sample spread) | Medium |
| B3 | Water: linear mixing with water EC (lognormal, median 0.6 mS/cm); pH shifts weakly toward water pH | Medium for EC, low for pH |
| B4 | **Urea:** pH +0.02 per g/L; EC change ~0. The excerpt I found suggests a *decrease* in EC; I did not model one, so urea may be more or less detectable in reality | **Low** |
| B5 | Salt: +1.0 mS/cm per g/L NaCl in milk, tiny pH drop | Medium (pure-water value ~1.8-2, reduced in milk) |
| B6 | **Sugar:** EC falls ~1.1 % per g/100 mL. A conductivity-type TDS probe would not respond to sucrose at all; I assumed a small positive TDS response (+1.2 % per g/100 mL) | **Low - unverified, probably optimistic** |
| B7 | TDS probe = conductivity-derived (own cell, own fixed 2 %/C compensation, device factor ~0.5 ppm per uS/cm, +/-3 % cell noise). This is common engineering knowledge for low-cost TDS modules, not something I sourced here | Medium |
| B8 | Nuisance variation: mastitis 8 % (EC up, pH up), mildly aged milk 12 % (pH slightly down, EC slightly up) | Medium |

## 4. Generation method
Each row: pick class (exact counts) -> draw collection temperature (independent of class: 30 % chilled ~14 C, 70 % ambient ~27 C) -> draw natural milk (+ mastitis/aging) -> apply adulterant with a severity (mild 35 % / moderate 40 % / strong 25 %) and a continuous dose -> apply EC temperature physics and pH temperature shift (-0.009 pH/C) -> read through four noisy instruments (40 hypothetical shops with their own calibration offsets; DS18B20 0.0625 C steps; 1-1.5 % probe-fault rows). Timestamps: random 2026-01-01..09-30, morning/evening collection pattern, **generated independently of class**. Doses: water 3-50 % v/v, urea 0.5-15 g/L, salt 0.2-5 g/L, sugar 0.5-8 g/100 mL.

## 5. Columns (public CSV)
| Column | Unit / format | Role |
|---|---|---|
| sample_id | `M2_00001`.. (assigned after sorting by time) | metadata |
| collection_timestamp | `YYYY-MM-DD HH:MM:SS`, collection+test time | metadata only |
| temperature_c | degC (DS18B20) | input |
| ph | pH units | input |
| ec_ms_cm | mS/cm, **raw (not temperature-compensated)** at measured temperature | input |
| tds_ppm | ppm (mg/L), as reported by a conductivity-based TDS meter | input |
| adulteration_detected | Yes / No | target |
| adulteration_type | None / Water / Urea / Salt / Sugar | target |

Backend-derived features used by the model (computed inside the pipeline from the four inputs, never by the device): `ec25 = ec/(1+0.022*(T-25))` and `tds_ec_ratio = tds/(ec*1000)`.

## 6. Class distribution
None 2,100 (42 %), Water 850 (17 %), Salt 700 (14 %), Sugar 700 (14 %), Urea 650 (13 %). `detected=Yes` for all non-None rows; zero contradictions.

## 7. Sensor ranges (synthetic training ranges; calibrate to your hardware)
| Variable | Allowed | Observed | Reason |
|---|---|---|---|
| temperature_c | 2-42 | 2.4-40.4 | chilled to warm collection; DS18B20 spans -55..125 |
| ph | 6.0-7.6 | 6.27-7.29 | fresh/mildly aged milk; strongly soured milk belongs to Model 1 |
| ec_ms_cm | 1-14 | 1.0-12.1 | raw EC: cold diluted milk ~2, warm salted milk >10 |
| tds_ppm | 500-7000 | 853-5486 | ~0.5 x EC in uS/cm. **Many cheap TDS modules saturate at ~1000-2000 ppm, below normal milk (~2400 ppm here). Check your sensor's range before collecting data.** |

## 8. Correlation (see `results/validation_report.md`)
EC-TDS Pearson 0.79 (Spearman 0.72). The correlation is moderate because EC is raw (temperature-dependent) while the TDS meter compensates temperature; TDS/EC ratio has CV ~20 %, so TDS is not a constant multiple of EC. Temperature does not predict class (adulterated share 0.57-0.62 in every temperature band).

## 9. Validation: 37/37 automated checks PASS
Covers the 20 requested checks plus extras (see report). Leakage tests (5-fold CV accuracy, majority baseline 0.420): temperature only 0.416, pH only 0.436, EC only 0.471, TDS only 0.547, timestamp only 0.421, sample_id only 0.404, all four sensors 0.586. Hour-of-day (p=0.16) and month (p=0.18) are independent of class. 62 % of rows have mostly other-class neighbours, i.e. heavy overlap.
Two checks were revised after seeing results: the TDS/EC ratio band (widened to allow probe-fault rows) and the "learnable" check (changed to binary detection, balanced accuracy > 0.65, which passes at 0.656 - a marginal pass, and the 0.65 threshold was chosen after seeing the numbers). Per-class weakness is reported as an unscored WARN rather than hidden.

## 10. Baseline models (stratified 5-fold CV on 85 % train pool; test 15 % untouched)
| Model | 5-class acc | Macro-F1 | Detect balanced acc |
|---|---|---|---|
| Majority | 0.420 | 0.118 | 0.500 |
| Logistic Regression | 0.613 | 0.541 | 0.681 |
| Random Forest | 0.603 | 0.536 | 0.673 |
| SVM (RBF) | 0.599 | 0.479 | 0.663 |
| HistGradientBoosting | 0.598 | 0.530 | 0.665 |

Models are within CV noise of each other. Final model (HistGB + sigmoid calibration, chosen a priori for handling interactions; Logistic Regression is equally defensible and simpler) scored once on test: 5-class accuracy 0.600, macro-F1 0.519, detection balanced accuracy 0.666. Per-class recall: None 0.87, Salt 0.65, Water 0.54, Urea 0.26, **Sugar 0.13**. Full matrices in `results/`.

**Important finding:** the four sensors detect Salt and Water doses reliably when moderate or strong, and miss most Sugar and Urea. This is consistent with the physics (non-ionic substances barely move conductivity-type signals) and I did **not** tune the data to hide it. If you need to detect sugar/urea, add sensors that respond to them (refractometer/Brix, density, or a urea-specific test).

## 11. Confidence
`confidence` = the model's predicted probability for the predicted class, from `predict_proba` of a HistGradientBoosting model wrapped in `CalibratedClassifierCV` (sigmoid, 5-fold). Calibration lowered expected calibration error on the test set (0.046 -> 0.036) and the reliability table is in `results/final_model_results.md`. It is not hard-coded or random. It is **not** the probability that the milk is scientifically proven adulterated and **not** an amount (94 % is not "94 % water"); it is only valid if real data resemble the training data. Predictions with confidence below about 0.6 are frequent and should be shown as "uncertain".

## 12. Limitations
1. Synthetic data; magnitudes B3-B8 are assumptions, especially urea (B4) and sugar (B6).
2. Cow-milk literature; buffalo milk (common in Pakistan) differs. Single-adulterant labels only: mixtures (e.g. water + salt to restore EC) are not modelled and would fool the model.
3. Real adulterants vary (commercial urea impurities, detergent, starch, neutralisers) and are outside the four classes.
4. Sensor realism simplified (drift, fouling, response time, probe-to-probe differences). Real pH/EC/TDS sensors need calibration solutions and routine re-calibration.
5. TDS from a conductivity-based module adds limited independent information; the model largely uses the TDS/EC ratio.
6. Model 1 spoilage (acidification, raised EC) can resemble Model 2 adulteration; the two models are kept separate by design, and spoiled milk is not in this dataset.

## 13. Real-data collection recommendations
- Collect paired readings from the actual DS18B20 + pH + EC + TDS device on: verified pure milk from many farms/breeds (include cow and buffalo), then lab-prepared adulterated samples with known doses (water 0-50 %, salt 0.2-5 g/L, urea 0.5-15 g/L, sugar 0.5-8 g/100 mL, plus mixtures), at several temperatures (4-40 C).
- Record device ID, probe calibration date, and repeat each sample 3x. Keep a lab reference (e.g. freezing point for water, chemical urea test, refractometer for sugar).
- Split train/test by **day/shop/farm**, not random rows. Retrain, re-calibrate probabilities, and report per-class recall.

## 14. ML recommendations
One multi-class classifier (5 classes) with the binary output derived (`detected = predicted != None`). Gradient boosting, Random Forest and Logistic Regression are all appropriate for 5,000 tabular rows; start with the simplest that performs (Logistic Regression with engineered `ec25` and ratio is already competitive). Avoid deep learning. Report macro-F1 and per-class recall, show probabilities, and use an "uncertain" band instead of a hard decision at low confidence. Add a confidence/OOD warning when inputs fall outside the training ranges (done in `predict.py`).

## 15. IoT integration
Device -> backend (HTTP/MQTT) JSON `{"temperature": 28.5, "ph": 6.7, "ec": 5.2, "tds": 2600}` with temperature in C, EC in mS/cm raw, TDS in ppm. The backend calls `predict.predict(payload)` which does all preprocessing and returns:
```
{"adulteration_detected": "No", "adulteration_type": "None", "confidence": 0.588,
 "probabilities": {...}, "p_any_adulteration": 0.412, "warnings": [], "disclaimer": "..."}
```
The device never computes ML features. Do not use timestamp or sample_id as inputs. Ensure the EC unit matches (mS/cm, raw), otherwise convert in the backend.

## 16. Sources consulted
Henningsson et al., *The Electrical Conductivity of Milk - The Effect of Dilution and Temperature* (doi 10.1081/JFP-200048143); *Frontiers in Veterinary Science* 2025, ML mastitis detection with EC (doi 10.3389/fvets.2025.1671186); PMC10844782 (EC and TDS for subclinical mastitis); Singh et al., *Food Chemistry* 2016, impedance and pH as universal markers of milk adulteration (ScienceDirect S0308814616314212); *Food Chemistry* 2022, EIS identification of urea adulteration (S0308814622006409); SciELO Brazil, adulteration in pasteurized milk (pH of unadulterated 6.71); ResearchGate pages on urea/detergent detection through conductivity and pH and on conductivity changes in milk by acidification. Abstract-level reading only.
