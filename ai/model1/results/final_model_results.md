
# APNADAIRY Model 1 - Final Model Results

## Dataset

- Total samples: 5000
- Training samples: 4250
- Final test samples: 750
- Random seed: 42

## Input Features

1. temperature_c
2. ph
3. ec_ms_cm
4. ec25_est (engineered from EC and temperature)

## Final Models

| Target | Model |
|---|---|
| Quality | SVM (RBF) |
| Freshness Score | HistGradientBoosting |
| Remaining Shelf Life | SVR (RBF) |
| Spoilage Risk | HistGradientBoosting |

## Final Test Results

### Quality

- Accuracy: 0.689
- Macro F1: 0.637

### Freshness Score

- MAE: 11.319
- R2: 0.771

### Remaining Shelf Life

- MAE: 6.888 hours
- R2: 0.871

### Spoilage Risk

- MAE: 11.166%
- R2: 0.778
