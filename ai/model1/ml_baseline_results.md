# Baseline model comparison (SYNTHETIC data; validation set only)

Split: train 3500 / validation 750 / test 750  (70/15/15, stratified by quality, seed 42)


## A. Quality classification (validation)

| model                      | features       |   accuracy |   macro_F1 |   within_1_class |
|:---------------------------|:---------------|-----------:|-----------:|-----------------:|
| Logistic Regression        | raw 3 inputs   |      0.661 |      0.559 |            0.905 |
| Logistic Regression        | raw + ec25_est |      0.664 |      0.563 |            0.907 |
| Decision Tree (depth 6)    | raw 3 inputs   |      0.688 |      0.674 |            0.957 |
| Decision Tree (depth 6)    | raw + ec25_est |      0.691 |      0.679 |            0.957 |
| SVM (RBF)                  | raw 3 inputs   |      0.704 |      0.67  |            0.933 |
| SVM (RBF)                  | raw + ec25_est |      0.703 |      0.671 |            0.94  |
| Random Forest              | raw 3 inputs   |      0.691 |      0.674 |            0.943 |
| Random Forest              | raw + ec25_est |      0.681 |      0.663 |            0.941 |
| Gradient Boosting (HistGB) | raw 3 inputs   |      0.673 |      0.657 |            0.949 |
| Gradient Boosting (HistGB) | raw + ec25_est |      0.679 |      0.659 |            0.948 |

## freshness_score (validation; features raw + ec25_est)

| model                      |    MAE |    R2 |
|:---------------------------|-------:|------:|
| Ridge (linear)             | 15.195 | 0.651 |
| Decision Tree (depth 6)    | 11.048 | 0.776 |
| SVR (RBF)                  | 11.186 | 0.774 |
| Random Forest              | 11.091 | 0.77  |
| Gradient Boosting (HistGB) | 10.748 | 0.79  |

## remaining_shelf_life_hours (validation; features raw + ec25_est; trained on log1p(target))

| model                      |    MAE |    R2 |
|:---------------------------|-------:|------:|
| Ridge (linear)             | 12.813 | 0.641 |
| Decision Tree (depth 6)    |  6.349 | 0.903 |
| SVR (RBF)                  |  5.968 | 0.912 |
| Random Forest              |  6.386 | 0.895 |
| Gradient Boosting (HistGB) |  6.162 | 0.905 |

## spoilage_risk_percent (validation; features raw + ec25_est)

| model                      |    MAE |    R2 |
|:---------------------------|-------:|------:|
| Ridge (linear)             | 17.173 | 0.646 |
| Decision Tree (depth 6)    | 10.713 | 0.777 |
| SVR (RBF)                  | 11.518 | 0.763 |
| Random Forest              | 10.696 | 0.784 |
| Gradient Boosting (HistGB) | 10.682 | 0.794 |

## FINAL TEST (scored once; HistGB trained on train+val)

accuracy 0.684, macro-F1 0.653, within-1-class 0.939

|                 |   pred Good |   pred Acceptable |   pred Poor |   pred Spoiled |
|:----------------|------------:|------------------:|------------:|---------------:|
| true Good       |         284 |                51 |          16 |              0 |
| true Acceptable |          90 |                78 |           8 |              0 |
| true Poor       |          30 |                31 |          38 |              4 |
| true Spoiled    |           0 |                 0 |           7 |            113 |