#!/usr/bin/env python3

"""
APNADAIRY Model 2 - Water Adulteration Prediction

Input:
    Temperature
    pH
    EC
    TDS

Output:
    Adulteration Detected
    Type
    Confidence
"""

import json
import sys
from pathlib import Path

import joblib
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent

sys.path.insert(
    0,
    str(Path(__file__).resolve().parent)
)

from train_models import BackendFeatures  # noqa: F401


_MODEL = None


def load_model():

    global _MODEL

    if _MODEL is None:

        _MODEL = joblib.load(
            ROOT
            / "models"
            / "model2_adulteration.joblib"
        )

    return _MODEL


def predict(payload):

    bundle = load_model()

    # ---------------------------------------------------------
    # Read IoT sensor values
    # ---------------------------------------------------------

    try:

        values = {
            "temperature_c": float(
                payload["temperature"]
            ),

            "ph": float(
                payload["ph"]
            ),

            "ec_ms_cm": float(
                payload["ec"]
            ),

            "tds_ppm": float(
                payload["tds"]
            ),
        }

    except (
        KeyError,
        TypeError,
        ValueError
    ) as error:

        raise ValueError(
            "Input must contain numeric "
            "temperature, ph, ec and tds"
        ) from error

    # ---------------------------------------------------------
    # Prepare input for model
    # ---------------------------------------------------------

    X = pd.DataFrame(
        [values]
    )[bundle["inputs"]]

    # ---------------------------------------------------------
    # Get prediction probability
    # ---------------------------------------------------------

    probabilities = (
        bundle["model"]
        .predict_proba(X)[0]
    )

    classes = bundle["classes"]

    index = int(
        probabilities.argmax()
    )

    predicted_class = classes[index]

    confidence = float(
        probabilities[index]
    )

    # ---------------------------------------------------------
    # Convert model result to APNADAIRY output
    # ---------------------------------------------------------

    if predicted_class == "Water":

        detected = "Yes"
        adulteration_type = "Water"

    else:

        detected = "No"
        adulteration_type = "None"

    # ---------------------------------------------------------
    # Check whether sensor readings are outside
    # training range
    # ---------------------------------------------------------

    warnings = []

    for column, limits in bundle[
        "train_ranges"
    ].items():

        minimum = limits[0]
        maximum = limits[1]

        if not (
            minimum
            <= values[column]
            <= maximum
        ):

            warnings.append(
                f"{column} is outside the "
                f"training range"
            )

    # ---------------------------------------------------------
    # Return clean frontend-friendly result
    # ---------------------------------------------------------

    return {
        "adulteration_detected": detected,
        "adulteration_type": adulteration_type,
        "confidence": round(
            confidence * 100,
            1
        ),
        "warnings": warnings,
    }


if __name__ == "__main__":

    if len(sys.argv) > 1:

        argument = sys.argv[1]

        # PowerShell may pass escaped quotes.
        argument = argument.replace(
            '\\"',
            '"'
        )

        payload = json.loads(
            argument
        )

    else:

        payload = {
            "temperature": 25,
            "ph": 6.7,
            "ec": 4.5,
            "tds": 2400,
        }

    result = predict(
        payload
    )

    if result["adulteration_detected"] == "Yes":

        print(
            "Adulteration Detected"
        )

        print(
            f"Type: {result['adulteration_type']}"
        )

    else:

        print(
            "No Adulteration Detected"
        )

    print(
        f"Confidence: {result['confidence']}%"
    )

    if result["warnings"]:

        print(
            "\nWarnings:"
        )

        for warning in result["warnings"]:

            print(
                f"- {warning}"
            )