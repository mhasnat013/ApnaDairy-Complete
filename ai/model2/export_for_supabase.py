"""
Exports the trained Model 2 (models/model2_adulteration.joblib, unchanged) into one compact file the Supabase edge
function reads, so the model runs inside Supabase with no separate Python server (same way as Model 1).

    python export_for_supabase.py            (run from ai/model2)

writes ../../public/model2/apnadairy-model2-v1.bin (gzip) and prints its sha256, which goes into
supabase/functions/iot-reading/index.ts (MODEL2_SHA256). The edge function checks it after downloading.

the model: CalibratedClassifierCV (sigmoid, 5 folds) around BackendFeatures + HistGradientBoostingClassifier,
classes "No Water" / "Water". P(water) = mean over the 5 folds of 1 / (1 + exp(a * raw + b)), where raw is the
boosted trees' sum (baseline + every tree's leaf). features: temperature_c, ph, ec_ms_cm, tds_ppm, then
ec25 = ec / (1 + 0.022 (t - 25)) and tds_ec_ratio = tds / (ec * 1000).

file layout (inside gzip): 4 bytes json length (little endian), the json header, padding to 8 bytes, then the arrays.
per fold: a, b, baseline (header) and its trees; per tree node: left, right (int16), feature (int8, -1 for a leaf),
missing goes left (uint8) and one float64 that is the split threshold (inner node) or the leaf value.
the edge function must give the same answers as src/predict.py: test_parity.mjs checks it.
"""
import gzip
import hashlib
import json
import struct
import sys
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "src"))
from train_models import BackendFeatures  # noqa: E402,F401  (needed to load the pipeline)

OUT = ROOT.parent.parent / "public" / "model2" / "apnadairy-model2-v1.bin"
FEATURES = ["temperature_c", "ph", "ec_ms_cm", "tds_ppm", "ec25", "tds_ec_ratio"]


def main():
    bundle = joblib.load(ROOT / "models" / "model2_adulteration.joblib")
    model = bundle["model"]
    assert list(bundle["inputs"]) == FEATURES[:4]
    assert list(model.classes_) == ["No Water", "Water"] and model.method == "sigmoid"

    blob = bytearray()

    def put(arr, dtype):
        a = np.ascontiguousarray(arr, dtype=dtype)
        while len(blob) % 8:
            blob.append(0)
        off = len(blob)
        blob.extend(a.tobytes())          # little endian on every machine we use
        return {"offset": off, "length": int(a.size)}

    folds = []
    for cc in model.calibrated_classifiers_:
        names = [name for name, _ in cc.estimator.steps]
        assert names == ["backendfeatures", "histgradientboostingclassifier"], names
        hgb = cc.estimator[-1]
        assert hgb.is_categorical_ is None and hgb.n_trees_per_iteration_ == 1
        cal = cc.calibrators[0]
        lefts, rights, feats, miss, vals, counts = [], [], [], [], [], []
        for (pred,) in hgb._predictors:
            n = pred.nodes
            assert not n["is_categorical"].any()
            leaf = n["is_leaf"].astype(bool)
            lefts.append(np.where(leaf, -1, n["left"].astype(np.int64)).astype("<i2"))
            rights.append(np.where(leaf, -1, n["right"].astype(np.int64)).astype("<i2"))
            feats.append(np.where(leaf, -1, n["feature_idx"].astype(np.int64)).astype("i1"))
            miss.append(n["missing_go_to_left"].astype("u1"))
            vals.append(np.where(leaf, n["value"], n["num_threshold"]).astype("<f8"))
            counts.append(len(n))
        folds.append({
            "a": float(cal.a_), "b": float(cal.b_), "baseline": float(np.ravel(hgb._baseline_prediction)[0]),
            "trees": len(counts), "nodes": counts,
            "left": put(np.concatenate(lefts), "<i2"), "right": put(np.concatenate(rights), "<i2"),
            "feature": put(np.concatenate(feats), "i1"), "missing_left": put(np.concatenate(miss), "u1"),
            "value": put(np.concatenate(vals), "<f8"),
        })

    header = {
        "format": "apnadairy-model2", "version": 1, "features": FEATURES, "classes": list(model.classes_),
        "train_ranges": {k: [float(v[0]), float(v[1])] for k, v in bundle["train_ranges"].items()},
        "folds": folds,
    }
    head = json.dumps(header, separators=(",", ":")).encode()
    out = bytearray(struct.pack("<I", len(head)) + head)
    while len(out) % 8:
        out.append(0x20)
    raw = bytes(out) + bytes(blob)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    gz = gzip.compress(raw, compresslevel=9, mtime=0)
    OUT.write_bytes(gz)
    print(f"{OUT.relative_to(ROOT.parent.parent)}: {len(raw):,} bytes, {len(gz):,} gzipped")
    print("sha256", hashlib.sha256(gz).hexdigest())


if __name__ == "__main__":
    main()
