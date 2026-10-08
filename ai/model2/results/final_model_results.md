# APNADAIRY Model 2 - Water Adulteration Detection

## Purpose

This model detects whether the milk sample contains **water adulteration**.

The original dataset contains five classes:

- None
- Water
- Urea
- Salt
- Sugar

For APNADAIRY deployment, the target is converted to binary:

- Water -> Water
- None, Urea, Salt, Sugar -> No Water

## IoT Inputs

- Temperature
- pH
- EC
- TDS

## Final Model

HistGradientBoosting + sigmoid probability calibration.

## Test Results

- Accuracy: 0.895
- Balanced Accuracy: 0.727
- Water Precision: 0.833
- Water Recall: 0.472
- Water F1: 0.603

## Important Limitation

This model was trained using synthetic data.

Real deployment requires real IoT readings paired with laboratory-verified water-adulteration results.