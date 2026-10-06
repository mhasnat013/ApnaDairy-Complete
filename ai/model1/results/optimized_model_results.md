# APNADAIRY Model 1 - Optimized ML Results

## Dataset

- Total samples: 5000
- Test set: 15%
- Test set was kept untouched during model selection.
- 5-fold cross-validation was used for model optimization.

## Input Features

- Temperature
- pH
- EC
- EC normalized to 25°C (ec25_est)

## Quality Classification

| Model                |   Best Macro F1 | Best Parameters                                                                                     |
|:---------------------|----------------:|:----------------------------------------------------------------------------------------------------|
| SVM                  |          0.6759 | {'model__C': 3, 'model__class_weight': 'balanced', 'model__gamma': 'scale', 'model__kernel': 'rbf'} |
| Random Forest        |          0.671  | {'class_weight': 'balanced', 'max_depth': 8, 'min_samples_leaf': 3, 'n_estimators': 300}            |
| HistGradientBoosting |          0.6645 | {'l2_regularization': 0, 'learning_rate': 0.03, 'max_iter': 200, 'max_leaf_nodes': 15}              |

### Final Quality Test Performance

- Accuracy: **0.6667**

- Macro F1: **0.6655**


## Freshness Score

| Model                |   Best CV R2 | Best Parameters                                                                        |
|:---------------------|-------------:|:---------------------------------------------------------------------------------------|
| SVR                  |       0.7809 | {'model__C': 100, 'model__epsilon': 0.1, 'model__gamma': 'scale'}                      |
| Random Forest        |       0.7922 | {'max_depth': 8, 'min_samples_leaf': 5, 'n_estimators': 500}                           |
| HistGradientBoosting |       0.7899 | {'l2_regularization': 1, 'learning_rate': 0.03, 'max_iter': 200, 'max_leaf_nodes': 15} |

Final Test MAE: **11.0649**

Final Test R²: **0.7740**


## Remaining Shelf Life

| Model                |   Best CV R2 | Best Parameters                                                                        |
|:---------------------|-------------:|:---------------------------------------------------------------------------------------|
| SVR                  |       0.9126 | {'model__C': 100, 'model__epsilon': 0.2, 'model__gamma': 'scale'}                      |
| Random Forest        |       0.9221 | {'max_depth': 8, 'min_samples_leaf': 5, 'n_estimators': 500}                           |
| HistGradientBoosting |       0.9217 | {'l2_regularization': 1, 'learning_rate': 0.03, 'max_iter': 200, 'max_leaf_nodes': 15} |

Final Test MAE: **6.7657 hours**

Final Test R²: **0.8813**


## Spoilage Risk

| Model                |   Best CV R2 | Best Parameters                                                                          |
|:---------------------|-------------:|:-----------------------------------------------------------------------------------------|
| SVR                  |       0.7517 | {'model__C': 100, 'model__epsilon': 0.2, 'model__gamma': 'scale'}                        |
| Random Forest        |       0.7815 | {'max_depth': 8, 'min_samples_leaf': 5, 'n_estimators': 500}                             |
| HistGradientBoosting |       0.7808 | {'l2_regularization': 0.1, 'learning_rate': 0.03, 'max_iter': 200, 'max_leaf_nodes': 15} |

Final Test MAE: **10.9612%**

Final Test R²: **0.7760**
