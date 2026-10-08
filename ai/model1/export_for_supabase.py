"""
Exports the trained Model 1 (models/*.joblib, unchanged) into one compact file the Supabase edge function reads,
so the model runs inside Supabase with no separate Python server.

    python export_for_supabase.py            (run from ai/model1)

writes ../../public/model1/apnadairy-model1-v1.bin (gzip) and prints its sha256, which goes into
supabase/functions/iot-reading/index.ts (MODEL1_SHA256). The edge function checks it after downloading.

file layout (inside gzip): 4 bytes json length (little endian), the json header, padding to 8 bytes, then the arrays.
  quality:   StandardScaler (mean, scale) + SVC with rbf kernel (support vectors, dual coefs, intercepts, n_support)
  freshness, shelf_life, spoilage: random forests; per tree: left, right (int16), feature (int8), and one float64
             per node that is the split threshold (inner node) or the predicted value (leaf)
the edge function must give the same answers as app/main.py: test_parity.mjs checks every dataset row.
"""
import gzip
import hashlib
import json
import struct
from pathlib import Path

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parent
OUT = ROOT.parent.parent / "public" / "model1" / "apnadairy-model1-v1.bin"
FEATURES = ["temperature_c", "ph", "ec_ms_cm", "ec25_est"]


def main():
    blob = bytearray()
    header = {"format": "apnadairy-model1", "version": 1, "features": FEATURES}

    def put(arr, dtype):
        a = np.ascontiguousarray(arr, dtype=dtype)
        while len(blob) % 8:
            blob.append(0)
        off = len(blob)
        blob.extend(a.tobytes())          # little endian on every machine we use
        return {"offset": off, "length": int(a.size)}

    # ---- quality: scaler + svm ----
    q = joblib.load(ROOT / "models" / "quality_model.joblib")
    scaler, svc = q.named_steps["scaler"], q.named_steps["model"]
    assert svc.kernel == "rbf" and list(scaler.feature_names_in_) == FEATURES
    header["quality"] = {
        "mean": scaler.mean_.tolist(), "scale": scaler.scale_.tolist(),
        "gamma": float(svc._gamma), "classes": [str(c) for c in svc.classes_],
        "n_support": svc.n_support_.tolist(), "intercept": svc._intercept_.tolist(),
        "sv": put(svc.support_vectors_, "<f8"), "coef": put(svc._dual_coef_, "<f8"),
        "n_sv": int(svc.support_vectors_.shape[0]),
    }

    # ---- the three forests ----
    for key, file in [("freshness", "freshness_model"), ("shelf_life", "shelf_life_model"), ("spoilage", "spoilage_risk_model")]:
        f = joblib.load(ROOT / "models" / f"{file}.joblib")
        assert list(f.feature_names_in_) == FEATURES
        lefts, rights, feats, vals, counts = [], [], [], [], []
        for est in f.estimators_:
            t = est.tree_
            leaf = t.children_left == -1
            lefts.append(t.children_left.astype("<i2"))
            rights.append(t.children_right.astype("<i2"))
            feats.append(np.where(leaf, -1, t.feature).astype("i1"))
            vals.append(np.where(leaf, t.value[:, 0, 0], t.threshold).astype("<f8"))
            counts.append(int(t.node_count))
        header[key] = {
            "trees": len(counts), "nodes": counts,
            "left": put(np.concatenate(lefts), "<i2"), "right": put(np.concatenate(rights), "<i2"),
            "feature": put(np.concatenate(feats), "i1"), "value": put(np.concatenate(vals), "<f8"),
        }
    header["shelf_life"]["log1p"] = True   # trained on log1p(hours): the answer goes back with expm1

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
