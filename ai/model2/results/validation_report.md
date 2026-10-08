# Validation report - APNADAIRY Model 2 (SYNTHETIC dataset)

## Structure and integrity
- [PASS] 1 Exactly 5,000 rows - 5000
- [PASS] 2 Columns exactly as specified, in order
- [PASS] 3 No missing values
- [PASS] 4/17 No duplicate rows (all columns) and no duplicate sensor+label rows
- [PASS] 5 sample_id unique and format M2_00001..M2_05000
- [PASS] 6 Timestamps parse as YYYY-MM-DD HH:MM:SS
- [PASS] 7 temperature_c within [2.0, 42.0] - min 2.38, max 40.44
- [PASS] 7 ph within [6.0, 7.6] - min 6.27, max 7.29
- [PASS] 7 ec_ms_cm within [1.0, 14.0] - min 1.0, max 12.083
- [PASS] 7 tds_ppm within [500, 7000] - min 853, max 5486
- [PASS] 7b Values are not stuck at clip limits (<0.5% rows on any boundary)
- [PASS] 8 Valid label values
- [PASS] 9 Zero label contradictions (No<->None, Yes<->non-None) - 0 contradictions

## Class distribution

| adulteration_type   |    n |   percent |
|:--------------------|-----:|----------:|
| None                | 2100 |        42 |
| Water               |  850 |        17 |
| Urea                |  650 |        13 |
| Salt                |  700 |        14 |
| Sugar               |  700 |        14 |

- [PASS] 10 Class shares within recommended bands (None 40-45, Water 15-20, others 10-15)
- [PASS] 19 Every class >= 500 samples - min 650

## Distributions

EC-TDS: Pearson 0.790, Spearman 0.717
- [PASS] 11 EC and TDS positively but not perfectly correlated (0.5 < r < 0.98)
TDS/EC ratio (ppm per uS/cm): mean 0.546, sd 0.111, min 0.336, max 1.008
- [PASS] 11b TDS != constant x EC (ratio coefficient of variation > 5%) - CV 20.4%

Temperature / pH / EC / TDS summary:

|       |   temperature_c |      ph |   ec_ms_cm |   tds_ppm |
|:------|----------------:|--------:|-----------:|----------:|
| count |         5000    | 5000    |    5000    |   5000    |
| mean  |           22.99 |    6.71 |       4.59 |   2403.82 |
| std   |            8.3  |    0.13 |       1.3  |    483.49 |
| min   |            2.38 |    6.27 |       1    |    853    |
| 25%   |           17.17 |    6.62 |       3.75 |   2157    |
| 50%   |           23.88 |    6.71 |       4.57 |   2355    |
| 75%   |           29.12 |    6.8  |       5.3  |   2562    |
| max   |           40.44 |    7.29 |      12.08 |   5486    |

- [PASS] 12 Temperature spans >= 25 C and is not label-driven (Kruskal p > 0.01) - p=0.764
- [PASS] 13 pH centre in 6.5-6.9 and 99% of rows within 6.2-7.2 - median 6.71

### Sensor distributions by class (mean / sd)

| adulteration_type   |   ('temperature_c', 'mean') |   ('temperature_c', 'std') |   ('ph', 'mean') |   ('ph', 'std') |   ('ec_ms_cm', 'mean') |   ('ec_ms_cm', 'std') |   ('tds_ppm', 'mean') |   ('tds_ppm', 'std') |
|:--------------------|----------------------------:|---------------------------:|-----------------:|----------------:|-----------------------:|----------------------:|----------------------:|---------------------:|
| None                |                       22.86 |                       8.18 |             6.7  |            0.12 |                   4.51 |                  1    |               2358.68 |               247.49 |
| Water               |                       23.18 |                       8.81 |             6.75 |            0.13 |                   3.81 |                  1.08 |               1963.33 |               354.01 |
| Urea                |                       23.09 |                       8.1  |             6.8  |            0.14 |                   4.58 |                  1.01 |               2379.77 |               252.93 |
| Salt                |                       23.11 |                       8.36 |             6.67 |            0.12 |                   5.99 |                  1.74 |               3115.16 |               672.12 |
| Sugar               |                       22.93 |                       8.18 |             6.69 |            0.12 |                   4.38 |                  1    |               2385.11 |               273.58 |

Share adulterated by temperature band: (0, 12]: 0.58, (12, 22]: 0.57, (22, 32]: 0.57, (32, 45]: 0.62
- [PASS] 14 Temperature does not determine adulteration (adulterated share 0.45-0.70 in every band)
- [PASS] 14b Every class occurs in both cold (<=15C) and warm (>=30C) milk

## Leakage checks (5-fold stratified CV accuracy)

| inputs                            |   accuracy |
|:----------------------------------|-----------:|
| temperature_c only (depth-3 tree) |      0.416 |
| ph only (depth-3 tree)            |      0.436 |
| ec_ms_cm only (depth-3 tree)      |      0.471 |
| tds_ppm only (depth-3 tree)       |      0.547 |
| timestamp features only (RF)      |      0.421 |
| sample_id number only (RF)        |      0.404 |
| all 4 sensors (RF)                |      0.586 |
| majority baseline                 |      0.42  |

- [PASS] 15 No single sensor separates the 5 classes (best single-feature acc < 0.75) - best 0.547
- [PASS] 16 Timestamp features carry no label information (within 3 pts of majority) - 0.421 vs 0.420
- [PASS] 16b sample_id carries no label information (within 3 pts of majority) - 0.404 vs 0.420
- [PASS] 16c Hour-of-day independent of class (Kruskal p > 0.01) - p=0.162
- [PASS] 16d Month independent of class (chi-square p > 0.01) - p=0.182
- [PASS] 15b Public file holds no hidden columns
- [PASS] 15c Sensors + timestamp together are informative but not trivial (majority+0.10 < RF acc < 0.97) - 0.586

## Physical plausibility / overlap

EC referenced to 25 C (analysis only): pure milk mean 4.72, water 3.94, salt 6.23, sugar 4.57, urea 4.75
- [PASS] 18a Pure milk EC@25C mostly in literature range 3.8-6.2 (>=95%) - 98.0%
- [PASS] 18b Direction: water lowers and salt raises EC@25C vs pure milk
- [PASS] 18c Direction: urea raises pH vs pure milk
- [PASS] 18d No impossible combos: pH>7.3 never with EC<2 (impossible for milk-like fluid)
- [PASS] 18e TDS/EC ratio inside 0.25-1.2 ppm per uS/cm for every row (conversion factors of conductivity-based TDS meters are ~0.4-0.9; edges allow probe faults) - 2.0% of rows outside the typical 0.35-0.85 band (faults, cold-milk compensation error)

KNN neighbourhood mixing: 61.9% of rows have >=50% of their 10 nearest neighbours in another class; 91.4% have at least one.
- [PASS] 20 Difficult/overlapping samples exist (>=15% of rows have majority-other-class neighbours)

Per-class recall from RF out-of-fold predictions: None 82%, Water 57%, Urea 30%, Salt 64%, Sugar 12%
- [PASS] 20b Dataset is not too easy: no class has recall > 0.98
Binary detection (Yes/No), HistGB with backend features ec25+ratio: balanced accuracy 0.656
- [PASS] 20c Detection (Yes/No) is learnable: balanced accuracy > 0.65 and < 0.97 - 0.656
WARN (informational, not scored): classes with RF recall < 25%: ['Sugar']. This is a scientific finding, not a bug: non-ionic adulterants (sugar, low-dose urea) barely change conductivity-type measurements. See README limitations.

## Audit against hidden generator state (developer only - never a model input)

RF recall by hidden severity (should rise with dose):

| adulteration_type   |   mild |   moderate |   strong |
|:--------------------|-------:|-----------:|---------:|
| Salt                |   0.2  |       0.82 |     1    |
| Sugar               |   0.08 |       0.11 |     0.19 |
| Urea                |   0.07 |       0.27 |     0.66 |
| Water               |   0.16 |       0.66 |     0.97 |

Pure milk: mastitis 7.6%, aged 11.9%; pure-milk RF recall for mastitis rows 44% (EC confounder, mostly confused with Salt)
- [PASS] Audit: recall higher for strong than mild doses in Water and Salt

## Summary: 37/37 checks passed, 0 failed