# APNADAIRY — Model 1: Milk Quality, Freshness & Spoilage Prediction

## 1. Project Overview

APNADAIRY Model 1 is an ML-based milk quality prediction system designed to work with an IoT milk-testing device.

The IoT device measures three physical properties of milk:

1. Temperature
2. pH
3. Electrical Conductivity (EC)

These readings are passed to the ML prediction pipeline.

The system produces four outputs:

1. Quality
2. Freshness Score
3. Remaining Shelf Life
4. Spoilage Risk

The overall workflow is:

```text
IoT Sensors
     |
     |-- Temperature
     |-- pH
     |-- EC
     |
     v
Backend / ML Pipeline
     |
     v
Feature Engineering
     |
     v
Trained ML Models
     |
     |-- Quality
     |-- Freshness Score
     |-- Remaining Shelf Life
     |-- Spoilage Risk
     |
     v
Prediction Results
     |
     v
Frontend
# APNADAIRY — Model 1: Milk Quality, Freshness & Spoilage Prediction

## 1. Project Overview

APNADAIRY Model 1 is an ML-based milk quality prediction system designed to work with an IoT milk-testing device.

The IoT device measures three physical properties of milk:

1. Temperature
2. pH
3. Electrical Conductivity (EC)

These readings are passed to the ML prediction pipeline.

The system produces four outputs:

1. Quality
2. Freshness Score
3. Remaining Shelf Life
4. Spoilage Risk

The overall workflow is:

```text
IoT Sensors
     |
     |-- Temperature
     |-- pH
     |-- EC
     |
     v
Backend / ML Pipeline
     |
     v
Feature Engineering
     |
     v
Trained ML Models
     |
     |-- Quality
     |-- Freshness Score
     |-- Remaining Shelf Life
     |-- Spoilage Risk
     |
     v
Prediction Results
     |
     v
Frontend

2. IoT Inputs
The ML system requires only three actual sensor readings.
Input	Sensor	Unit
Temperature	DS18B20	°C
pH	pH Probe	pH
EC	Electrical Conductivity Sensor	mS/cm


Important
The IoT device does NOT need to calculate or send ec25_est.
The ML pipeline calculates it automatically.
3. Engineered Feature
The model uses an additional feature called:
ec25_est

This is EC normalized to 25°C.
It is calculated using:
ec25_est = EC / (1 + 0.022 × (Temperature - 25))

For example:
Temperature = 12°C
EC = 4.5 mS/cm

The prediction pipeline automatically calculates ec25_est.
Therefore, the IoT device only needs to send:
temperature
ph
ec

4. Machine Learning Models
Different ML models are used for the different prediction tasks.
Prediction	Final Model
Quality	SVM (RBF)
Freshness Score	Random Forest
Remaining Shelf Life	Random Forest
Spoilage Risk	Random Forest


The models were selected after comparing multiple machine-learning algorithms using 5-fold cross-validation.
A separate 15% test set was kept untouched during model selection and used for final evaluation.
5. Trained Model Files
The trained models are stored in:
models/
├── quality_model.joblib
├── freshness_model.joblib
├── shelf_life_model.joblib
└── spoilage_risk_model.joblib

These are trained binary model files.
IMPORTANT
Do not manually edit the .joblib files.
The backend should load them using joblib.load().
6. Dataset
The ML models were trained using a synthetic dataset containing:
5000 samples

The public dataset contains:
sample_id
collection_timestamp
temperature_c
ph
ec_ms_cm
freshness_score
quality
remaining_shelf_life_hours
spoilage_risk_percent

The dataset was validated before model training.
Validation confirmed:
- No missing values
- No duplicate rows
- Unique sample IDs
- Valid temperature range
- Valid pH range
- Valid EC range
- Valid target ranges
- Valid quality labels
- Valid timestamp format
The dataset validation completed with:
33/33 checks passed
0 failed

7. Expected Sensor Ranges
The current training dataset contains approximately:
Temperature:
2.50°C – 40.38°C

pH:
4.45 – 7.22

EC:
1.620 – 9.000 mS/cm

These ranges describe the current training data.
The IoT integration should validate incoming sensor values before passing them to the ML model.
For example:
EC = -4.5

is not a valid EC value for the current trained model.
An invalid sensor reading should be treated as a sensor/input error instead of being directly passed to the model.
8. Prediction Inputs
The backend should receive data in this form:
{
    "temperature": 12.3,
    "ph": 6.61,
    "ec": 4.52
}

Only these three values are required from the IoT device.
The backend/prediction pipeline will calculate:
ec25_est

automatically.
9. Prediction Function
The current prediction pipeline is located in:
src/predict.py

The prediction function takes:
temperaturephec


and loads the four trained models.
Conceptually:
result = predict_milk_quality(    temperature=data["temperature"],    ph=data["ph"],    ec=data["ec"])


The prediction pipeline then returns:
Quality
Freshness Score
Remaining Shelf Life
Spoilage Risk

10. Prediction Output
The output format is:
APNADAIRY MODEL 1 PREDICTION
--------------------------------
Freshness Score: XX.XX
Quality: XXXXX
Remaining Shelf Life: XX.XX hours
Spoilage Risk: XX.XX%

Example:
APNADAIRY MODEL 1 PREDICTION
--------------------------------
Freshness Score: 30.71
Quality: Poor
Remaining Shelf Life: 1.82 hours
Spoilage Risk: 43.57%

The values above are only an example of the output format.
11. Output Explanation
11.1 Freshness Score
Freshness Score is a numerical value from:
0 – 100

Higher values indicate greater freshness.
General interpretation:
80–100  → Very Fresh
60–79   → Fairly Fresh
40–59   → Reduced Freshness
20–39   → Poor Freshness
0–19    → Very Poor / Highly Degraded

These ranges are intended for interpretation/display and are not additional ML training rules.
12. Quality
The Quality model predicts one of four classes:
Good
Acceptable
Poor
Spoiled

The current Quality prediction comes directly from the trained SVM classification model.
13. Remaining Shelf Life
Remaining Shelf Life is predicted in:
hours

Higher values indicate more expected remaining shelf life.
For example:
30 hours → relatively long remaining shelf life
5 hours  → short remaining shelf life
0 hours  → essentially no remaining shelf life

14. Spoilage Risk
Spoilage Risk is represented as:
0–100%

General interpretation:
0–20%    → Very Low Risk
20–40%   → Low Risk
40–60%   → Moderate Risk
60–80%   → High Risk
80–100%  → Very High Risk

These ranges are for interpretation/display.
The spoilage percentage is produced by the trained regression model.
15. Important: Quality and Spoilage Risk Are Separate Predictions
The current system uses separate ML models for:
Quality
Freshness Score
Remaining Shelf Life
Spoilage Risk

Therefore, the models currently make their predictions independently.
For example, the system may produce:
Quality: Poor
Freshness Score: 2.24
Remaining Shelf Life: 0 hours
Spoilage Risk: 99.2%

This is possible because the Quality SVM and the numerical prediction models are separate models.
The current ML pipeline does NOT contain a rule such as:
if spoilage_risk >= 80:
    quality = "Spoiled"

Therefore, do not add such a rule during the IoT integration without coordinating with the ML side.
16. Future Quality Consistency / Decision Layer
A final quality decision layer may be added after IoT integration.
The purpose of this layer is to make the final frontend status consistent with all predicted indicators.
The future architecture can be:
                 IoT DEVICE
                     |
          ┌──────────┼──────────┐
          |          |          |
     Temperature     pH         EC
          |          |          |
          └──────────┼──────────┘
                     |
                     v
               ML PIPELINE
                     |
          ┌──────────┼──────────┐
          |          |          |
     Freshness   Shelf Life   Risk
          |          |          |
          └──────────┼──────────┘
                     |
                     v
          FINAL DECISION LAYER
                     |
                     v
             FINAL QUALITY
                     |
                     v
                 FRONTEND

This layer should be finalized after actual IoT sensor readings are available.
The purpose is NOT to change or retrain the existing ML models.
The purpose is to provide a consistent application-level quality status using the model outputs.
17. Example of the Future Decision Layer
For example, if the ML system predicts:
Freshness Score = 2.24
Shelf Life = 0 hours
Spoilage Risk = 99.2%

the application-level decision may eventually classify the milk as:
SPOILED

However, the exact decision thresholds should be finalized after evaluating the actual IoT readings and comparing them with the validated training data.
Therefore:
DO NOT hard-code arbitrary thresholds yet.

The current task is to integrate the IoT device with the existing ML prediction pipeline first.
18. IoT → Backend → ML → Frontend
The recommended complete architecture is:
┌──────────────────────────┐
│       IoT DEVICE         │
│                          │
│ DS18B20 → Temperature    │
│ pH Probe → pH            │
│ EC Sensor → EC            │
└────────────┬─────────────┘
             │
             │ Sensor Data
             v
┌──────────────────────────┐
│        BACKEND           │
│                          │
│ Validate sensor values   │
│ Receive temperature      │
│ Receive pH               │
│ Receive EC               │
└────────────┬─────────────┘
             │
             v
┌──────────────────────────┐
│      ML PIPELINE         │
│                          │
│ Calculate ec25_est       │
│ Load trained models      │
└────────────┬─────────────┘
             │
             v
┌──────────────────────────┐
│       PREDICTIONS        │
│                          │
│ Quality                  │
│ Freshness Score          │
│ Shelf Life               │
│ Spoilage Risk             │
└────────────┬─────────────┘
             │
             v
┌──────────────────────────┐
│        FRONTEND          │
│                          │
│ Display sensor readings  │
│ Display ML predictions   │
└──────────────────────────┘

19. Backend Response Example
The backend can return the prediction result to the frontend as JSON:
{
    "temperature": 12.3,
    "ph": 6.61,
    "ec": 4.52,
    "freshness_score": 82.4,
    "quality": "Good",
    "remaining_shelf_life_hours": 30.5,
    "spoilage_risk_percent": 8.2
}

The numerical values above are only examples of the response structure.
The actual values will depend on the IoT sensor readings.
20. Frontend Display Example
The frontend can display:
------------------------------------
        MILK QUALITY TEST
------------------------------------

Temperature       12.3 °C
pH                  6.61
EC                  4.52 mS/cm

------------------------------------

Quality            GOOD
Freshness          82.4 / 100
Shelf Life         30.5 hours
Spoilage Risk       8.2%

------------------------------------

The frontend should receive these values from the backend.
The frontend should NOT load or directly execute the .joblib models.
21. Testing the Prediction System Without IoT
The prediction system can be tested manually using:
src/predict.py

Example:
result = predict_milk_quality(    temperature=12.0,    ph=6.11,    ec=4.5)


Then run:
python src/predict.py

You can change the three input values to test different sensor conditions.
22. Project Structure
APNADAIRY_AI_M1/
│
├── .venv/
│
├── data/
│   └── apnadairy_model1_dataset.csv
│
├── audit/
│   └── apnadairy_model1_hidden_latents_AUDIT_ONLY.csv
│
├── models/
│   ├── quality_model.joblib
│   ├── freshness_model.joblib
│   ├── shelf_life_model.joblib
│   └── spoilage_risk_model.joblib
│
├── src/
│   ├── validate_dataset.py
│   ├── preprocessing.py
│   ├── train_models.py
│   ├── train_optimized.py
│   ├── predict.py
│   └── generate_evidence.py
│
├── app/
│   └── main.py
│
├── results/
│   ├── final_metrics.csv
│   ├── final_metrics.md
│   ├── test_predictions.csv
│   ├── quality_model_comparison.png
│   ├── freshness_score_model_comparison.png
│   ├── shelf_life_model_comparison.png
│   ├── spoilage_risk_model_comparison.png
│   ├── quality_confusion_matrix.png
│   ├── freshness_actual_vs_predicted.png
│   ├── shelf_life_actual_vs_predicted.png
│   └── spoilage_risk_actual_vs_predicted.png
│
├── requirements.txt
└── README.md

23. Important File Information
data/apnadairy_model1_dataset.csv
Training/public dataset.
audit/apnadairy_model1_hidden_latents_AUDIT_ONLY.csv
Developer/audit-only file.
It contains hidden simulation information and must NOT be used as an IoT input or ML feature.
models/*.joblib
Trained ML models.
src/predict.py
Main prediction pipeline.
src/train_models.py
Original model training/comparison script.
src/train_optimized.py
Optimized model selection and final training script.
src/validate_dataset.py
Dataset validation script.
src/generate_evidence.py
Generates model evaluation graphs and final metrics.
results/
Contains model evaluation evidence.
24. Final Model Performance
The optimized models were evaluated using an untouched 15% test set.
Output	Model	Metric	Result
Quality	SVM	Accuracy	66.67%
Quality	SVM	Macro F1	0.6655
Freshness Score	Random Forest	MAE	11.06
Freshness Score	Random Forest	R²	0.7740
Remaining Shelf Life	Random Forest	MAE	6.77 hours
Remaining Shelf Life	Random Forest	R²	0.8813
Spoilage Risk	Random Forest	MAE	10.96%
Spoilage Risk	Random Forest	R²	0.7760


25. Model Selection Results
Quality
Model	CV Macro F1
SVM	0.6759
Random Forest	0.6710
HistGradientBoosting	0.6645


Selected model:
SVM

Freshness Score
Model	CV R²
SVR	0.7809
Random Forest	0.7922
HistGradientBoosting	0.7899


Selected model:
Random Forest

Remaining Shelf Life
Model	CV R²
SVR	0.9126
Random Forest	0.9221
HistGradientBoosting	0.9217


Selected model:
Random Forest

Spoilage Risk
Model	CV R²
SVR	0.7517
Random Forest	0.7815
HistGradientBoosting	0.7808


Selected model:
Random Forest

26. Integration Rules
DO
- Use Temperature, pH and EC as the IoT inputs.
- Validate sensor values before prediction.
- Calculate ec25_est inside the backend/ML pipeline.
- Load the existing .joblib models.
- Pass the three sensor readings to the prediction function.
- Return the four prediction outputs to the frontend.
- Keep the trained models unchanged during IoT integration.
- Test the system using actual IoT readings once the device is connected.
DO NOT
- Do not send ec25_est from the IoT device.
- Do not manually edit .joblib files.
- Do not retrain the models during basic IoT integration.
- Do not use the hidden audit CSV as a model input.
- Do not pass invalid sensor readings directly to the ML model.
- Do not make the frontend independently calculate predictions.
- Do not hard-code a new quality rule such as risk >= 80 = Spoiled without coordinating with the ML implementation.
27. Current Development Status
Completed
- Dataset creation
- Dataset validation
- Feature engineering
- Model comparison
- Hyperparameter optimization
- Final model selection
- Final model training
- Model saving
- Prediction pipeline
- Model evaluation
- Evidence generation
Current Stage
The current stage is:
IoT Integration

The existing ML system is ready to receive:
Temperature
pH
EC

and generate:
Quality
Freshness Score
Remaining Shelf Life
Spoilage Risk

Next Stage
After IoT integration:
1. Collect actual sensor readings
2. Test the ML prediction pipeline
3. Check model behavior on real sensor values
4. Evaluate consistency between the four outputs
5. Add the final quality decision/consistency layer
6. Connect the final results to the frontend

28. Important Note for the IoT Developer
The ML model should be treated as a prediction service.
The IoT device is responsible for measuring:
Temperature
pH
EC

The ML/backend system is responsible for:
Feature engineering
Model loading
Prediction
Output formatting

The frontend is responsible for:
Displaying sensor readings
Displaying prediction results
Displaying the final quality status

The final quality consistency layer will be finalized after actual IoT sensor readings are available.
29. Short Integration Summary
The IoT developer only needs to remember:
INPUT
------
Temperature
pH
EC

        ↓

ML MODEL
--------
Calculate ec25_est
Load trained models
Generate predictions

        ↓

OUTPUT
------
Quality
Freshness Score
Remaining Shelf Life
Spoilage Risk

        ↓

FRONTEND
--------
Display results

The existing trained models should not be changed during IoT integration.