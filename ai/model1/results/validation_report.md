# Validation report - APNADAIRY Model 1 synthetic dataset

Rows: 5000   Columns: ['sample_id', 'collection_timestamp', 'temperature_c', 'ph', 'ec_ms_cm', 'freshness_score', 'quality', 'remaining_shelf_life_hours', 'spoilage_risk_percent']

## 1-6 Basic integrity
- [PASS] 1 No missing values
- [PASS] 2 No duplicate rows (ignoring sample_id)
- [PASS] 2b sample_id unique
- [PASS] 3/5 Temperature in DS18B20-plausible milk range 0.5-45 C - min 2.50, max 40.38
- [PASS] 4 pH within 4.0-7.4 (physically possible for milk, incl. soured) - min 4.45, max 7.22
- [PASS] 6 Raw EC within 1.0-9.0 mS/cm - min 1.620, max 9.000
- [PASS] Targets within bounds (score 0-100, risk 0-100, life>=0)
- [PASS] Quality values are only the 4 expected labels
- [PASS] Timestamp format parses & is unique-ish

## 7 Target consistency

Medians by quality class:

| quality    |   freshness_score |   spoilage_risk_percent |   remaining_shelf_life_hours |
|:-----------|------------------:|------------------------:|-----------------------------:|
| Good       |              88.8 |                     0.5 |                         33.5 |
| Acceptable |              64.8 |                     4.7 |                         13   |
| Poor       |              39.3 |                    69.6 |                          4   |
| Spoiled    |               0.5 |                    99.5 |                          0   |

- [PASS] 7a Median freshness strictly decreases Good>Acceptable>Poor>Spoiled
- [PASS] 7b Median spoilage risk increases with worse quality
- [PASS] 7c Median shelf life decreases with worse quality
- [PASS] 7d No score>=85 labelled Poor/Spoiled (and vice versa score<=20 Good/Acceptable)
- [PASS] 7e Clearly Spoiled (score<15) => shelf life <=1 h and risk >=90% - 0 violations; 19 borderline rows (score 15-25, within label-noise of the cut-off) are allowed
- [PASS] 7f Good never has 0 h shelf life - 0 violations
- [PASS] 7g Score>=75 with risk>90% is rare (<1%)  [possible only for warm, fast-growth milk] - 0 rows (0.00%)
- [PASS] 7h Score<25 always Spoiled

Median shelf life (h) by quality x test-temperature class (temperature MUST matter):

|                            |   remaining_shelf_life_hours |
|:---------------------------|-----------------------------:|
| ('Acceptable', 'cold<=12') |                         41   |
| ('Acceptable', 'mid12-25') |                         14.5 |
| ('Acceptable', 'warm>25')  |                          5   |
| ('Good', 'cold<=12')       |                         97.5 |
| ('Good', 'mid12-25')       |                         28.5 |
| ('Good', 'warm>25')        |                          7.5 |

- [PASS] 7i Within a quality class, warmer samples have shorter shelf life

## 13-14 Extreme-condition sanity
- [PASS] 13a pH<6.0 (clearly soured) is never Good - 602 samples with pH<6.0; quality mix: {'Spoiled': 602}
- [PASS] 13b pH<6.3 labelled Good is rare (<1% of Good) - 0 rows

Spoiled samples with 'normal-looking' pH (>=6.5): 24 of 800 (3.0%).  These come from probe-fault rows / high-load milk whose pH has not yet moved (real limitation of pH-based sensing; kept on purpose, see report).
- [PASS] 14a Spoiled with pH>=6.5 is a small minority (<10% of Spoiled)

Cold, normal-pH samples: 1249; quality mix: {'Good': 902, 'Acceptable': 217, 'Poor': 127, 'Spoiled': 3}  (cold is NOT automatically Good: aged / high-load chilled milk appears as Acceptable/Poor.)
- [PASS] 14b Cold+normal pH samples include non-Good labels (cold != automatically fresh)
Warm (>28C) Good samples with normal pH: 638; median risk 27.3% (warm-but-fresh milk exists but carries elevated risk).
- [PASS] 14c Warm Good samples have higher median risk than cold Good samples

## 8 Correlation analysis (Spearman)

|                            |   temperature_c |    ph |   ec_ms_cm |   freshness_score |   remaining_shelf_life_hours |   spoilage_risk_percent |
|:---------------------------|----------------:|------:|-----------:|------------------:|-----------------------------:|------------------------:|
| temperature_c              |            1    | -0.67 |       0.94 |             -0.21 |                        -0.73 |                    0.67 |
| ph                         |           -0.67 |  1    |      -0.69 |              0.58 |                         0.87 |                   -0.86 |
| ec_ms_cm                   |            0.94 | -0.69 |       1    |             -0.28 |                        -0.75 |                    0.7  |
| freshness_score            |           -0.21 |  0.58 |      -0.28 |              1    |                         0.73 |                   -0.73 |
| remaining_shelf_life_hours |           -0.73 |  0.87 |      -0.75 |              0.73 |                         1    |                   -0.97 |
| spoilage_risk_percent      |            0.67 | -0.86 |       0.7  |             -0.73 |                        -0.97 |                    1    |

- [PASS] 8a No single input has |Spearman| >= 0.9 with freshness/risk (not trivially separable) - max |rho| = 0.86
- [PASS] 8b pH vs freshness positive, pH vs risk negative
- [PASS] 8c Targets mutually correlated in the expected direction

pH-EC Pearson r = -0.51 (EC is dominated by temperature, so a weak/moderate raw correlation is expected).

## 9 Target-leakage checks
- [PASS] 9a Public CSV contains only sample_id, timestamp, the 3 device inputs and the 4 targets (no hidden columns)

| model                                       |   5-fold CV accuracy |
|:--------------------------------------------|---------------------:|
| temperature_c only (depth-3 tree)           |                0.515 |
| ph only (depth-3 tree)                      |                0.626 |
| ec_ms_cm only (depth-3 tree)                |                0.492 |
| time features only (hour/dow/month/doy, RF) |                0.464 |
| all 3 sensor inputs (RF)                    |                0.692 |
| majority-class baseline                     |                0.468 |

- [PASS] 9b Timestamp-derived features carry no label information (acc within 3 pts of majority baseline) - 0.464 vs 0.468
- [PASS] 9c No single sensor separates classes (best single-feature accuracy < 0.80) - best 0.626
- [PASS] 9d Combined inputs informative (>= baseline+15 pts) but far from perfect (< 0.97) - 0.692 vs baseline 0.468

Kruskal-Wallis hour-of-day vs quality: H=1.79, p=0.616 (p>0.05 = no association)
- [PASS] 9e Hour-of-day independent of quality (p>0.01)

## 10 Class distribution

| quality    |    n |   percent |
|:-----------|-----:|----------:|
| Good       | 2339 |      46.8 |
| Acceptable | 1175 |      23.5 |
| Poor       |  686 |      13.7 |
| Spoiled    |  800 |      16   |

- [PASS] 10 Every class between 8% and 55% (imbalanced but learnable)

## 11 Outliers (IQR rule, 3xIQR fences)
- temperature_c: 0 extreme outliers (3xIQR)
- ph: 521 extreme outliers (3xIQR)
- ec_ms_cm: 0 extreme outliers (3xIQR)
- freshness_score: 0 extreme outliers (3xIQR)
(Distributions are multi-modal by design: cold vs warm handling, fresh vs soured. IQR rules over-flag such data; range checks above are the binding test.)

## 12 Near-duplicate check
Nearest-neighbour distance in standardised space: min 0.0000, 1st pct 0.0084, median 0.0487
Near-identical input triples (distance<0.002): 8 rows (0.16%); of these 5 have different quality labels. These are chance collisions of 3 rounded sensor readings and illustrate genuine ambiguity (warm milk: pH/EC may not yet reveal age).
- [PASS] 12 Near-identical input triples are rare (<0.5% of rows) and no exact duplicate rows

## Audit against hidden generator state (for the developer only - NOT model inputs)
- Spearman(freshness_score, hidden log10 CFU/mL) = -0.99
- Subclinical-mastitis share 9.7%, diluted 4.2%, pH-probe faults 1.2%, EC faults 0.7%
- Mastitis rows labelled Good/Acceptable: 69.4% (EC is raised by mastitis without spoilage -> deliberate confounder)
- Scenario x quality (row %):

| h_scenario          |   Good |   Acceptable |   Poor |   Spoiled |
|:--------------------|-------:|-------------:|-------:|----------:|
| S1_fresh_warm       |   83.5 |         16.1 |    0.4 |       0   |
| S2_delayed_ambient  |   11.2 |         39.7 |   31.6 |      17.6 |
| S3_chilled          |   90.4 |          9.4 |    0.2 |       0   |
| S4_ambient_then_ice |    3   |         31.1 |   42.3 |      23.6 |
| S5_neglected        |    0.2 |          2   |    9.5 |      88.3 |
| S6_cold_chain_break |   50.4 |         42.5 |    6.7 |       0.4 |


## Summary: 33/33 checks passed, 0 failed