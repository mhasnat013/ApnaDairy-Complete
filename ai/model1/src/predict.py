import joblib
import numpy as np
import pandas as pd

# Load trained models
quality_model = joblib.load("models/quality_model.joblib")
freshness_model = joblib.load("models/freshness_model.joblib")
shelf_life_model = joblib.load("models/shelf_life_model.joblib")
spoilage_model = joblib.load("models/spoilage_risk_model.joblib")


def predict_milk_quality(temperature, ph, ec):
    # Create input data
    data = pd.DataFrame([{
        "temperature_c": temperature,
        "ph": ph,
        "ec_ms_cm": ec
    }])

    # Same engineered feature used during training
    data["ec25_est"] = data["ec_ms_cm"] / (
        1 + 0.022 * (data["temperature_c"] - 25.0)
    )

    features = [
        "temperature_c",
        "ph",
        "ec_ms_cm",
        "ec25_est"
    ]

    X = data[features]

    # Predictions
    quality = quality_model.predict(X)[0]

    freshness = freshness_model.predict(X)[0]
    freshness = max(0, min(100, freshness))

    # the shelf-life model was trained on log1p(hours), so turn its output back into hours
    shelf_life = np.expm1(shelf_life_model.predict(X)[0])
    shelf_life = max(0, min(120, shelf_life))

    spoilage_risk = spoilage_model.predict(X)[0]
    spoilage_risk = max(0, min(100, spoilage_risk))

    return {
        "freshness_score": round(float(freshness), 2),
        "quality": quality,
        "remaining_shelf_life_hours": round(float(shelf_life), 2),
        "spoilage_risk_percent": round(float(spoilage_risk), 2)
    }


# Test prediction
if __name__ == "__main__":

    result = predict_milk_quality(
       #poor
        #temperature=12.0,
        #ph=6.11,
        #ec=-4.5

#fresh
       # temperature=5.0,
        #ph=6.7,
        #ec=3.5

#Moderate
        #temperature=15.0,
        #ph=6.5,
        #ec=4.5

#POOR
#temperature=25.0,
#ph=6.2,
#ec=6.5

#Spoiled
temperature=30.0,
ph=5.5,
ec=8.0
    )

    print("\nAPNADAIRY MODEL 1 PREDICTION")
    print("--------------------------------")
    print(f"Freshness Score: {result['freshness_score']}")
    print(f"Quality: {result['quality']}")
    print(f"Remaining Shelf Life: {result['remaining_shelf_life_hours']} hours")
    print(f"Spoilage Risk: {result['spoilage_risk_percent']}%")